/**
 * Shared domain constants used by the browser UI.
 * Status strings must stay aligned with backend deposit / card enums.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  }
  root.Eisy = root.Eisy || {};
  root.Eisy.constants = Object.freeze({ ...mod });
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  return {
    DEPOSIT_STATUS: Object.freeze({
      PENDING: 'PENDING',
      AWAITING_SCREENSHOT: 'AWAITING_SCREENSHOT',
      SUBMITTED: 'SUBMITTED',
      UNDER_REVIEW: 'UNDER_REVIEW',
      VERIFIED: 'VERIFIED',
      REJECTED: 'REJECTED',
      FAILED: 'FAILED',
      EXPIRED: 'EXPIRED',
    }),

    OPEN_DEPOSIT_STATUSES: Object.freeze([
      'PENDING',
      'AWAITING_SCREENSHOT',
      'SUBMITTED',
      'UNDER_REVIEW',
    ]),

    DEPOSIT_TYPE: Object.freeze({
      USDT: 'usdt',
      MMK: 'mmk',
    }),

    DEPOSIT_CHANNEL: Object.freeze({
      PLATFORM_DIRECT: 'platform_direct',
      BINANCE: 'binance',
      P2P: 'p2p',
    }),

    USDT_PURPOSE: 'usdt_topup',
  };
});
