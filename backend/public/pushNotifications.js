/**
 * Phone notifications via the service worker.
 * - Foreground / background tab: the page asks the worker to show a system notification.
 * - App closed: the server sends Web Push and the worker's `push` handler shows it.
 */
(function (root) {
  'use strict';

  const SW_URL = '/sw.js';
  let registrationPromise = null;

  function $(id) {
    return document.getElementById(id);
  }

  function t(key, fallback) {
    if (typeof root.t === 'function') return root.t(key);
    return fallback;
  }

  function supported() {
    return typeof navigator !== 'undefined'
      && 'serviceWorker' in navigator
      && typeof Notification !== 'undefined'
      && 'PushManager' in root;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
    return output;
  }

  function registerWorker() {
    if (!supported()) return Promise.resolve(null);
    if (!registrationPromise) {
      registrationPromise = navigator.serviceWorker.register(SW_URL, { scope: '/' })
        .catch((err) => {
          registrationPromise = null;
          console.warn('[push] service worker:', err.message || err);
          return null;
        });
    }
    return registrationPromise;
  }

  async function show(input) {
    const payload = typeof input === 'string' ? { body: input } : (input || {});
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    const registration = await registerWorker();
    if (!registration) return false;
    const ready = await navigator.serviceWorker.ready;
    const title = payload.title || t('push_app_title', 'Eisy Myanmar');
    const body = payload.body || '';
    const options = {
      body,
      icon: '/brand/logo-icon.png',
      badge: '/brand/logo-icon.png',
      tag: payload.tag || 'eisy',
      renotify: true,
      data: { url: payload.url || '/' },
    };
    try {
      await ready.showNotification(title, options);
    } catch (_) {
      await ready.showNotification(title, {
        body: options.body,
        icon: options.icon,
        badge: options.badge,
        tag: options.tag,
        data: options.data,
      });
    }
    return true;
  }

  async function subscribe(registration) {
    const configRes = await (root.Auth?.api
      ? root.Auth.api('GET', '/api/user/push/config')
      : fetch('/api/user/push/config').then((res) => res.json()));
    const publicKey = configRes?.publicKey;
    if (!publicKey) throw new Error('Push is not configured');
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await (root.Auth?.api
      ? root.Auth.api('POST', '/api/user/push/subscribe', { subscription })
      : fetch('/api/user/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription }),
      }));
    return subscription;
  }

  function setStatus(text) {
    const el = $('pushStatus');
    if (el) el.textContent = text || '';
    const btn = $('pushEnableBtn');
    if (!btn) return;
    if (Notification.permission === 'granted') {
      btn.textContent = t('push_enabled', 'Notifications on');
    } else if (Notification.permission === 'denied') {
      btn.textContent = t('push_blocked', 'Notifications blocked');
      btn.disabled = true;
    }
  }

  async function enable() {
    if (!supported()) {
      setStatus(t('push_unsupported', 'This browser cannot show phone notifications.'));
      return { ok: false };
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setStatus(t('push_denied', 'Permission was not granted. Allow notifications in the browser settings.'));
      return { ok: false, permission };
    }
    const registration = await registerWorker();
    if (!registration) {
      setStatus(t('push_worker_failed', 'Could not start the notification service.'));
      return { ok: false };
    }
    let remote = false;
    try {
      await subscribe(registration);
      remote = true;
    } catch (err) {
      console.warn('[push] subscribe:', err.message || err);
    }
    const shown = await show({
      title: t('push_test_title', 'Eisy notifications are on'),
      body: t('push_test_body', 'Verification codes and deposit alerts will appear on this phone.'),
      url: '/#settings',
      tag: 'eisy-push-test',
    });
    if (remote) {
      let test = null;
      try {
        test = await root.Auth?.api?.('POST', '/api/user/push/test', {});
      } catch (_) { /* local notification already shown */ }
      const backgroundOk = test && Number(test.sent) > 0;
      setStatus(backgroundOk
        ? t('push_ready', 'This phone will get alerts even when Eisy is in the background.')
        : t('push_local_only', 'Notifications are on in this browser. Add Eisy to the Home Screen on iPhone so alerts arrive when the app is closed.'));
    } else if (shown) {
      setStatus(t('push_local_only', 'Notifications are on in this browser. Add Eisy to the Home Screen on iPhone so alerts arrive when the app is closed.'));
    } else {
      setStatus(t('push_worker_failed', 'Could not start the notification service.'));
      return { ok: false, permission };
    }
    return { ok: true, remote };
  }

  async function sync() {
    if (!supported()) return;
    await registerWorker();
    if (!root.Auth?.isLoggedIn?.() || Notification.permission !== 'granted') {
      setStatus(Notification.permission === 'denied'
        ? t('push_denied', 'Permission was not granted. Allow notifications in the browser settings.')
        : '');
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      await subscribe(registration);
      setStatus(t('push_ready', 'This phone will get alerts even when Eisy is in the background.'));
    } catch (err) {
      console.warn('[push] sync:', err.message || err);
    }
  }

  function bind() {
    $('pushEnableBtn')?.addEventListener('click', () => {
      enable().catch((err) => {
        setStatus(err.message || t('push_worker_failed', 'Could not start the notification service.'));
      });
    });
    if (supported() && Notification.permission === 'denied') {
      setStatus(t('push_denied', 'Permission was not granted. Allow notifications in the browser settings.'));
    }
  }

  root.EisyPush = { supported, registerWorker, show, enable, sync, bind };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
