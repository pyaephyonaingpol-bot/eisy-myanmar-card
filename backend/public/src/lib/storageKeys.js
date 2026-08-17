/**
 * localStorage / session key names — single source of truth for the SPA.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  }
  root.Eisy = root.Eisy || {};
  root.Eisy.storageKeys = Object.freeze({ ...mod });
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  return {
    AUTH: 'eisy_auth',
    BIO_TOKEN: 'eisy_bio_token',
    DEVICE: 'eisy_device',
    LANG: 'eisy_lang',
    USER_CARDS: 'eisy_user_cards',
    ADMIN_TOKEN: 'eisy_admin_token',
    ADMIN_KEY_LEGACY: 'eisy_admin_key',
    PENDING_DEPOSIT: 'eisy_pending_deposit',
    DEPOSIT_DRAFTS: 'eisy_deposit_drafts',
    TEST_DEPOSITS: 'eisy_test_deposits',
    DEPOSIT_RECEIPT: 'eisy_deposit_receipt',
  };
});
