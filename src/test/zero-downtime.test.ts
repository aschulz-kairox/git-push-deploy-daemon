/**
 * Zero-Downtime Reload Test
 * 
 * This test verifies that no requests are dropped during a reload.
 * 
 * Usage:
 *   1. Start the test service: gpdd start examples/server.js -w 2
 *   2. Run this test: node dist/test/zero-downtime.test.js
 *   3. While running, trigger reload: gpdd reload
 * 
 * The test should report 0 failed requests even during reload.
 */

import http from 'node:http';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:3000';
const DURATION_MS = parseInt(process.env.TEST_DURATION || '10000', 10);
const CONCURRENCY = parseInt(process.env.TEST_CONCURRENCY || '10', 10);
const REQUEST_INTERVAL_MS = parseInt(process.env.TEST_INTERVAL || '10', 10);

interface TestResult {
  total: number;
  success: number;
  failed: number;
  errors: Map<string, number>;
  latencies: number[];
}

const result: TestResult = {
  total: 0,
  success: 0,
  failed: 0,
  errors: new Map(),
  latencies: [],
};

function makeRequest(): Promise<void> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    result.total++;

    const req = http.get(TARGET_URL, { timeout: 5000 }, (res) => {
      const latency = Date.now() - startTime;
      result.latencies.push(latency);

      res.resume();

      if (res.statusCode === 200) {
        result.success++;
      } else {
        result.failed++;
        const error = `HTTP ${res.statusCode}`;
        result.errors.set(error, (result.errors.get(error) || 0) + 1);
      }
      resolve();
    });

    req.on('error', (err) => {
      result.failed++;
      const error = err.message;
      result.errors.set(error, (result.errors.get(error) || 0) + 1);
      resolve();
    });

    req.on('timeout', () => {
      req.destroy();
      result.failed++;
      const error = 'timeout';
      result.errors.set(error, (result.errors.get(error) || 0) + 1);
      resolve();
    });
  });
}

async function runWorker(): Promise<void> {
  const endTime = Date.now() + DURATION_MS;

  while (Date.now() < endTime) {
    await makeRequest();
    await new Promise((r) => setTimeout(r, REQUEST_INTERVAL_MS));
  }
}

function printResults(): void {
  const avgLatency =
    result.latencies.length > 0
      ? result.latencies.reduce((a, b) => a + b, 0) / result.latencies.length
      : 0;

  const p95Latency =
    result.latencies.length > 0
      ? result.latencies.sort((a, b) => a - b)[Math.floor(result.latencies.length * 0.95)]
      : 0;

  console.log('\n=== Zero-Downtime Test Results ===\n');
  console.log(`Duration:     ${DURATION_MS / 1000}s`);
  console.log(`Concurrency:  ${CONCURRENCY}`);
  console.log(`Target:       ${TARGET_URL}`);
  console.log('');
  console.log(`Total:        ${result.total}`);
  console.log(`Success:      ${result.success} (${((result.success / result.total) * 100).toFixed(2)}%)`);
  console.log(`Failed:       ${result.failed} (${((result.failed / result.total) * 100).toFixed(2)}%)`);
  console.log('');
  console.log(`Avg Latency:  ${avgLatency.toFixed(2)}ms`);
  console.log(`P95 Latency:  ${p95Latency}ms`);

  if (result.errors.size > 0) {
    console.log('\nErrors:');
    for (const [error, count] of result.errors) {
      console.log(`  ${error}: ${count}`);
    }
  }

  console.log('\n');

  if (result.failed === 0) {
    console.log('✅ PASS: Zero requests dropped!');
    process.exit(0);
  } else {
    console.log(`❌ FAIL: ${result.failed} requests dropped`);
    process.exit(1);
  }
}

async function main() {
  console.log(`Starting zero-downtime test...`);
  console.log(`Target: ${TARGET_URL}`);
  console.log(`Duration: ${DURATION_MS / 1000}s, Concurrency: ${CONCURRENCY}`);
  console.log('');
  console.log('TIP: Run "gpdd reload" during this test to verify zero-downtime reload');
  console.log('');

  // Start concurrent workers
  const workers = Array.from({ length: CONCURRENCY }, () => runWorker());

  // Wait for all workers to finish
  await Promise.all(workers);

  printResults();
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
