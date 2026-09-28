/**
 * Cards / reload / pricing API (user SPA).
 * Instant (Kripicard) and Standard (Bitnob) clients stay on separate endpoints.
 */
(function (root) {
  'use strict';

  root.EisyServices = root.EisyServices || {};
  const api = () => root.EisyServices.api;

  root.EisyServices.cards = {
    list() {
      return api().request('GET', '/api/user/cards');
    },
    /** Standard Card (Bitnob / KYC) pricing */
    getPricing() {
      return api().request('GET', '/api/user/card/pricing');
    },
    /** Instant Card (Kripicard / Master Wallet) pricing */
    getKripicardPricing() {
      return api().request('GET', '/api/user/card/pricing-kripicard');
    },
    getBins() {
      return api().request('GET', '/api/user/card/bins');
    },
    /** Standard Card issue */
    requestCard(body) {
      return api().request('POST', '/api/user/card/request-standard', body, { sensitive: true });
    },
    /** Instant Card issue */
    requestKripicard(body) {
      return api().request('POST', '/api/user/card/request-instant', body, { sensitive: true });
    },
    getCardFundingWallets() {
      return api().request('GET', '/api/user/wallets/card-funding');
    },
    getStandardDepositAddress(refresh = false) {
      const q = refresh ? '?refresh=1' : '';
      return api().request('GET', `/api/user/wallets/standard/deposit-address${q}`);
    },
    reload(body) {
      return api().request('POST', '/api/user/card/reload', body, { sensitive: true });
    },
    listReloads() {
      return api().request('GET', '/api/user/reloads');
    },
    remove(cardId, body = {}) {
      return api().request('POST', `/api/user/cards/${cardId}/remove`, body, { sensitive: true });
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
