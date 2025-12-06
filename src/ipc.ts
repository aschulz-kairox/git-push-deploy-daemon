/**
 * IPC for status queries and commands
 * 
 * Uses a simple HTTP server on localhost for cross-platform compatibility.
 * The port is written to a file next to the PID file.
 * 
 * Also serves an embedded web dashboard at /dashboard
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { PID_FILE } from './pid.js';
import { getDashboardHTML } from './dashboard.js';

export interface WorkerStatus {
  id: number;
  pid: number;
  state: string;
  startTime: number;
  /** Memory usage in MB (RSS - Resident Set Size) */
  memoryMB?: number;
}

export interface SystemMemory {
  /** Total system memory in MB */
  totalMB: number;
  /** Free memory in MB (actually available) */
  freeMB: number;
  /** Free memory percentage */
  freePercent: number;
}

export interface AutostartInfo {
  /** Whether autostart is enabled (systemd unit exists and is enabled) */
  enabled: boolean;
  /** Configured number of workers in systemd unit */
  configuredWorkers?: number;
  /** Service name (from systemd unit) */
  serviceName?: string;
}

export interface RuntimeStatus {
  appFile: string;
  startTime: number;
  workers: WorkerStatus[];
  /** Total memory of all workers in MB */
  appMemoryMB?: number;
  /** System memory info */
  system?: SystemMemory;
  /** Autostart configuration (systemd) */
  autostart?: AutostartInfo;
}

const PORT_FILE = PID_FILE.replace('.pid', '.port');

let server: http.Server | null = null;
let statusCallback: (() => RuntimeStatus) | null = null;
let commandCallback: ((cmd: string) => void) | null = null;
let serverPort: number = 0;

/**
 * Start IPC server (called by master)
 * @param preferredPort If > 0, use this port; otherwise use random port
 */
export function startStatusServer(
  getStatus: () => RuntimeStatus,
  onCommand?: (cmd: string) => void,
  preferredPort?: number
): Promise<number> {
  statusCallback = getStatus;
  commandCallback = onCommand || null;

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      // CORS for web dashboard
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      // Handle preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Dashboard routes
      if (req.method === 'GET' && (req.url === '/' || req.url === '/dashboard')) {
        res.setHeader('Content-Type', 'text/html');
        res.writeHead(200);
        res.end(getDashboardHTML(serverPort));
        return;
      }

      // API routes
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'GET' && req.url === '/status') {
        const status = statusCallback ? statusCallback() : null;
        res.writeHead(200);
        res.end(JSON.stringify(status));
        return;
      }

      if (req.method === 'POST' && req.url === '/reload') {
        if (commandCallback) {
          commandCallback('reload');
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, command: 'reload' }));
        } else {
          res.writeHead(500);
          res.end(JSON.stringify({ ok: false, error: 'no handler' }));
        }
        return;
      }

      if (req.method === 'POST' && req.url === '/stop') {
        if (commandCallback) {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, command: 'stop' }));
          // Give response time to send before shutting down
          setTimeout(() => commandCallback!('stop'), 100);
        } else {
          res.writeHead(500);
          res.end(JSON.stringify({ ok: false, error: 'no handler' }));
        }
        return;
      }

      if (req.method === 'POST' && req.url === '/scale/up') {
        if (commandCallback) {
          commandCallback('scale-up');
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, command: 'scale-up' }));
        } else {
          res.writeHead(500);
          res.end(JSON.stringify({ ok: false, error: 'no handler' }));
        }
        return;
      }

      if (req.method === 'POST' && req.url === '/scale/down') {
        if (commandCallback) {
          commandCallback('scale-down');
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, command: 'scale-down' }));
        } else {
          res.writeHead(500);
          res.end(JSON.stringify({ ok: false, error: 'no handler' }));
        }
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
    });

    // Listen on specified port (or random if 0) on localhost only
    const listenPort = preferredPort && preferredPort > 0 ? preferredPort : 0;
    server.listen(listenPort, '127.0.0.1', () => {
      const addr = server!.address();
      serverPort = typeof addr === 'object' && addr ? addr.port : 0;
      
      // Write port to file
      fs.writeFileSync(PORT_FILE, String(serverPort));
      
      resolve(serverPort);
    });

    server.on('error', reject);
  });
}

/**
 * Stop IPC server
 */
export function stopStatusServer(): void {
  statusCallback = null;
  commandCallback = null;
  
  if (server) {
    server.close();
    server = null;
  }
  
  // Remove port file
  try {
    fs.unlinkSync(PORT_FILE);
  } catch {
    // Ignore
  }
}

/**
 * Read IPC port from file
 */
export function readPortFile(): number | null {
  try {
    const content = fs.readFileSync(PORT_FILE, 'utf-8').trim();
    return parseInt(content, 10) || null;
  } catch {
    return null;
  }
}

/**
 * Query status from master (called by CLI)
 */
export async function getStatus(): Promise<RuntimeStatus | null> {
  const port = readPortFile();
  if (!port) return null;

  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/status`, { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Send command to master (called by CLI)
 */
export async function sendCommand(command: 'reload' | 'stop'): Promise<boolean> {
  const port = readPortFile();
  if (!port) return false;

  return new Promise((resolve) => {
    const req = http.request(
      `http://127.0.0.1:${port}/${command}`,
      { method: 'POST', timeout: 5000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

/**
 * Get process memory usage in MB from /proc/[pid]/status (Linux only)
 */
function getProcessMemoryMB(pid: number): number | undefined {
  try {
    const statusPath = `/proc/${pid}/status`;
    const content = fs.readFileSync(statusPath, 'utf-8');
    const vmRssMatch = content.match(/VmRSS:\s*(\d+)\s*kB/);
    if (vmRssMatch) {
      return Math.round(parseInt(vmRssMatch[1], 10) / 1024);
    }
  } catch {
    // Not Linux or process doesn't exist
  }
  return undefined;
}

/**
 * Get system memory info from /proc/meminfo (Linux only)
 */
function getSystemMemory(): SystemMemory | undefined {
  try {
    const content = fs.readFileSync('/proc/meminfo', 'utf-8');
    const memTotalMatch = content.match(/MemTotal:\s*(\d+)\s*kB/);
    const memAvailableMatch = content.match(/MemAvailable:\s*(\d+)\s*kB/);
    
    if (memTotalMatch && memAvailableMatch) {
      const totalMB = Math.round(parseInt(memTotalMatch[1], 10) / 1024);
      const freeMB = Math.round(parseInt(memAvailableMatch[1], 10) / 1024);
      const freePercent = Math.round((freeMB / totalMB) * 100);
      
      return { totalMB, freeMB, freePercent };
    }
  } catch {
    // Not Linux
  }
  return undefined;
}

/**
 * Get autostart info from systemd (Linux only)
 * Looks for a systemd service that matches the current working directory
 */
function getAutostartInfo(): AutostartInfo | undefined {
  try {
    const cwd = process.cwd();
    
    // Find systemd services that have our WorkingDirectory
    // This searches all *.service files
    const servicesOutput = execSync(
      `grep -l "WorkingDirectory=${cwd}" /etc/systemd/system/*.service 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 2000 }
    ).trim();
    
    if (!servicesOutput) {
      return { enabled: false };
    }
    
    // Get the first matching service file
    const serviceFile = servicesOutput.split('\n')[0];
    const serviceName = path.basename(serviceFile, '.service');
    
    // Check if enabled
    const isEnabledOutput = execSync(
      `systemctl is-enabled ${serviceName} 2>/dev/null || echo disabled`,
      { encoding: 'utf-8', timeout: 2000 }
    ).trim();
    const enabled = isEnabledOutput === 'enabled';
    
    // Parse worker count from ExecStart line
    let configuredWorkers: number | undefined;
    const serviceContent = fs.readFileSync(serviceFile, 'utf-8');
    const workersMatch = serviceContent.match(/--workers\s+(\d+)/);
    if (workersMatch) {
      configuredWorkers = parseInt(workersMatch[1], 10);
    }
    
    return { enabled, configuredWorkers, serviceName };
  } catch {
    // Not Linux or systemd not available
    return undefined;
  }
}

/**
 * Build status object (used by master)
 */
export function getState(
  appFile: string,
  startTime: number,
  workers: Map<number, { id: number; pid: number; state: string; startTime: number }>
): RuntimeStatus {
  const workerList = Array.from(workers.values()).map(w => ({
    id: w.id,
    pid: w.pid,
    state: w.state,
    startTime: w.startTime,
    memoryMB: getProcessMemoryMB(w.pid),
  }));
  
  // Sum up all worker memory for app total
  const appMemoryMB = workerList.reduce((sum, w) => sum + (w.memoryMB || 0), 0) || undefined;
  
  return {
    appFile,
    startTime,
    workers: workerList,
    appMemoryMB,
    system: getSystemMemory(),
    autostart: getAutostartInfo(),
  };
}
