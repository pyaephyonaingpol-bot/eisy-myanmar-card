/**
 * USDT wallet domain API (user SPA).
 * Sensitive Auth.api already sends Cache-Control: no-store — avoid ?_= cache-bust
 * on every read (it defeats HTTP coalescing and forces extra work).
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
      return api().request('GET', '/api/user/wallet', null, { sensitive: true });
    },
    getTransactions() {
      return api().request('GET', '/api/user/usdt-wallet/transactions', null, { sensitive: true });
    },
    getBalance() {
      return api().request('GET', '/api/user/usdt-wallet/balance', null, { sensitive: true });
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
