/**
 * IPC for status queries and commands
 * 
 * Uses a simple HTTP server on localhost for cross-platform compatibility.
 * The port is written to a file next to the PID file.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PID_FILE } from './pid.js';

export interface WorkerStatus {
  id: number;
  pid: number;
  state: string;
  startTime: number;
}

export interface RuntimeStatus {
  appFile: string;
  startTime: number;
  workers: WorkerStatus[];
}

const PORT_FILE = PID_FILE.replace('.pid', '.port');

let server: http.Server | null = null;
let statusCallback: (() => RuntimeStatus) | null = null;
let commandCallback: ((cmd: string) => void) | null = null;

/**
 * Start IPC server (called by master)
 */
export function startStatusServer(
  getStatus: () => RuntimeStatus,
  onCommand?: (cmd: string) => void
): Promise<number> {
  statusCallback = getStatus;
  commandCallback = onCommand || null;

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      // CORS for potential future web UI
      res.setHeader('Access-Control-Allow-Origin', '*');
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

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
    });

    // Listen on random port on localhost only
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      
      // Write port to file
      fs.writeFileSync(PORT_FILE, String(port));
      
      resolve(port);
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
 * Build status object (used by master)
 */
export function getState(
  appFile: string,
  startTime: number,
  workers: Map<number, { id: number; pid: number; state: string; startTime: number }>
): RuntimeStatus {
  return {
    appFile,
    startTime,
    workers: Array.from(workers.values()).map(w => ({
      id: w.id,
      pid: w.pid,
      state: w.state,
      startTime: w.startTime,
    })),
  };
}
