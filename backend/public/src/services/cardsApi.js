/**
 * Cards / reload / pricing API (user SPA).
 * Instant and Standard clients live in dedicated service modules;
 * this barrel keeps shared list/reload helpers and re-exports both.
 */
(function (root) {
  'use strict';

  root.EisyServices = root.EisyServices || {};
  const api = () => root.EisyServices.api;
  const instant = () => root.EisyServices.instantCard;
  const standard = () => root.EisyServices.standardCard;

  root.EisyServices.cards = {
    list() {
      return api().request('GET', '/api/user/cards');
    },
    /** @deprecated use EisyServices.standardCard.getPricing */
    getPricing() {
      return standard().getPricing();
    },
    /** @deprecated use EisyServices.instantCard.getPricing */
    getKripicardPricing() {
      return instant().getPricing();
    },
    getBins() {
      return instant().getBins();
    },
    requestCard(body) {
      return standard().requestCard(body);
    },
    requestKripicard(body) {
      return instant().requestCard(body);
    },
    getCardFundingWallets() {
      return standard().getCardFundingWallets();
    },
    getStandardDepositAddress(refresh = false) {
      return standard().getDepositAddress(refresh);
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
