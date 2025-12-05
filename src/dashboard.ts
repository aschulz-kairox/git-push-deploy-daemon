/**
 * Embedded Dashboard HTML
 * 
 * A simple, single-file dashboard for monitoring gpdd status.
 * No build step required - pure HTML/CSS/JS.
 */

export function getDashboardHTML(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>gpdd Dashboard</title>
  <style>
    :root {
      --bg: #0d1117;
      --bg-card: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --green: #3fb950;
      --yellow: #d29922;
      --red: #f85149;
      --blue: #58a6ff;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 2rem;
    }
    
    .container { max-width: 900px; margin: 0 auto; }
    
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }
    
    h1 { font-size: 1.5rem; font-weight: 600; }
    h1 span { color: var(--blue); }
    
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.25rem 0.75rem;
      border-radius: 2rem;
      font-size: 0.875rem;
      font-weight: 500;
    }
    
    .status-badge.online { background: rgba(63, 185, 80, 0.15); color: var(--green); }
    .status-badge.offline { background: rgba(248, 81, 73, 0.15); color: var(--red); }
    
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 6px;
      margin-bottom: 1rem;
    }
    
    .card-header {
      padding: 1rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .card-header h2 {
      font-size: 1rem;
      font-weight: 600;
    }
    
    .card-body { padding: 1rem; }
    
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
    }
    
    .info-item label {
      display: block;
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }
    
    .info-item value {
      display: block;
      font-size: 1.25rem;
      font-weight: 600;
    }
    
    .workers-table {
      width: 100%;
      border-collapse: collapse;
    }
    
    .workers-table th {
      text-align: left;
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.5rem;
      border-bottom: 1px solid var(--border);
    }
    
    .workers-table td {
      padding: 0.75rem 0.5rem;
      border-bottom: 1px solid var(--border);
    }
    
    .workers-table tr:last-child td { border-bottom: none; }
    
    .worker-state {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.125rem 0.5rem;
      border-radius: 4px;
      font-size: 0.875rem;
    }
    
    .worker-state.ready { background: rgba(63, 185, 80, 0.15); color: var(--green); }
    .worker-state.starting { background: rgba(210, 153, 34, 0.15); color: var(--yellow); }
    .worker-state.draining { background: rgba(248, 81, 73, 0.15); color: var(--red); }
    
    .actions {
      display: flex;
      gap: 0.5rem;
    }
    
    .btn {
      padding: 0.5rem 1rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text);
      font-size: 0.875rem;
      cursor: pointer;
      transition: all 0.15s;
    }
    
    .btn:hover { background: var(--border); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    
    .btn-primary {
      background: var(--blue);
      border-color: var(--blue);
      color: #fff;
    }
    
    .btn-primary:hover { background: #4393e6; }
    
    .btn-danger { border-color: var(--red); color: var(--red); }
    .btn-danger:hover { background: rgba(248, 81, 73, 0.15); }
    
    .toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      padding: 1rem 1.5rem;
      border-radius: 6px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s;
    }
    
    .toast.show { transform: translateY(0); opacity: 1; }
    .toast.success { border-color: var(--green); }
    .toast.error { border-color: var(--red); }
    
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 3rem;
      color: var(--text-muted);
    }
    
    .spinner {
      width: 24px;
      height: 24px;
      border: 2px solid var(--border);
      border-top-color: var(--blue);
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-right: 0.75rem;
    }
    
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1><span>gpdd</span> Dashboard</h1>
      <div id="connection-status" class="status-badge offline">
        <span class="status-dot"></span>
        <span>Connecting...</span>
      </div>
    </header>
    
    <div id="app">
      <div class="loading">
        <div class="spinner"></div>
        Loading...
      </div>
    </div>
  </div>
  
  <div id="toast" class="toast"></div>
  
  <script>
    const API_BASE = 'http://127.0.0.1:${port}';
    let lastStatus = null;
    
    function formatUptime(startTime) {
      const seconds = Math.floor((Date.now() - startTime) / 1000);
      if (seconds < 60) return seconds + 's';
      if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return hours + 'h ' + mins + 'm';
    }
    
    function showToast(message, type = 'success') {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast show ' + type;
      setTimeout(() => toast.classList.remove('show'), 3000);
    }
    
    function updateConnectionStatus(online) {
      const el = document.getElementById('connection-status');
      if (online) {
        el.className = 'status-badge online';
        el.innerHTML = '<span class="status-dot"></span><span>Connected</span>';
      } else {
        el.className = 'status-badge offline';
        el.innerHTML = '<span class="status-dot"></span><span>Disconnected</span>';
      }
    }
    
    async function fetchStatus() {
      try {
        const res = await fetch(API_BASE + '/status');
        const status = await res.json();
        lastStatus = status;
        updateConnectionStatus(true);
        renderStatus(status);
      } catch (e) {
        updateConnectionStatus(false);
        renderError();
      }
    }
    
    async function sendCommand(cmd) {
      try {
        const res = await fetch(API_BASE + '/' + cmd, { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          showToast(cmd.charAt(0).toUpperCase() + cmd.slice(1) + ' command sent');
          setTimeout(fetchStatus, 500);
        } else {
          showToast('Command failed: ' + (data.error || 'Unknown error'), 'error');
        }
      } catch (e) {
        showToast('Connection error', 'error');
      }
    }
    
    function renderStatus(status) {
      const app = document.getElementById('app');
      
      const workersHTML = status.workers.map(w => \`
        <tr>
          <td>#\${w.id}</td>
          <td>\${w.pid}</td>
          <td><span class="worker-state \${w.state}">\${w.state}</span></td>
          <td>\${formatUptime(w.startTime)}</td>
        </tr>
      \`).join('');
      
      app.innerHTML = \`
        <div class="card">
          <div class="card-header">
            <h2>Master Process</h2>
            <div class="actions">
              <button class="btn btn-primary" onclick="sendCommand('reload')">↻ Reload</button>
              <button class="btn btn-danger" onclick="sendCommand('stop')">◼ Stop</button>
            </div>
          </div>
          <div class="card-body">
            <div class="info-grid">
              <div class="info-item">
                <label>Application</label>
                <value>\${status.appFile.split(/[\\\\/]/).pop()}</value>
              </div>
              <div class="info-item">
                <label>Workers</label>
                <value>\${status.workers.length}</value>
              </div>
              <div class="info-item">
                <label>Uptime</label>
                <value>\${formatUptime(status.startTime)}</value>
              </div>
              <div class="info-item">
                <label>Ready Workers</label>
                <value>\${status.workers.filter(w => w.state === 'ready').length} / \${status.workers.length}</value>
              </div>
            </div>
          </div>
        </div>
        
        <div class="card">
          <div class="card-header">
            <h2>Workers</h2>
          </div>
          <div class="card-body" style="padding: 0;">
            <table class="workers-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>PID</th>
                  <th>State</th>
                  <th>Uptime</th>
                </tr>
              </thead>
              <tbody>
                \${workersHTML || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No workers</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
        
        <div class="card">
          <div class="card-header">
            <h2>Details</h2>
          </div>
          <div class="card-body">
            <div class="info-grid">
              <div class="info-item">
                <label>Full Path</label>
                <value style="font-size: 0.875rem; word-break: break-all;">\${status.appFile}</value>
              </div>
            </div>
          </div>
        </div>
      \`;
    }
    
    function renderError() {
      document.getElementById('app').innerHTML = \`
        <div class="card">
          <div class="card-body">
            <div class="loading">
              <span style="color: var(--red);">⚠ Cannot connect to gpdd. Is the process running?</span>
            </div>
          </div>
        </div>
      \`;
    }
    
    // Initial fetch and polling
    fetchStatus();
    setInterval(fetchStatus, 2000);
  </script>
</body>
</html>`;
}
