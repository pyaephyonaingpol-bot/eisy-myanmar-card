/**
 * Shared frontend configuration (no secrets).
 * API keys that belong on the server stay in backend env — never put private keys here.
 *
 * Attaches to window.Eisy.config for classic scripts; also supports ES import later.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  }
  root.Eisy = root.Eisy || {};
  root.Eisy.config = Object.freeze({ ...mod });
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  return {
    /** Production API origin used by native Capacitor shells */
    PRODUCTION_API: 'https://eisymyanmar.com',
    /**
     * Native/local API base: set window.EISY_API_BASE_OVERRIDE at runtime
     * (e.g. Capacitor Android emulator). Keep clear-text origins out of this
     * file so the HTTPS SPA never downloads them as hardcoded strings.
     */
    /** Optional runtime override: window.EISY_API_BASE_OVERRIDE */
    API_BASE_OVERRIDE_GLOBAL: 'EISY_API_BASE_OVERRIDE',
    /** Resolved base assigned by apiConfig bootstrap */
    API_BASE_GLOBAL: 'EISY_API_BASE',

    APP_NAME: 'Eisy Myanmar',
    DEFAULT_LANG: 'en',

    /** Client-side fee preview defaults (server remains source of truth) */
    DEFAULT_PAYMENT_SERVICE_FEE_PERCENT: 2,
    DEFAULT_PAYMENT_SERVICE_FEE_MINIMUM_USDT: 1,
    DEFAULT_MINIMUM_USDT_DEPOSIT: 5,
    DEFAULT_MINIMUM_USDT_WITHDRAWAL: 10,
    DEFAULT_MINIMUM_USDT_RELOAD: 5,

    NETWORKS: Object.freeze({
      TRC20: 'TRC20',
      BANK: 'BANK',
    }),
  };
});
