/**
 * Progressive Web App bootstrap — register the service worker for installability
 * (Add to Home Screen / Install app) independent of push notification opt-in.
 */
(function (root) {
  'use strict';

  const SW_URL = '/sw.js';
  let registrationPromise = null;

  function canUseServiceWorker() {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  }

  function registerServiceWorker() {
    if (!canUseServiceWorker()) return Promise.resolve(null);
    if (!registrationPromise) {
      registrationPromise = navigator.serviceWorker.register(SW_URL, {
        scope: '/',
        updateViaCache: 'none',
      }).catch((err) => {
        registrationPromise = null;
        console.warn('[pwa] service worker registration failed:', err.message || err);
        return null;
      });
    }
    return registrationPromise;
  }

  root.EisyPwa = {
    canUseServiceWorker,
    registerServiceWorker,
    getRegistration: () => registrationPromise,
  };

  function boot() {
    registerServiceWorker().catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
