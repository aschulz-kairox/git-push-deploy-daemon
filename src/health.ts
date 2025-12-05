/**
 * Health Check Module
 * 
 * Periodically polls a health endpoint and reports unhealthy workers.
 * The master can use this to restart workers that are stuck or unhealthy.
 */

import http from 'node:http';
import https from 'node:https';
import chalk from 'chalk';

export interface HealthCheckOptions {
  /** Health endpoint URL (e.g., "http://localhost:3000/health") */
  url: string;
  /** Check interval in ms (default: 30000) */
  interval?: number;
  /** Request timeout in ms (default: 5000) */
  timeout?: number;
  /** Number of failures before marking unhealthy (default: 3) */
  threshold?: number;
  /** Expected HTTP status code (default: 200) */
  expectedStatus?: number;
}

export interface HealthCheckResult {
  healthy: boolean;
  status?: number;
  error?: string;
  latencyMs?: number;
}

type HealthCheckCallback = (result: HealthCheckResult) => void;

let checkInterval: NodeJS.Timeout | null = null;
let failureCount = 0;
let options: Required<HealthCheckOptions>;
let onUnhealthy: HealthCheckCallback | null = null;

const DEFAULT_OPTIONS = {
  interval: 30000,
  timeout: 5000,
  threshold: 3,
  expectedStatus: 200,
};

/**
 * Start periodic health checks
 */
export function startHealthCheck(
  opts: HealthCheckOptions,
  callback: HealthCheckCallback
): void {
  options = { ...DEFAULT_OPTIONS, ...opts };
  onUnhealthy = callback;
  failureCount = 0;

  console.log(chalk.blue(`Health check: ${options.url} (every ${options.interval / 1000}s)`));

  // Initial check after a short delay (let workers start)
  setTimeout(() => {
    performCheck();
    checkInterval = setInterval(performCheck, options.interval);
  }, 5000);
}

/**
 * Stop health checks
 */
export function stopHealthCheck(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  onUnhealthy = null;
}

/**
 * Perform a single health check
 */
async function performCheck(): Promise<void> {
  const result = await checkHealth(options.url, options.timeout, options.expectedStatus);

  if (result.healthy) {
    if (failureCount > 0) {
      console.log(chalk.green(`Health check recovered (${result.latencyMs}ms)`));
    }
    failureCount = 0;
  } else {
    failureCount++;
    console.log(
      chalk.yellow(
        `Health check failed (${failureCount}/${options.threshold}): ${result.error || `status ${result.status}`}`
      )
    );

    if (failureCount >= options.threshold && onUnhealthy) {
      console.log(chalk.red(`Health check threshold reached, triggering callback`));
      onUnhealthy(result);
      failureCount = 0; // Reset after trigger
    }
  }
}

/**
 * Check health of a single endpoint
 */
export function checkHealth(
  url: string,
  timeout: number,
  expectedStatus: number
): Promise<HealthCheckResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const isHttps = url.startsWith('https://');
    const client = isHttps ? https : http;

    // Allow self-signed certificates for localhost/internal checks
    const options = { 
      timeout,
      rejectUnauthorized: false,
    };

    const req = client.get(url, options, (res) => {
      const latencyMs = Date.now() - startTime;
      const healthy = res.statusCode === expectedStatus;

      // Consume response body
      res.resume();

      resolve({
        healthy,
        status: res.statusCode,
        latencyMs,
        error: healthy ? undefined : `unexpected status ${res.statusCode}`,
      });
    });

    req.on('error', (err) => {
      resolve({
        healthy: false,
        error: err.message,
        latencyMs: Date.now() - startTime,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        healthy: false,
        error: 'timeout',
        latencyMs: timeout,
      });
    });
  });
}
