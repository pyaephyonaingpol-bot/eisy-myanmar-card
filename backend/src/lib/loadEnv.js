/**
 * Load repo + backend env files into process.env before any config checks.
 *
 * Priority (later files win). Non-empty platform/shell vars are kept, except
 * KRIPICARD_API_KEY: a value in .env or .env.local always replaces a stale
 * Cloud Agent / shell secret so a restarted process picks up the file.
 *   <repo>/.env
 *   <backend>/.env
 *   <cwd>/.env
 *   <repo>/.env.local
 *   <backend>/.env.local
 *   <cwd>/.env.local
 */
/**
 * Keys whose file value replaces an already-injected platform/shell value.
 * Later files still win over earlier files.
 */
const FILE_OVERRIDES_PLATFORM = new Set([
  'KRIPICARD_API_KEY',
  'CARD_API_KEY',
  'KRIPICARD_BASE_URL',
  'CARD_BASE_URL',
]);
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
      if (platformKeys.has(key) && !FILE_OVERRIDES_PLATFORM.has(key)) continue;
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
