'use strict';

let installed = false;

/**
 * TronWeb expects a WebSocket implementation in Node (event subscriptions).
 * Install the `ws` package polyfill once per process.
 */
function installTronWebSocketPolyfill() {
  if (installed) return;
  installed = true;
  if (typeof globalThis.WebSocket !== 'undefined') return;
  try {
    // eslint-disable-next-line global-require
    const WebSocket = require('ws');
    globalThis.WebSocket = WebSocket;
  } catch (err) {
    console.warn(
      '[tron] WebSocket polyfill skipped — install the ws package for full TronWeb support:',
      err.message
    );
  }
}

module.exports = { installTronWebSocketPolyfill };
