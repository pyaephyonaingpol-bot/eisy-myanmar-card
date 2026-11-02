'use strict';

const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

/**
 * Strip TypeScript types from source for in-process _compile (Node 20 / 22).
 * Prefers Module.stripTypeScriptTypes (Node 22+). Falls back to a child process
 * with --experimental-strip-types, then typescript.transpileModule if installed.
 */
function stripTypeScriptSource(source) {
  const text = String(source);

  if (typeof Module.stripTypeScriptTypes === 'function') {
    return Module.stripTypeScriptTypes(text);
  }

  try {
    return stripViaTypescriptCompiler(text);
  } catch (_) {
    /* fall through to Node CLI attempt */
  }

  const tmpDir = os.tmpdir();
  const id = crypto.randomBytes(8).toString('hex');
  const tmpFile = path.join(tmpDir, `eisy-strip-${id}.ts`);
  fs.writeFileSync(tmpFile, text, 'utf8');
  try {
    const childScript = `
      const fs = require('fs');
      const Module = require('module');
      const src = fs.readFileSync(process.argv[1], 'utf8');
      if (typeof Module.stripTypeScriptTypes !== 'function') {
        console.error('NO_STRIP_API');
        process.exit(2);
      }
      process.stdout.write(Module.stripTypeScriptTypes(src));
    `;
    return execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', '-e', childScript, tmpFile],
      { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
    );
  } catch (err) {
    if (String(err.stderr || err.message || '').includes('NO_STRIP_API')) {
      return stripViaTypescriptCompiler(text);
    }
    throw err;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch (_) {
      /* ignore */
    }
  }
}

function stripViaTypescriptCompiler(source) {
  try {
    // Optional dev/build dependency — avoids hard failure on Node 20 without strip API.
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    const ts = require('typescript');
    const out = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    });
    return out.outputText;
  } catch (err) {
    const wrapped = new Error(
      'Cannot strip TypeScript for lib/*.ts loaders. Use Node.js 22+ or add the typescript package.'
    );
    wrapped.code = 'STRIP_TYPES_UNAVAILABLE';
    wrapped.cause = err;
    throw wrapped;
  }
}

module.exports = { stripTypeScriptSource };
