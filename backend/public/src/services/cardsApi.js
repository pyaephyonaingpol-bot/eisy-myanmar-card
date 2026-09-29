/**
 * Cards / reload / pricing API (user SPA).
 * Instant / Kripicard only — Master Wallet funded.
 */
(function (root) {
  'use strict';

  root.EisyServices = root.EisyServices || {};
  const api = () => root.EisyServices.api;
  const instant = () => root.EisyServices.instantCard;

  root.EisyServices.cards = {
    list() {
      return api().request('GET', '/api/user/cards');
    },
    getPricing() {
      return instant().getPricing();
    },
    getKripicardPricing() {
      return instant().getPricing();
    },
    getBins() {
      return instant().getBins();
    },
    requestCard(body) {
      return instant().requestCard(body);
    },
    requestKripicard(body) {
      return instant().requestCard(body);
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
