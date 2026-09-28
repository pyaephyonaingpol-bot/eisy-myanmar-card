/**
 * Instant Card (Non-KYC) API — Master Wallet + Kripicard only.
 * Does not call KYC-provider / Business Card endpoints.
 */
(function (root) {
  'use strict';

  root.EisyServices = root.EisyServices || {};
  const api = () => root.EisyServices.api;

  root.EisyServices.instantCard = {
    getPricing() {
      return api().request('GET', '/api/user/card/pricing-kripicard');
    },
    getBins() {
      return api().request('GET', '/api/user/card/bins');
    },
    requestCard(body) {
      return api().request('POST', '/api/user/card/request-instant', body, { sensitive: true });
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
