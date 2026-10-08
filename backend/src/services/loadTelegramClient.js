const fs = require('fs');
const path = require('path');
const Module = require('module');

/**
 * Load lib/telegram.ts from the Express process.
 * Node 22.14 can strip the types, but the server is not started with
 * --experimental-strip-types, so this compiles the file in-process.
 */
function stripTypes(source) {
  const emitWarning = process.emitWarning;
  process.emitWarning = function hideStripWarning(warning, type, code, ...rest) {
    const message = typeof warning === 'string' ? warning : warning && warning.message;
    const name = type || (warning && warning.name) || code;
    if (name === 'ExperimentalWarning' && /stripTypeScriptTypes/.test(String(message || ''))) {
      return undefined;
    }
    return emitWarning.call(process, warning, type, code, ...rest);
  };
  try {
    return Module.stripTypeScriptTypes(source);
  } finally {
    process.emitWarning = emitWarning;
  }
}

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
  const source = stripTypes(fs.readFileSync(file, 'utf8'));
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
