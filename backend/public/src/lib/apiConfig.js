/**
 * Capacitor / native shell: route relative /api/* calls to the configured backend.
 * Depends on window.Eisy.config (load /src/lib/config.js first).
 */
(function () {
  'use strict';

  if (window.__EISY_API_CONFIG_APPLIED__) return;

  const cfg = (typeof window !== 'undefined' && window.Eisy && window.Eisy.config) || {};
  const PRODUCTION_API = cfg.PRODUCTION_API || 'https://eisymyanmar.com';
  const overrideGlobal = cfg.API_BASE_OVERRIDE_GLOBAL || 'EISY_API_BASE_OVERRIDE';
  const apiBaseGlobal = cfg.API_BASE_GLOBAL || 'EISY_API_BASE';

  function isCapacitorNative() {
    try {
      return Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    } catch (_) {
      return false;
    }
  }

  function resolveApiBase() {
    if (!isCapacitorNative()) return '';
    const override = window[overrideGlobal];
    if (override) return String(override).replace(/\/$/, '');
    return PRODUCTION_API;
  }

  window[apiBaseGlobal] = resolveApiBase();
  window.Eisy = window.Eisy || {};
  window.Eisy.apiBase = window[apiBaseGlobal];
  window.__EISY_API_CONFIG_APPLIED__ = true;

  if (!window[apiBaseGlobal]) return;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === 'string' && input.startsWith('/')) {
      input = window[apiBaseGlobal] + input;
    }
    return nativeFetch(input, init);
  };

  console.log('[Eisy Myanmar] Capacitor API base:', window[apiBaseGlobal]);
})();
