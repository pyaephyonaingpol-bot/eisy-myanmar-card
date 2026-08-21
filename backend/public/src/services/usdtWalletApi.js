/**
 * USDT wallet domain API (user SPA).
 */
(function (root) {
  'use strict';

  root.EisyServices = root.EisyServices || {};
  const api = () => root.EisyServices.api;

  root.EisyServices.usdtWallet = {
    getOverview() {
      return api().request('GET', `/api/user/usdt-wallet?_=${Date.now()}`, null, { sensitive: true });
    },
    getPlatformWallet() {
      return api().request('GET', `/api/user/wallet?_=${Date.now()}`, null, { sensitive: true });
    },
    getTransactions() {
      return api().request('GET', `/api/user/usdt-wallet/transactions?_=${Date.now()}`, null, { sensitive: true });
    },
    getBalance() {
      return api().request('GET', `/api/user/usdt-wallet/balance?_=${Date.now()}`, null, { sensitive: true });
    },
    linkAddress(body) {
      return api().request('POST', '/api/user/usdt-wallet/link', body);
    },
    unlinkAddress(id) {
      return api().request('DELETE', `/api/user/usdt-wallet/link/${id}`);
    },
    getLinkedBalance(id) {
      return api().request('GET', `/api/user/usdt-wallet/linked/${id}/balance?_=${Date.now()}`);
    },
    transfer(body) {
      return api().request('POST', '/api/user/usdt-wallet/transfer', body, { sensitive: true });
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
