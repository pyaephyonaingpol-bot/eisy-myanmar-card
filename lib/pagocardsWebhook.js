/**
 * Re-export the canonical CommonJS helper.
 * Implementation lives in pagocardsWebhook.cjs so bundlers cannot alias
 * this path back onto lib/pagocardsWebhook.ts.
 */
'use strict';

module.exports = require('./pagocardsWebhook.cjs');
