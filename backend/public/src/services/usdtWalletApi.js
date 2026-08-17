/**
 * USDT wallet domain API (user SPA).
 */
(function (root) {
  'use strict';

  root.EisyServices = root.EisyServices || {};
  const api = () => root.EisyServices.api;

  root.EisyServices.usdtWallet = {
    getOverview() {
      return api().request('GET', '/api/user/usdt-wallet', null, { sensitive: true });
    },
    getPlatformWallet() {
      return api().request('GET', '/api/user/wallet');
    },
    getTransactions() {
      return api().request('GET', '/api/user/usdt-wallet/transactions', null, { sensitive: true });
    },
    linkAddress(body) {
      return api().request('POST', '/api/user/usdt-wallet/link', body);
    },
    unlinkAddress(id) {
      return api().request('DELETE', `/api/user/usdt-wallet/link/${id}`);
    },
    getLinkedBalance(id) {
      return api().request('GET', `/api/user/usdt-wallet/linked/${id}/balance`);
    },
    transfer(body) {
      return api().request('POST', '/api/user/usdt-wallet/transfer', body, { sensitive: true });
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
