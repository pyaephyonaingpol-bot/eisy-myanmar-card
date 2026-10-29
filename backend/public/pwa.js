/**
 * Progressive Web App bootstrap — service worker + install prompt UI.
 */
(function (root) {
  'use strict';

  const SW_URL = '/sw.js';
  const DISMISS_KEY = 'eisy_pwa_install_dismissed';
  let registrationPromise = null;
  let deferredPrompt = null;

  function canUseServiceWorker() {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  }

  function isStandaloneDisplay() {
    try {
      if (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) return true;
      if (root.matchMedia && root.matchMedia('(display-mode: fullscreen)').matches) return true;
    } catch (_) { /* ignore */ }
    return Boolean(navigator.standalone);
  }

  function isDismissed() {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setDismissed() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch (_) { /* ignore */ }
  }

  function t(key, fallback) {
    if (typeof root.t === 'function') return root.t(key);
    if (root.I18n && typeof root.I18n.t === 'function') return root.I18n.t(key);
    return fallback;
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

  function bannerEl() {
    return document.getElementById('pwaInstallBanner');
  }

  function setBannerVisible(visible) {
    const el = bannerEl();
    if (!el) return;
    el.classList.toggle('hidden', !visible);
    if (visible) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  }

  function canShowInstallBanner() {
    return Boolean(deferredPrompt)
      && !isStandaloneDisplay()
      && !isDismissed()
      && bannerEl();
  }

  function refreshInstallBanner() {
    setBannerVisible(canShowInstallBanner());
  }

  async function promptInstall() {
    if (!deferredPrompt) return { ok: false, reason: 'no_prompt' };
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    try {
      promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      refreshInstallBanner();
      return { ok: choice.outcome === 'accepted', outcome: choice.outcome };
    } catch (err) {
      console.warn('[pwa] install prompt failed:', err.message || err);
      refreshInstallBanner();
      return { ok: false, reason: 'error' };
    }
  }

  function bindInstallUi() {
    const installBtn = document.getElementById('pwaInstallBtn');
    const dismissBtn = document.getElementById('pwaInstallDismiss');
    installBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      promptInstall().then((result) => {
        if (!result.ok && result.reason === 'no_prompt') {
          root.Dashboard?.toast?.(
            t('pwa_install_unavailable', 'Install is not available in this browser right now.'),
            'error',
          );
        }
      });
    });
    dismissBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      setDismissed();
      refreshInstallBanner();
    });
  }

  root.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    refreshInstallBanner();
  });

  root.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    setBannerVisible(false);
  });

  root.EisyPwa = {
    canUseServiceWorker,
    registerServiceWorker,
    getRegistration: () => registrationPromise,
    canShowInstallBanner,
    refreshInstallBanner,
    promptInstall,
    isStandaloneDisplay,
  };

  function boot() {
    registerServiceWorker().catch(() => {});
    bindInstallUi();
    refreshInstallBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
