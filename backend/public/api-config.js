/**
 * Back-compat entry for older HTML that still loads `/api-config.js`.
 * Prefer `/src/lib/config.js` + `/src/lib/apiConfig.js` (Step 1–2).
 *
 * If the modular scripts already ran, this is a no-op.
 * If only this file is loaded (legacy), apply a minimal config + API patch.
 */
(function () {
  'use strict';

  if (window.__EISY_API_CONFIG_APPLIED__) return;

  // Minimal fallback config when modular /src/lib scripts were not included
  window.Eisy = window.Eisy || {};
  if (!window.Eisy.config) {
    window.Eisy.config = Object.freeze({
      PRODUCTION_API: 'https://eisymyanmar.com',
      LOCAL_ANDROID_EMULATOR: 'http://10.0.2.2:3000',
      API_BASE_OVERRIDE_GLOBAL: 'EISY_API_BASE_OVERRIDE',
      API_BASE_GLOBAL: 'EISY_API_BASE',
    });
  }

  function isCapacitorNative() {
    try {
      return Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    } catch (_) {
      return false;
    }
  }

  function resolveApiBase() {
    if (!isCapacitorNative()) return '';
    const override = window.EISY_API_BASE_OVERRIDE;
    if (override) return String(override).replace(/\/$/, '');
    return window.Eisy.config.PRODUCTION_API;
  }

  window.EISY_API_BASE = resolveApiBase();
  window.Eisy.apiBase = window.EISY_API_BASE;
  window.__EISY_API_CONFIG_APPLIED__ = true;

  if (!window.EISY_API_BASE) return;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === 'string' && input.startsWith('/')) {
      input = window.EISY_API_BASE + input;
    }
    return nativeFetch(input, init);
  };

  console.log('[Eisy Myanmar] Capacitor API base (compat shim):', window.EISY_API_BASE);
})();
