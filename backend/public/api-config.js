/**
 * Capacitor / native shell: route relative /api/* calls to production backend.
 * Loaded before auth.js and dashboard.js in index.html / admin.html.
 */
(function () {
  'use strict';

  var PRODUCTION_API = 'https://eisy-global-card.vercel.app';
  var LOCAL_ANDROID_EMULATOR = 'http://10.0.2.2:3000';

  function isCapacitorNative() {
    try {
      return Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    } catch (_) {
      return false;
    }
  }

  function resolveApiBase() {
    if (!isCapacitorNative()) return '';
    var override = window.EISY_API_BASE_OVERRIDE;
    if (override) return String(override).replace(/\/$/, '');
    return PRODUCTION_API;
  }

  window.EISY_API_BASE = resolveApiBase();

  if (!window.EISY_API_BASE) return;

  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === 'string' && input.startsWith('/')) {
      input = window.EISY_API_BASE + input;
    }
    return nativeFetch(input, init);
  };

  console.log('[Eisy Myanmar] Capacitor API base:', window.EISY_API_BASE);
})();
