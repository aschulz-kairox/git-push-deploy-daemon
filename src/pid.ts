/**
 * PID file management
 * 
 * Simple PID file in current directory for process discovery.
 */

import fs from 'node:fs';
import path from 'node:path';

export const PID_FILE = path.resolve('.gpd-runtime.pid');

/**
 * Write PID to file
 */
export function writePidFile(pid: number): void {
  fs.writeFileSync(PID_FILE, pid.toString(), 'utf-8');
}

/**
 * Read PID from file
 */
export function readPidFile(): number | null {
  try {
    const content = fs.readFileSync(PID_FILE, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Remove PID file
 */
export function removePidFile(): void {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // Ignore if already gone
  }
}
