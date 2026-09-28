/**
 * Business Card (KYC) API — Bitnob wallet + Bitnob issuance only.
 * Does not call Non-KYC Instant / Master Wallet issue endpoints.
 * Internal route paths remain `/api/user/wallets/standard/*`.
 */
(function (root) {
  'use strict';

  root.EisyServices = root.EisyServices || {};
  const api = () => root.EisyServices.api;

  root.EisyServices.standardCard = {
    getPricing() {
      return api().request('GET', '/api/user/card/pricing');
    },
    requestCard(body) {
      return api().request('POST', '/api/user/card/request-standard', body, { sensitive: true });
    },
    getCardFundingWallets() {
      return api().request('GET', '/api/user/wallets/card-funding');
    },
    getDepositAddress(refresh = false) {
      const q = refresh ? '?refresh=1' : '';
      return api().request('GET', `/api/user/wallets/standard/deposit-address${q}`);
    },
    getBitnobKyc() {
      return api().request('GET', '/api/user/wallets/standard/bitnob-kyc');
    },
    submitBitnobKyc(body = {}) {
      return api().request('POST', '/api/user/wallets/standard/bitnob-kyc', body, { sensitive: true });
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
