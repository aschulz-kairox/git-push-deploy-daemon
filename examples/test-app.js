/**
 * Test application for gpd-runtime
 */

import http from 'node:http';

const PORT = process.env.PORT || 3000;

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    pid: process.pid,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }));
});

server.listen(PORT, () => {
  console.log(`[Worker ${process.pid}] Listening on port ${PORT}`);
  
  // Tell master we're ready
  if (process.send) {
    process.send('ready');
  }
});

// Handle graceful shutdown
process.on('message', (msg) => {
  if (msg === 'shutdown') {
    console.log(`[Worker ${process.pid}] Shutting down...`);
    server.close(() => {
      console.log(`[Worker ${process.pid}] Goodbye!`);
      process.exit(0);
    });
  }
});

// Handle SIGTERM/SIGINT (for non-cluster usage)
process.on('SIGTERM', () => {
  console.log(`[Worker ${process.pid}] SIGTERM received`);
  server.close(() => process.exit(0));
});
