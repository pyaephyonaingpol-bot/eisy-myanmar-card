/**
 * Aggregates lib modules onto window.Eisy (already populated by individual scripts).
 * Load order: config → storageKeys → constants → apiConfig → index
 */
(function () {
  'use strict';

  window.Eisy = window.Eisy || {};
  window.Eisy.version = 'src-lib-step1-2';
  window.Eisy.ready = true;

  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[Eisy] lib ready', {
      hasConfig: Boolean(window.Eisy.config),
      hasStorageKeys: Boolean(window.Eisy.storageKeys),
      hasConstants: Boolean(window.Eisy.constants),
      apiBase: window.Eisy.apiBase || '',
    });
  }
})();
