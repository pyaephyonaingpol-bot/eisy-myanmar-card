const fs = require('fs');
const path = require('path');
const Module = require('module');

/**
 * Load lib/pagocard.ts from the Express process.
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

function loadPagoCardClient() {
  if (cached) return cached;
  const file = path.join(__dirname, '../../../lib/pagocard.ts');
  const source = stripTypes(fs.readFileSync(file, 'utf8'));
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded._compile(source, file);
  cached = loaded.exports;
  return cached;
}

module.exports = { loadPagoCardClient };
