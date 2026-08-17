/**
 * KYC + support + transactions API (user SPA).
 */
(function (root) {
  'use strict';

  root.EisyServices = root.EisyServices || {};
  const api = () => root.EisyServices.api;

  root.EisyServices.kyc = {
    getStatus() {
      return api().request('GET', '/api/kyc/status');
    },
    submitForm(formData) {
      return api().form('/api/kyc/submit', formData, { sensitive: true });
    },
  };

  root.EisyServices.support = {
    listThreads() {
      return api().request('GET', '/api/support/threads');
    },
    createThread(body) {
      return api().request('POST', '/api/support/threads', body);
    },
  };

  root.EisyServices.transactions = {
    list() {
      return api().request('GET', '/api/user/transactions');
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
