'use strict';

const { installTronWebSocketPolyfill } = require('./tronWebSocket');

installTronWebSocketPolyfill();

const { TronWeb } = require('tronweb');
const { tronApiKey, tronFullHost } = require('./envAliases');

const DEFAULT_TRONGRID_HOST = 'https://api.trongrid.io';

/**
 * TronWeb options for TronGrid.
 * API key: TRON_PRO_API_KEY || TRONGRID_API_KEY (and TRON_API_KEY alias via tronApiKey()).
 */
function buildTronWebOptions({ privateKey, fullHost } = {}) {
  const host = String(fullHost || tronFullHost() || DEFAULT_TRONGRID_HOST).replace(/\/$/, '');
  const apiKey = tronApiKey();
  const headers = {};
  if (apiKey) {
    headers['TRON-PRO-API-KEY'] = apiKey;
  }
  const options = { fullHost: host, headers };
  if (privateKey != null && String(privateKey).trim() !== '') {
    options.privateKey = privateKey;
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
