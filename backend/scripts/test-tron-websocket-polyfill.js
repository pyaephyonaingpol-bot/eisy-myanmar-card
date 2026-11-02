#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { installTronWebSocketPolyfill } = require('../src/lib/tronWebSocket');

const prev = globalThis.WebSocket;
try {
  delete globalThis.WebSocket;
} catch (_) {
  globalThis.WebSocket = undefined;
}

installTronWebSocketPolyfill();
assert.strictEqual(typeof globalThis.WebSocket, 'function', 'WebSocket polyfill installed');

if (prev) globalThis.WebSocket = prev;

console.log('test-tron-websocket-polyfill: OK');
