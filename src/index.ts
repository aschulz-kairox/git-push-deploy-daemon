/**
 * git-push-deploy-daemon
 * 
 * Zero-downtime Node.js cluster daemon.
 * 
 * @example
 * ```bash
 * gpdd start dist/index.js -w 4   # Start with 4 workers
 * gpdd start dist/index.js --health-url http://localhost:3000/health
 * gpdd reload                      # Zero-downtime reload
 * gpdd stop                        # Graceful shutdown
 * gpdd status                      # Show status
 * ```
 */

export { startMaster, type MasterOptions } from './master.js';
export { getStatus, type RuntimeStatus, type WorkerStatus } from './ipc.js';
export { readPidFile, writePidFile, removePidFile, PID_FILE } from './pid.js';
export { startHealthCheck, stopHealthCheck, checkHealth, type HealthCheckOptions, type HealthCheckResult } from './health.js';
