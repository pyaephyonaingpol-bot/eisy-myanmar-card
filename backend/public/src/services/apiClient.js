/**
 * Thin API client — delegates to Auth.api / Auth.apiForm when available.
 * Attaches to window.EisyServices.api
 */
(function (root) {
  'use strict';

  root.Eisy = root.Eisy || {};
  root.EisyServices = root.EisyServices || {};

  function getAuth() {
    if (typeof Auth !== 'undefined') return Auth;
    if (root.Auth) return root.Auth;
    throw new Error('Auth client is not loaded');
  }

  root.EisyServices.api = {
    request(method, path, body, opts) {
      return getAuth().api(method, path, body, opts);
    },
    form(path, formData, opts) {
      return getAuth().apiForm(path, formData, opts);
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
