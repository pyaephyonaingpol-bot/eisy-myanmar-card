/**
 * Cards / reload / pricing API (user SPA).
 */
(function (root) {
  'use strict';

  root.EisyServices = root.EisyServices || {};
  const api = () => root.EisyServices.api;

  root.EisyServices.cards = {
    list() {
      return api().request('GET', '/api/user/cards');
    },
    getPricing() {
      return api().request('GET', '/api/user/card/pricing');
    },
    requestCard(body) {
      return api().request('POST', '/api/user/card/request', body, { sensitive: true });
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
