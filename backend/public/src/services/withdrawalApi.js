/**
 * Withdrawal domain API (user SPA).
 */
(function (root) {
  'use strict';

  root.EisyServices = root.EisyServices || {};
  const api = () => root.EisyServices.api;

  root.EisyServices.withdrawal = {
    getFees() {
      return api().request('GET', '/api/withdrawal/fees');
    },
    createUsdt(body) {
      return api().request('POST', '/api/withdrawal/usdt', body, { sensitive: true });
    },
    createMmk(body) {
      return api().request('POST', '/api/withdrawal/mmk', body, { sensitive: true });
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
