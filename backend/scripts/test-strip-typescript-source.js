#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { stripTypeScriptSource } = require('../src/lib/stripTypeScriptSource');

const input = 'const value: number = 42;\nmodule.exports = { value };';
const out = stripTypeScriptSource(input);
assert.ok(!out.includes(': number'), 'types stripped');
assert.ok(out.includes('42'), 'logic preserved');
// eslint-disable-next-line no-new-func
const mod = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', out)(mod, mod.exports);
assert.strictEqual(mod.exports.value, 42);

console.log('test-strip-typescript-source: OK');
