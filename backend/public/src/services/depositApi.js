/**
 * Deposit domain API (user SPA).
 */
(function (root) {
  'use strict';

  root.EisyServices = root.EisyServices || {};
  const api = () => root.EisyServices.api;

  root.EisyServices.deposit = {
    getUsdtAddresses() {
      return api().request('GET', '/api/deposit/usdt-addresses');
    },
    getPaymentMethods() {
      return api().request('GET', '/api/deposit/payment-methods');
    },
    createBinancePay(body) {
      // Legacy name — backend now creates a Kripicard Deposit API pay-to address.
      return api().request('POST', '/api/deposit/create', body, { sensitive: true });
    },
    createKripicardDeposit(body) {
      return api().request('POST', '/api/deposit/create', body, { sensitive: true });
    },
    getKripicardNetworks(currency = 'USDT') {
      return api().request('GET', `/api/deposit/kripicard-networks?currency=${encodeURIComponent(currency)}`);
    },
    createTronOrder(body) {
      // Compat path → Kripicard Deposit API (unique address + exact amount).
      return api().request('POST', '/api/tron/orders', body, { sensitive: true });
    },
    getTronOrder(orderId) {
      return api().request('GET', `/api/tron/orders/${encodeURIComponent(orderId)}`);
    },
    createRequest(body) {
      return api().request('POST', '/api/deposit/request', body, { sensitive: true });
    },
    submitProof(body) {
      return api().request('POST', '/api/deposit/submit', body, { sensitive: true });
    },
    submitProofForm(formData) {
      return api().form('/api/deposit/submit', formData, { sensitive: true });
    },
    getStatus(refCode) {
      return api().request('GET', `/api/deposit/status/${encodeURIComponent(refCode)}`);
    },
    listUserDeposits() {
      return api().request('GET', '/api/user/deposits');
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
