/**
 * IPC for status queries
 * 
 * For now, we use signals only (no socket).
 * Status can be obtained by reading PID file and checking process.
 * 
 * Future: Could add HTTP status endpoint or named pipes.
 */

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

// Placeholder for future status server implementation
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let statusCallback: (() => RuntimeStatus) | null = null;

/**
 * Start status server (called by master)
 * For now, just stores the callback for later use
 */
export function startStatusServer(getStatus: () => RuntimeStatus): Promise<void> {
  statusCallback = getStatus;
  return Promise.resolve();
}

/**
 * Stop status server
 */
export function stopStatusServer(): void {
  statusCallback = null;
}

/**
 * Query status from master (called by CLI)
 * 
 * For now, returns null (no IPC implemented yet).
 * The CLI will fall back to just showing PID info.
 */
export function getStatus(_pid: number): Promise<RuntimeStatus | null> {
  // TODO: Implement cross-platform IPC (HTTP on localhost, named pipes, etc.)
  return Promise.resolve(null);
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
