/**
 * Load repo + backend env files into process.env before any config checks.
 *
 * Base files never clobber non-empty platform/shell vars:
 *   <repo>/.env
 *   <backend>/.env
 *   <cwd>/.env
 *
 * Local overrides (.env.local) intentionally replace platform/shell values so a
 * regenerated dashboard key in .env.local wins over a stale Cloud Agent secret:
 *   <repo>/.env.local
 *   <backend>/.env.local
 *   <cwd>/.env.local
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

let loaded = false;

function envFilePaths() {
  const backendDir = path.join(__dirname, '..', '..');
  const repoRoot = path.join(backendDir, '..');
  const cwd = process.cwd();
  return {
    base: [
      path.join(repoRoot, '.env'),
      path.join(backendDir, '.env'),
      path.join(cwd, '.env'),
    ],
    local: [
      path.join(repoRoot, '.env.local'),
      path.join(backendDir, '.env.local'),
      path.join(cwd, '.env.local'),
    ],
  };
}

function parseEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    return dotenv.parse(fs.readFileSync(filePath));
  } catch {
    return {};
  }
}

function applyEnvFile(filePath, { override } = { override: false }) {
  const parsed = parseEnvFile(filePath);
  for (const [key, value] of Object.entries(parsed)) {
    if (!override && String(process.env[key] ?? '').trim() !== '') continue;
    process.env[key] = value;
  }
}

function loadEnv({ force = false } = {}) {
  if (loaded && !force) return;
  loaded = true;

  const { base, local } = envFilePaths();
  const seen = new Set();

  for (const filePath of base) {
    const resolved = path.resolve(filePath);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    applyEnvFile(resolved, { override: false });
  }

  for (const filePath of local) {
    const resolved = path.resolve(filePath);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    applyEnvFile(resolved, { override: true });
  }
}

function resetLoadEnvForTests() {
  loaded = false;
}

loadEnv();

module.exports = {
  loadEnv,
  resetLoadEnvForTests,
};
