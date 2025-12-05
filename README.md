# git-push-deploy-daemon

Zero-downtime Node.js cluster daemon. The process management companion to [git-push-deploy-cli](https://github.com/aschulz-kairox/git-push-deploy-cli).

## Why?

PM2 is great, but sometimes you want:

- **Simplicity** - No background daemon, no global state, just a process
- **Transparency** - Cluster logic you can understand and debug
- **Integration** - Works seamlessly with gpd deployments

## Installation

```bash
npm install -g git-push-deploy-daemon
```

## Usage

### Start Application

```bash
# Start with 4 workers (default: CPU count)
gpdd start app.js --workers 4

# With environment
NODE_ENV=production gpdd start dist/index.js
```

### Zero-Downtime Reload

```bash
# Reload all workers one by one (no dropped connections)
gpdd reload

# Or send SIGHUP to master process
kill -HUP $(cat .gpdd.pid)
```

### Other Commands

```bash
gpdd status    # Show master + worker status
gpdd stop      # Graceful shutdown
```

## How It Works

```text
┌─────────────────────────────────────────────────┐
│                    Master                        │
│  • Holds the server socket                      │
│  • Manages worker lifecycle                      │
│  • Handles reload signals (SIGHUP)              │
└─────────────────────────────────────────────────┘
          │                    │
    ┌─────┴─────┐        ┌─────┴─────┐
    │  Worker 1  │        │  Worker 2  │
    │  (app.js)  │        │  (app.js)  │
    └───────────┘        └───────────┘
```

### Reload Process

1. Fork new worker
2. Wait for "ready" signal from new worker
3. Send "shutdown" to old worker
4. Old worker stops accepting connections
5. Old worker finishes existing requests
6. Old worker exits
7. Repeat for next worker

**Result:** Zero dropped connections!

## Integration with git-push-deploy-cli

```json
// .git-deploy.json
{
  "services": {
    "my-api": {
      "processManager": "gpdd",
      "entryPoint": "dist/index.js",
      "workers": 4
    }
  }
}
```

Then `gpd deploy` will use `gpdd reload` instead of `pm2 reload`.

## Application Requirements

Your app should signal when it's ready:

```javascript
// Express example
const server = app.listen(PORT, () => {
  // Tell master we're ready to receive traffic
  if (process.send) {
    process.send('ready');
  }
});

// Handle graceful shutdown
process.on('message', (msg) => {
  if (msg === 'shutdown') {
    server.close(() => {
      process.exit(0);
    });
  }
});
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GPDD_WORKERS` | Number of workers | CPU count |
| `GPDD_GRACE_TIMEOUT` | Shutdown timeout (ms) | 30000 |
| `GPDD_READY_TIMEOUT` | Worker ready timeout (ms) | 10000 |

## Signals

| Signal | Action |
|--------|--------|
| `SIGHUP` | Zero-downtime reload |
| `SIGTERM` | Graceful shutdown |
| `SIGINT` | Graceful shutdown |

## License

MIT
