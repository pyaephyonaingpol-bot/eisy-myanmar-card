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
      return api().request('POST', '/api/deposit/create', body, { sensitive: true });
    },
    createNowPayments(body) {
      return api().request('POST', '/api/create-payment', body, { sensitive: true });
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
