/**
 * Master Process
 * 
 * Responsibilities:
 * - Hold the server socket (workers inherit it)
 * - Manage worker lifecycle (fork, monitor, restart)
 * - Handle reload signals (SIGHUP)
 * - Graceful shutdown (SIGTERM, SIGINT)
 * - Health check monitoring (optional)
 */

import cluster, { Worker } from 'node:cluster';
import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import { writePidFile, removePidFile } from './pid.js';
import { startStatusServer, stopStatusServer, getState } from './ipc.js';
import { startHealthCheck, stopHealthCheck, type HealthCheckOptions } from './health.js';

export interface MasterOptions {
  numWorkers?: number;
  graceTimeout?: number;
  readyTimeout?: number;
  healthCheck?: HealthCheckOptions;
}

interface WorkerInfo {
  id: number;
  pid: number;
  state: 'starting' | 'ready' | 'draining';
  startTime: number;
}

// Module state
let appFile: string;
let workers: Map<number, WorkerInfo> = new Map();
let isShuttingDown = false;
let isReloading = false;
let startTime: number;

const GRACE_TIMEOUT = parseInt(process.env.GPDD_GRACE_TIMEOUT || '30000', 10);
const READY_TIMEOUT = parseInt(process.env.GPDD_READY_TIMEOUT || '10000', 10);

/**
 * Start the master process
 */
export async function startMaster(app: string, options: MasterOptions = {}): Promise<void> {
  appFile = path.resolve(app);
  startTime = Date.now();
  
  const numWorkers = options.numWorkers || parseInt(process.env.GPDD_WORKERS || '0', 10) || os.cpus().length;
  
  console.log(chalk.blue(`Master PID: ${process.pid}`));
  console.log(chalk.blue(`Workers: ${numWorkers}`));
  console.log(chalk.blue(`App: ${appFile}`));
  
  // Write PID file
  writePidFile(process.pid);
  
  // Start IPC status server
  await startStatusServer(() => getState(appFile, startTime, workers));
  
  // Setup cluster
  cluster.setupPrimary({
    exec: appFile,
  });
  
  // Fork initial workers
  for (let i = 0; i < numWorkers; i++) {
    forkWorker();
  }

  // Start health check if configured
  if (options.healthCheck) {
    startHealthCheck(options.healthCheck, (result) => {
      console.log(chalk.red(`Health check failed: ${result.error || 'unhealthy'}`));
      console.log(chalk.yellow('Triggering reload due to health check failure...'));
      handleReload();
    });
  }

  // Handle worker messages
  cluster.on('message', (worker, message) => {
    if (message === 'ready') {
      const info = findWorkerByPid(worker.process.pid!);
      if (info) {
        info.state = 'ready';
        console.log(chalk.green(`Worker ${info.id} ready (PID ${info.pid})`));
      }
    }
  });
  
  // Handle worker exits
  cluster.on('exit', (worker, code, signal) => {
    const info = findWorkerByPid(worker.process.pid!);
    const workerId = info?.id || '?';
    
    if (info) {
      workers.delete(info.id);
    }
    
    if (isShuttingDown) {
      console.log(chalk.gray(`Worker ${workerId} exited`));
      if (workers.size === 0) {
        console.log(chalk.green('All workers stopped'));
        cleanup();
        process.exit(0);
      }
    } else if (!isReloading) {
      // Unexpected exit - restart
      console.log(chalk.yellow(`Worker ${workerId} died (${signal || code}), restarting...`));
      forkWorker();
    }
  });
  
  // Signal handlers
  process.on('SIGHUP', handleReload);
  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);
  
  console.log(chalk.green('✓ Master started'));
  console.log(chalk.gray('Send SIGHUP to reload, SIGTERM to stop'));
}

/**
 * Fork a new worker
 */
function forkWorker(): Worker {
  const worker = cluster.fork();
  const id = getNextWorkerId();
  
  const info: WorkerInfo = {
    id,
    pid: worker.process.pid!,
    state: 'starting',
    startTime: Date.now(),
  };
  
  workers.set(id, info);
  console.log(chalk.blue(`Forked worker ${id} (PID ${info.pid})`));
  
  return worker;
}

/**
 * Zero-downtime reload all workers
 */
async function handleReload() {
  if (isReloading || isShuttingDown) {
    console.log(chalk.yellow('Reload already in progress'));
    return;
  }
  
  isReloading = true;
  console.log(chalk.blue('Starting zero-downtime reload...'));
  
  // Get current worker list (copy to avoid mutation during iteration)
  const currentWorkers = Array.from(workers.entries());
  
  for (const [id, info] of currentWorkers) {
    console.log(chalk.gray(`Replacing worker ${id}...`));
    
    // 1. Fork new worker
    const newWorker = forkWorker();
    
    // 2. Wait for new worker to be ready
    const ready = await waitForReady(newWorker);
    if (!ready) {
      console.log(chalk.red(`New worker failed to start, keeping old worker ${id}`));
      newWorker.kill();
      continue;
    }
    
    // 3. Tell old worker to drain
    const oldWorker = findClusterWorker(info.pid);
    if (oldWorker) {
      info.state = 'draining';
      console.log(chalk.gray(`Draining worker ${id}...`));
      
      // Send shutdown message
      oldWorker.send('shutdown');
      
      // Wait for graceful exit or timeout
      await waitForExit(oldWorker, GRACE_TIMEOUT);
    }
    
    // Remove old worker from tracking
    workers.delete(id);
  }
  
  isReloading = false;
  console.log(chalk.green('✓ Reload complete'));
}

/**
 * Graceful shutdown
 */
async function handleShutdown() {
  if (isShuttingDown) return;
  
  isShuttingDown = true;
  console.log(chalk.blue('Shutting down...'));
  
  // Tell all workers to shutdown
  for (const worker of Object.values(cluster.workers || {})) {
    if (worker) {
      worker.send('shutdown');
      worker.disconnect();
    }
  }
  
  // Wait for workers to exit (with timeout)
  const timeout = setTimeout(() => {
    console.log(chalk.yellow('Timeout, forcing exit...'));
    cleanup();
    process.exit(1);
  }, GRACE_TIMEOUT);
  
  // Check periodically if all workers are gone
  const checkInterval = setInterval(() => {
    const remaining = Object.values(cluster.workers || {}).filter(Boolean).length;
    if (remaining === 0) {
      clearInterval(checkInterval);
      clearTimeout(timeout);
      console.log(chalk.green('✓ Shutdown complete'));
      cleanup();
      process.exit(0);
    }
  }, 100);
}

/**
 * Wait for a worker to send 'ready' message
 */
function waitForReady(worker: Worker): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(false);
    }, READY_TIMEOUT);
    
    const handler = (message: unknown) => {
      if (message === 'ready') {
        clearTimeout(timeout);
        worker.off('message', handler);
        resolve(true);
      }
    };
    
    worker.on('message', handler);
    worker.on('exit', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

/**
 * Wait for a worker to exit
 */
function waitForExit(worker: Worker, timeout: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.log(chalk.yellow(`Worker ${worker.process.pid} timeout, killing...`));
      worker.kill();
      resolve();
    }, timeout);
    
    worker.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Find worker info by PID
 */
function findWorkerByPid(pid: number): WorkerInfo | undefined {
  for (const info of workers.values()) {
    if (info.pid === pid) return info;
  }
  return undefined;
}

/**
 * Find cluster worker by PID
 */
function findClusterWorker(pid: number): Worker | undefined {
  for (const worker of Object.values(cluster.workers || {})) {
    if (worker?.process.pid === pid) return worker;
  }
  return undefined;
}

/**
 * Get next worker ID
 */
let nextWorkerId = 0;
function getNextWorkerId(): number {
  return ++nextWorkerId;
}

/**
 * Cleanup before exit
 */
function cleanup() {
  removePidFile();
  stopStatusServer();
  stopHealthCheck();
}
