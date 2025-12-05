/**
 * gpd-runtime
 * 
 * Zero-downtime Node.js cluster runtime.
 * 
 * @example
 * ```bash
 * gpdr start dist/index.js -w 4   # Start with 4 workers
 * gpdr reload                      # Zero-downtime reload
 * gpdr stop                        # Graceful shutdown
 * gpdr status                      # Show status
 * ```
 */

export { startMaster, type MasterOptions } from './master.js';
export { getStatus, type RuntimeStatus, type WorkerStatus } from './ipc.js';
export { readPidFile, writePidFile, removePidFile, PID_FILE } from './pid.js';
