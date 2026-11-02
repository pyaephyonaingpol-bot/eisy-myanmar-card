'use strict';

const { installTronWebSocketPolyfill } = require('./tronWebSocket');

installTronWebSocketPolyfill();

const { TronWeb } = require('tronweb');
const { tronFullHost, tronGridApiKeyHeaders, sanitizeAsciiHeaderValue } = require('./envAliases');

const DEFAULT_TRONGRID_HOST = 'https://api.trongrid.io';

/**
 * TronWeb options for TronGrid.
 * API key: TRON_PRO_API_KEY || TRONGRID_API_KEY (and TRON_API_KEY alias via tronApiKey()).
 */
function buildTronWebOptions({ privateKey, fullHost } = {}) {
  const host = sanitizeAsciiHeaderValue(fullHost || tronFullHost() || DEFAULT_TRONGRID_HOST)
    .replace(/\/$/, '');
  const options = {
    fullHost: host || DEFAULT_TRONGRID_HOST,
    headers: { ...tronGridApiKeyHeaders() },
  };
  if (privateKey != null && String(privateKey).trim() !== '') {
    options.privateKey = String(privateKey).trim().replace(/^0x/i, '').replace(/\s+/g, '');
  }
  return options;
}

/** Sole production entry point for `new TronWeb(...)` in backend services and lib/. */
function createTronWeb({ privateKey, fullHost } = {}) {
  return new TronWeb(buildTronWebOptions({ privateKey, fullHost }));
}

module.exports = {
  TronWeb,
  DEFAULT_TRONGRID_HOST,
  buildTronWebOptions,
  createTronWeb,
};
