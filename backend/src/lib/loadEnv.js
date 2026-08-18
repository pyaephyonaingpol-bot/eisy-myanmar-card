/**
 * Load repo + backend env files into process.env before any config checks.
 *
 * Priority (later files win, but never clobber non-empty platform/shell vars):
 *   <repo>/.env
 *   <backend>/.env
 *   <cwd>/.env
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
  return [
    path.join(repoRoot, '.env'),
    path.join(backendDir, '.env'),
    path.join(cwd, '.env'),
    path.join(repoRoot, '.env.local'),
    path.join(backendDir, '.env.local'),
    path.join(cwd, '.env.local'),
  ];
}

function parseEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    return dotenv.parse(fs.readFileSync(filePath));
  } catch {
    return {};
  }
}

function loadEnv({ force = false } = {}) {
  if (loaded && !force) return;
  loaded = true;

  const platformKeys = new Set(
    Object.keys(process.env).filter((key) => String(process.env[key] ?? '').trim() !== '')
  );

  const seen = new Set();
  for (const filePath of envFilePaths()) {
    const resolved = path.resolve(filePath);
    if (seen.has(resolved)) continue;
    seen.add(resolved);

    const parsed = parseEnvFile(resolved);
    for (const [key, value] of Object.entries(parsed)) {
      if (platformKeys.has(key)) continue;
      process.env[key] = value;
    }
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
