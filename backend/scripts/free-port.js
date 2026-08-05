/**
 * Frees the backend port before dev restart (Windows-friendly).
 * Skipped if PORT is set to something other than default via env.
 */
const { execSync } = require('child_process');

const port = Number(process.env.PORT) || 3000;

function freePortWin32() {
  try {
    const output = execSync(`netstat -ano | findstr ":${port}"`, { encoding: 'utf8' });
    const pids = new Set();

    for (const line of output.split('\n')) {
      if (!line.includes('LISTENING')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== '0') {
        pids.add(pid);
      }
    }

    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        console.log(`[predev] Stopped PID ${pid} on port ${port}`);
      } catch (_) {
        /* already gone */
      }
    }
  } catch (_) {
    /* port not in use — OK */
  }
}

if (process.platform === 'win32') {
  freePortWin32();
}
