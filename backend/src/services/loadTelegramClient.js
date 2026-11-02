const fs = require('fs');
const path = require('path');
const Module = require('module');
const { stripTypeScriptSource } = require('../lib/stripTypeScriptSource');

let cached = null;

function telegramSourcePath() {
  const candidates = [
    path.join(__dirname, '../../../lib/telegram.ts'),
    path.join(process.cwd(), 'lib/telegram.ts'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Telegram client source lib/telegram.ts is not in the server bundle');
}

function loadTelegramClient() {
  if (cached) return cached;
  const file = telegramSourcePath();
  const source = stripTypeScriptSource(fs.readFileSync(file, 'utf8'));
  if (/\bexport\s+function\b/.test(source) || /\bexport\s+\{/.test(source)) {
    throw new Error('lib/telegram.ts must use module.exports so Express can load it');
  }
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded._compile(source, file);
  cached = loaded.exports;
  return cached;
}

module.exports = { loadTelegramClient, telegramSourcePath };
