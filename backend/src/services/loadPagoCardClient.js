const fs = require('fs');
const path = require('path');
const Module = require('module');
const { stripTypeScriptSource } = require('../lib/stripTypeScriptSource');

/**
 * Load lib/pagocard.ts from the Express process (Node 20 / 22 without --experimental-strip-types).
 */

let cached = null;

function pagoCardSourcePath() {
  const candidates = [
    path.join(__dirname, '../../../lib/pagocard.ts'),
    path.join(process.cwd(), 'lib/pagocard.ts'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Pago Card client source lib/pagocard.ts is not in the server bundle');
}

function loadPagoCardClient() {
  if (cached) return cached;
  const file = pagoCardSourcePath();
  const source = stripTypeScriptSource(fs.readFileSync(file, 'utf8'));
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded._compile(source, file);
  cached = loaded.exports;
  return cached;
}

module.exports = { loadPagoCardClient };
