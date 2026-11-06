'use strict';

const { installTronWebSocketPolyfill } = require('./tronWebSocket');

installTronWebSocketPolyfill();

const { TronWeb } = require('tronweb');

module.exports = { TronWeb };
