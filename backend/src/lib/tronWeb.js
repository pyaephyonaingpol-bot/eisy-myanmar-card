'use strict';

const { installTronWebSocketPolyfill } = require('./tronWebSocket');

installTronWebSocketPolyfill();

const { TronWeb } = require('tronweb');
const { tronFullHost, tronGridApiKeyHeaders } = require('./envAliases');

/**
 * TronWeb options for TronGrid: fullHost + TRON-PRO-API-KEY (from TRON_PRO_API_KEY / TRONGRID_API_KEY / TRON_API_KEY).
 */
function buildTronWebOptions({ privateKey, fullHost } = {}) {
  const host = String(fullHost || tronFullHost() || 'https://api.trongrid.io').replace(/\/$/, '');
  const options = {
    fullHost: host,
    headers: { ...tronGridApiKeyHeaders() },
  };
  if (privateKey != null && String(privateKey).trim() !== '') {
    options.privateKey = privateKey;
  }
  return options;
}

function createTronWeb({ privateKey, fullHost } = {}) {
  return new TronWeb(buildTronWebOptions({ privateKey, fullHost }));
}

module.exports = {
  TronWeb,
  buildTronWebOptions,
  createTronWeb,
};
