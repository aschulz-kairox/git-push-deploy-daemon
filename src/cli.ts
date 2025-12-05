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
import chalk from 'chalk';
import { startMaster } from './master.js';
import { getStatus } from './ipc.js';
import { readPidFile, PID_FILE } from './pid.js';
import fs from 'node:fs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    workers: { type: 'string', short: 'w' },
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
  -w, --workers <n>   Number of workers (default: CPU count)
  -h, --help          Show this help
  -v, --version       Show version

${chalk.bold('Examples:')}
  gpdd start dist/index.js -w 4
  gpdd reload
  gpdd stop

${chalk.bold('Environment:')}
  GPDD_WORKERS        Number of workers
  GPDD_GRACE_TIMEOUT  Shutdown timeout in ms (default: 30000)
  GPDD_READY_TIMEOUT  Worker ready timeout in ms (default: 10000)
`);
}

async function handleStart() {
  if (!appFile) {
    console.error(chalk.red('Error: Missing app file'));
    console.error('Usage: gpdr start <app.js>');
    process.exit(1);
  }

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
  
  console.log(chalk.blue(`Starting ${appFile}...`));
  await startMaster(appFile, { numWorkers });
}

async function handleReload() {
  const pid = readPidFile();
  if (!pid) {
    console.error(chalk.red('Error: No running instance found'));
    console.error(`PID file not found: ${PID_FILE}`);
    process.exit(1);
  }

  console.log(chalk.blue(`Sending reload signal to PID ${pid}...`));
  
  try {
    process.kill(pid, 'SIGHUP');
    console.log(chalk.green('✓ Reload signal sent'));
    console.log(chalk.gray('Workers will be reloaded one by one'));
  } catch (error) {
    console.error(chalk.red(`Error: Could not signal process ${pid}`));
    console.error(chalk.gray('The process may have crashed. Check logs.'));
    process.exit(1);
  }
}

async function handleStop() {
  const pid = readPidFile();
  if (!pid) {
    console.error(chalk.red('Error: No running instance found'));
    process.exit(1);
  }

  console.log(chalk.blue(`Stopping PID ${pid}...`));
  
  try {
    process.kill(pid, 'SIGTERM');
    console.log(chalk.green('✓ Stop signal sent'));
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
    
    console.log(chalk.yellow('Process still running after 30s, sending SIGKILL...'));
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    console.error(chalk.red(`Error: Could not signal process ${pid}`));
    process.exit(1);
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
  const status = await getStatus(pid);
  
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
