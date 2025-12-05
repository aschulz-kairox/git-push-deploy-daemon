#!/usr/bin/env node
/**
 * gpd-runtime CLI
 * 
 * Commands:
 *   gpdr start <app.js>   Start master + workers
 *   gpdr reload           Zero-downtime reload
 *   gpdr stop             Graceful shutdown
 *   gpdr status           Show worker status
 */

import { parseArgs } from 'node:util';
import path from 'node:path';
import chalk from 'chalk';
import { startMaster } from './master.js';
import { getStatus, sendCommand } from './ipc.js';
import { readPidFile, PID_FILE } from './pid.js';
import fs from 'node:fs';

/**
 * Load .env file from app directory into process.env
 * Searches for .env in the app file's directory and parent directories
 */
function loadEnvFile(appFile: string): void {
  const appPath = path.resolve(appFile);
  let searchDir = path.dirname(appPath);
  let envPath: string | null = null;
  
  // Search for .env in current dir and parent directories (up to 3 levels)
  for (let i = 0; i < 3; i++) {
    const candidate = path.join(searchDir, '.env');
    if (fs.existsSync(candidate)) {
      envPath = candidate;
      break;
    }
    const parent = path.dirname(searchDir);
    if (parent === searchDir) break; // reached root
    searchDir = parent;
  }
  
  if (!envPath) {
    console.log(chalk.dim(`No .env file found (searched from ${path.dirname(appPath)})`));
    return;
  }
  
  console.log(chalk.dim(`Loading .env from: ${envPath}`));
  
  const content = fs.readFileSync(envPath, 'utf8');
  let loaded = 0;
  
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return;
    
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1);
    
    // Remove surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    
    // Only set if not already defined (env vars take precedence)
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
      loaded++;
    }
  });
  
  if (loaded > 0) {
    console.log(chalk.dim(`Loaded ${loaded} variables from ${envPath}`));
  }
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    workers: { type: 'string', short: 'w' },
    'ready-url': { type: 'string' },
    'health-url': { type: 'string' },
    'health-interval': { type: 'string' },
    'health-threshold': { type: 'string' },
    daemon: { type: 'boolean', short: 'd' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
});

const command = positionals[0];
const appFile = positionals[1];

async function main() {
  if (values.version) {
    // Read version from package.json
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    console.log(pkg.version);
    process.exit(0);
  }

  if (values.help || !command) {
    showHelp();
    process.exit(0);
  }

  switch (command) {
    case 'start':
      await handleStart();
      break;
    case 'reload':
      await handleReload();
      break;
    case 'stop':
      await handleStop();
      break;
    case 'status':
      await handleStatus();
      break;
    default:
      console.error(chalk.red(`Unknown command: ${command}`));
      showHelp();
      process.exit(1);
  }
}

function showHelp() {
  console.log(`
${chalk.bold('git-push-deploy-daemon')} - Zero-downtime Node.js cluster daemon

${chalk.bold('Usage:')}
  gpdd start <app.js> [options]   Start master + workers
  gpdd reload                     Zero-downtime reload all workers
  gpdd stop                       Graceful shutdown
  gpdd status                     Show master and worker status

${chalk.bold('Options:')}
  -w, --workers <n>       Number of workers (default: CPU count)
  -d, --daemon            Run in background (detached)
  --ready-url <url>       URL to poll to determine worker readiness
  --health-url <url>      Health check endpoint for ongoing monitoring
  --health-interval <ms>  Health check interval (default: 30000)
  --health-threshold <n>  Failures before reload (default: 3)
  -h, --help              Show this help
  -v, --version           Show version

${chalk.bold('Examples:')}
  gpdd start dist/index.js -w 4
  gpdd start dist/index.js -d              # Run in background
  gpdd start dist/index.js --ready-url http://localhost:3000/health
  gpdd reload
  gpdd stop

${chalk.bold('Environment:')}
  GPDD_WORKERS        Number of workers
  GPDD_READY_URL      Ready check URL (polled until healthy)
  GPDD_HEALTH_URL     Health check URL (ongoing monitoring)
  GPDD_GRACE_TIMEOUT  Shutdown timeout in ms (default: 30000)
  GPDD_READY_TIMEOUT  Worker ready timeout in ms (default: 10000)

${chalk.bold('Multi-Service Management:')}
  Use 'gpd daemon all start|stop|reload|status' for batch operations.
  See git-push-deploy-cli for details.
`);
}

async function handleStart() {
  if (!appFile) {
    console.error(chalk.red('Error: Missing app file'));
    console.error('Usage: gpdr start <app.js>');
    process.exit(1);
  }

  // Load .env file from app directory
  loadEnvFile(appFile);

  // Check if already running
  const existingPid = readPidFile();
  if (existingPid) {
    try {
      process.kill(existingPid, 0); // Check if process exists
      console.error(chalk.red(`Error: Already running (PID ${existingPid})`));
      console.error('Use "gpdr stop" first or "gpdr reload" to reload workers');
      process.exit(1);
    } catch {
      // Process doesn't exist, stale PID file
      fs.unlinkSync(PID_FILE);
    }
  }

  const numWorkers = parseInt(values.workers || process.env.GPDD_WORKERS || '0', 10);
  
  // Ready check URL (polled until healthy to mark worker as ready)
  const readyUrl = values['ready-url'] || process.env.GPDD_READY_URL;
  
  // Health check options (ongoing monitoring)
  const healthUrl = values['health-url'] || process.env.GPDD_HEALTH_URL;
  const healthCheck = healthUrl
    ? {
        url: healthUrl,
        interval: parseInt(values['health-interval'] || '30000', 10),
        threshold: parseInt(values['health-threshold'] || '3', 10),
      }
    : undefined;

  // Daemon mode: spawn detached process
  if (values.daemon) {
    const { spawn } = await import('node:child_process');
    
    // Build args for the child process (without -d/--daemon)
    const childArgs = ['start', appFile];
    if (values.workers) childArgs.push('-w', values.workers);
    if (values['ready-url']) childArgs.push('--ready-url', values['ready-url']);
    if (values['health-url']) childArgs.push('--health-url', values['health-url']);
    if (values['health-interval']) childArgs.push('--health-interval', values['health-interval']);
    if (values['health-threshold']) childArgs.push('--health-threshold', values['health-threshold']);
    
    // Log file path (same directory as .gpdd.pid)
    const logFile = path.join(process.cwd(), '.gpdd.log');
    const logFd = fs.openSync(logFile, 'a');
    
    const child = spawn(process.execPath, [process.argv[1], ...childArgs], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      cwd: process.cwd(),
      env: process.env,
    });
    
    child.unref();
    fs.closeSync(logFd);
    
    console.log(chalk.green(`✓ Started in background (PID ${child.pid})`));
    console.log(chalk.dim(`  Log: ${logFile}`));
    
    // Wait a moment to check if it started successfully
    await new Promise(r => setTimeout(r, 1000));
    
    const newPid = readPidFile();
    if (newPid) {
      console.log(chalk.green(`✓ Master running (PID ${newPid})`));
    } else {
      console.log(chalk.yellow('  Waiting for startup...'));
    }
    
    return;
  }

  console.log(chalk.blue(`Starting ${appFile}...`));
  await startMaster(appFile, { numWorkers, healthCheck, readyUrl });
}

async function handleReload() {
  const pid = readPidFile();
  if (!pid) {
    console.error(chalk.red('Error: No running instance found'));
    console.error(`PID file not found: ${PID_FILE}`);
    process.exit(1);
  }

  console.log(chalk.blue(`Sending reload command to PID ${pid}...`));
  
  // Try IPC first (works on Windows and Linux)
  const success = await sendCommand('reload');
  if (success) {
    console.log(chalk.green('✓ Reload command sent via IPC'));
    console.log(chalk.gray('Workers will be reloaded one by one'));
    return;
  }

  // Fallback to SIGHUP on Unix
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 'SIGHUP');
      console.log(chalk.green('✓ Reload signal sent via SIGHUP'));
      console.log(chalk.gray('Workers will be reloaded one by one'));
      return;
    } catch {
      // Fall through to error
    }
  }

  console.error(chalk.red(`Error: Could not send reload command to PID ${pid}`));
  console.error(chalk.gray('The process may have crashed. Check logs.'));
  process.exit(1);
}

async function handleStop() {
  const pid = readPidFile();
  if (!pid) {
    console.error(chalk.red('Error: No running instance found'));
    process.exit(1);
  }

  console.log(chalk.blue(`Stopping PID ${pid}...`));
  
  // Try IPC first (works on Windows and Linux)
  const success = await sendCommand('stop');
  if (success) {
    console.log(chalk.green('✓ Stop command sent via IPC'));
  } else if (process.platform !== 'win32') {
    // Fallback to SIGTERM on Unix
    try {
      process.kill(pid, 'SIGTERM');
      console.log(chalk.green('✓ Stop signal sent via SIGTERM'));
    } catch (error) {
      console.error(chalk.red(`Error: Could not signal process ${pid}`));
      process.exit(1);
    }
  } else {
    console.error(chalk.red(`Error: Could not send stop command to PID ${pid}`));
    process.exit(1);
  }
  
  console.log(chalk.gray('Waiting for graceful shutdown...'));
  
  // Wait for process to exit
  let tries = 0;
  while (tries < 60) {
    await new Promise(r => setTimeout(r, 500));
    try {
      process.kill(pid, 0);
      tries++;
    } catch {
      console.log(chalk.green('✓ Stopped'));
      return;
    }
  }
  
  console.log(chalk.yellow('Process still running after 30s'));
  if (process.platform !== 'win32') {
    console.log(chalk.yellow('Sending SIGKILL...'));
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Ignore
    }
  }
}

async function handleStatus() {
  const pid = readPidFile();
  if (!pid) {
    console.log(chalk.yellow('No running instance'));
    return;
  }

  try {
    process.kill(pid, 0); // Check if alive
  } catch {
    console.log(chalk.yellow(`Stale PID file (${pid} not running)`));
    return;
  }

  // Get detailed status via IPC
  const status = await getStatus();
  
  if (status) {
    console.log(chalk.bold('gpd-runtime Status'));
    console.log('');
    console.log(`  Master PID:  ${chalk.green(pid)}`);
    console.log(`  App:         ${status.appFile}`);
    console.log(`  Workers:     ${status.workers.length}`);
    console.log(`  Uptime:      ${formatUptime(status.startTime)}`);
    console.log('');
    console.log(chalk.bold('  Workers:'));
    for (const w of status.workers) {
      const stateColor = w.state === 'ready' ? chalk.green : chalk.yellow;
      console.log(`    [${w.id}] PID ${w.pid} - ${stateColor(w.state)} (${formatUptime(w.startTime)})`);
    }
  } else {
    // Fallback: just show PID
    console.log(chalk.bold('gpd-runtime Status'));
    console.log('');
    console.log(`  Master PID:  ${chalk.green(pid)}`);
    console.log(chalk.gray('  (detailed status not available)'));
  }
}

function formatUptime(startTime: number): string {
  const seconds = Math.floor((Date.now() - startTime) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

main().catch((error) => {
  console.error(chalk.red('Fatal error:'), error.message);
  process.exit(1);
});
