/**
 * Card creation + crypto deposit gateways are Kripicard-only.
 * Bitnob (sometimes misspelled Bitnod) dual-wallet / Standard Card paths are retired.
 */
'use strict';

const RETIRED_CARD_DEPOSIT_PROVIDERS = new Set([
  'bitnob',
  'bitnod',
  'standard',
  'standard_card',
  'standard-card',
]);

function normalizeProviderName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function isRetiredCardDepositProvider(value) {
  return RETIRED_CARD_DEPOSIT_PROVIDERS.has(normalizeProviderName(value));
}

/**
 * Reject request bodies that still try to route card issue / deposits to Bitnob.
 * @returns {null|Error}
 */
function retiredProviderError(body = {}) {
  const candidates = [
    body.provider,
    body.card_provider,
    body.cardProvider,
    body.gateway,
    body.deposit_provider,
    body.depositProvider,
    body.pipeline,
  ];
  for (const value of candidates) {
    if (!isRetiredCardDepositProvider(value)) continue;
    const err = new Error(
      'Bitnob is no longer supported. Card creation and deposits use the Kripicard API only.'
    );
    err.code = 'BITNOB_RETIRED';
    err.provider = normalizeProviderName(value);
    return err;
  }
  return null;
}

function assertKripicardOnlyProvider(body = {}) {
  const err = retiredProviderError(body);
  if (err) throw err;
}

module.exports = {
  RETIRED_CARD_DEPOSIT_PROVIDERS,
  normalizeProviderName,
  isRetiredCardDepositProvider,
  retiredProviderError,
  assertKripicardOnlyProvider,
};
