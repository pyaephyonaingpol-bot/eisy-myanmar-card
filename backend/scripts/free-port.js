/**
 * Frees the backend listen port before `npm run dev` (predev hook).
 * Works on Windows, Linux, and macOS so a leftover node process cannot
 * block restart with EADDRINUSE.
 */
const { execSync } = require('child_process');

const port = Number(process.env.PORT) || 3000;
const selfPid = String(process.pid);

function uniquePids(pids) {
  return [...new Set(
    (pids || [])
      .map((p) => String(p || '').trim())
      .filter((pid) => /^\d+$/.test(pid) && pid !== '0' && pid !== selfPid)
  )];
}

function sleepMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* spin */
    }
  }
}

function killPids(pids, { force = false } = {}) {
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
      } else {
        process.kill(Number(pid), force ? 'SIGKILL' : 'SIGTERM');
      }
      console.log(
        force
          ? `[predev] Force-stopped PID ${pid} on port ${port}`
          : `[predev] Stopped PID ${pid} on port ${port}`
      );
    } catch (_) {
      /* already gone */
    }
  }
}

function freePortWin32() {
  try {
    const output = execSync(`netstat -ano | findstr ":${port}"`, { encoding: 'utf8' });
    const pids = [];
    for (const line of output.split('\n')) {
      if (!line.includes('LISTENING')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid) pids.push(pid);
    }
    killPids(uniquePids(pids), { force: true });
  } catch (_) {
    /* port not in use — OK */
  }
}

/**
 * Prefer lsof (available here and on most macOS/Linux boxes).
 * Fall back to fuser, then ss.
 */
function findListenPidsUnix() {
  const pids = [];

  try {
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    pids.push(...out.trim().split(/\s+/));
  } catch (_) {
    /* try next */
  }

  if (!pids.length) {
    try {
      const out = execSync(`fuser ${port}/tcp`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      pids.push(...(String(out || '').match(/\d+/g) || []));
    } catch (err) {
      const combined = `${err.stderr || ''} ${err.stdout || ''}`;
      pids.push(...(combined.match(/\b\d+\b/g) || []));
    }
  }

  if (!pids.length) {
    try {
      const out = execSync(`ss -tlnp 'sport = :${port}'`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const match of out.matchAll(/pid=(\d+)/g)) {
        pids.push(match[1]);
      }
    } catch (_) {
      /* port not in use — OK */
    }
  }

  return uniquePids(pids);
}

function freePortUnix() {
  let pids = findListenPidsUnix();
  if (!pids.length) return;

  killPids(pids, { force: false });
  sleepMs(250);

  pids = findListenPidsUnix();
  if (pids.length) {
    killPids(pids, { force: true });
    sleepMs(150);
  }
}

if (process.platform === 'win32') {
  freePortWin32();
} else {
  freePortUnix();
}
