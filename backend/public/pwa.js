/**
 * Progressive Web App bootstrap — service worker + install prompt UI.
 */
(function (root) {
  'use strict';

  const SW_URL = '/sw.js';
  const DISMISS_KEY = 'eisy_pwa_install_dismissed';
  let registrationPromise = null;
  let deferredPrompt = null;
  let iosModalBound = false;

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
    const k = String(key || '');
    if (root.I18n && typeof root.I18n.t === 'function') {
      const translated = root.I18n.t(k);
      if (translated && translated !== k) return translated;
    } else if (typeof root.t === 'function') {
      const translated = root.t(k);
      if (translated && translated !== k) return translated;
    }
    return fallback != null ? fallback : k;
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

  function installAppButtons() {
    return document.querySelectorAll('.js-pwa-install-app');
  }

  function bannerEl() {
    return document.getElementById('pwaInstallBanner');
  }

  function iosModalEl() {
    return document.getElementById('pwaIosInstallModal');
  }

  function setBannerVisible(visible) {
    const el = bannerEl();
    if (!el) return;
    el.classList.toggle('hidden', !visible);
    if (visible) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  }

  function canShowInstallBanner() {
    return false;
  }

  function refreshInstallBanner() {
    setBannerVisible(false);
  }

  function setInstallAppButtonsVisible(visible) {
    installAppButtons().forEach((btn) => {
      btn.classList.toggle('hidden', !visible);
      if (visible) btn.removeAttribute('hidden');
      else btn.setAttribute('hidden', '');
      btn.disabled = false;
    });
  }

  function refreshInstallAppButtons() {
    setInstallAppButtonsVisible(!isStandaloneDisplay());
  }

  function applyInstallButtonLabels() {
    const label = t('pwa_install_app_btn', 'Install App');
    installAppButtons().forEach((btn) => {
      const labeled = btn.querySelector('[data-i18n="pwa_install_app_btn"]');
      if (labeled) labeled.textContent = label;
      else btn.textContent = label;
    });
  }

  function isLikelyIos() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/i.test(ua)) return true;
    return navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints) > 1;
  }

  function bindIosInstallModal() {
    if (iosModalBound) return;
    const modal = iosModalEl();
    if (!modal) return;
    iosModalBound = true;
    const close = () => closeIosInstallModal();
    modal.querySelector('#pwaIosInstallModalClose')?.addEventListener('click', close);
    modal.querySelector('#pwaIosInstallModalOk')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) close();
    });
  }

  function openIosInstallModal() {
    const modal = iosModalEl();
    if (!modal) {
      window.alert(t('pwa_install_ios_hint', 'On iPhone/iPad: tap Share, then “Add to Home Screen”.'));
      return;
    }
    bindIosInstallModal();
    if (root.I18n && typeof root.I18n.apply === 'function') {
      root.I18n.apply(modal);
    }
    modal.classList.remove('hidden');
    modal.removeAttribute('hidden');
    modal.querySelector('#pwaIosInstallModalOk')?.focus();
  }

  function closeIosInstallModal() {
    const modal = iosModalEl();
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('hidden', '');
  }

  function showInstallFallbackMessage() {
    const msg = t(
      'pwa_install_unavailable',
      'Install is not available in this browser right now. Try Chrome on Android, or use Add to Home Screen on iPhone.',
    );
    if (root.Dashboard?.toast) {
      root.Dashboard.toast(msg, 'info');
    } else {
      window.alert(msg);
    }
  }

  async function handleInstallAppClick(e) {
    e.preventDefault();
    if (isStandaloneDisplay()) return;

    if (isLikelyIos()) {
      openIosInstallModal();
      return;
    }

    if (deferredPrompt) {
      const result = await promptInstall();
      if (!result.ok && result.reason === 'error') {
        showInstallFallbackMessage();
      }
      return;
    }

    showInstallFallbackMessage();
  }

  async function promptInstall() {
    if (!deferredPrompt) return { ok: false, reason: 'no_prompt' };
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    try {
      promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      refreshInstallAppButtons();
      refreshInstallBanner();
      return { ok: choice.outcome === 'accepted', outcome: choice.outcome };
    } catch (err) {
      console.warn('[pwa] install prompt failed:', err.message || err);
      refreshInstallAppButtons();
      refreshInstallBanner();
      return { ok: false, reason: 'error' };
    }
  }

  function bindInstallUi() {
    installAppButtons().forEach((btn) => {
      btn.addEventListener('click', handleInstallAppClick);
    });
    const installBtn = document.getElementById('pwaInstallBtn');
    const dismissBtn = document.getElementById('pwaInstallDismiss');
    installBtn?.addEventListener('click', handleInstallAppClick);
    dismissBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      setDismissed();
      refreshInstallBanner();
    });
  }

  root.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    refreshInstallAppButtons();
  });

  root.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    refreshInstallAppButtons();
    setBannerVisible(false);
  });

  root.EisyPwa = {
    canUseServiceWorker,
    registerServiceWorker,
    getRegistration: () => registrationPromise,
    canShowInstallBanner,
    refreshInstallBanner,
    refreshInstallAppButtons,
    applyInstallButtonLabels,
    promptInstall,
    isStandaloneDisplay,
    canNativeInstall: () => Boolean(deferredPrompt),
    openIosInstallModal,
    closeIosInstallModal,
    isLikelyIos,
  };

  function boot() {
    registerServiceWorker().catch(() => {});
    bindInstallUi();
    applyInstallButtonLabels();
    refreshInstallAppButtons();
    refreshInstallBanner();
    if (root.I18n && typeof root.I18n.onChange === 'function') {
      root.I18n.onChange(() => {
        applyInstallButtonLabels();
        const modal = iosModalEl();
        if (modal && !modal.classList.contains('hidden') && root.I18n.apply) {
          root.I18n.apply(modal);
        }
      });
    }
    document.addEventListener('eisy:langchange', () => applyInstallButtonLabels());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
