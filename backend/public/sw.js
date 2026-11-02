/**
 * Eisy Myanmar service worker.
 * - PWA: minimal shell precache + network-first navigation (install / Add to Home Screen).
 * - Push: background notifications when the app is closed or the screen is locked.
 */
'use strict';

const PWA_CACHE = 'eisy-pwa-v1';
const PWA_PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/manifest.json',
  '/brand/logo-icon.png',
  '/icons/Icon-192.png',
  '/icons/Icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(PWA_CACHE);
      await cache.addAll(PWA_PRECACHE);
    } catch (_) {
      /* precache is best-effort — push + fetch still work */
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('eisy-pwa-') && key !== PWA_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (_) {
        const cached = await caches.match('/');
        if (cached) return cached;
        throw _;
      }
    })());
    return;
  }

  if (PWA_PRECACHE.includes(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(PWA_CACHE);
        cache.put(request, fresh.clone());
        return fresh;
      } catch (_) {
        return cached || Response.error();
      }
    })());
  }
});

function absoluteUrl(path) {
  try {
    return new URL(path || '/', self.location.origin).href;
  } catch (_) {
    return self.location.origin + '/';
  }
}

function text(value, max) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const limit = max || 180;
  return clean.length > limit ? clean.slice(0, limit - 1) + '…' : clean;
}

function isSticky(tag) {
  return tag === 'eisy-3ds'
    || tag.indexOf('eisy-card-') === 0
    || tag.indexOf('eisy-deposit-') === 0;
}

function readPushPayload(event) {
  const fallback = {
    title: 'Eisy Myanmar',
    body: 'You have a new alert.',
    url: '/',
    tag: 'eisy',
  };
  if (!event || !event.data) return fallback;
  try {
    const json = event.data.json();
    if (json && typeof json === 'object') return json;
  } catch (_) { /* plain text payload */ }
  try {
    const body = event.data.text();
    if (body) return { title: 'Eisy Myanmar', body, url: '/', tag: 'eisy' };
  } catch (_) { /* empty */ }
  return fallback;
}

function displayNotification(raw) {
  const payload = raw || {};
  const title = text(payload.title, 80) || 'Eisy Myanmar';
  const body = text(payload.body, 180) || 'You have a new alert.';
  const tag = text(payload.tag, 64) || 'eisy';
  const data = { url: absoluteUrl(payload.url || '/') };
  const icon = absoluteUrl('/brand/logo-icon.png');
  const sticky = isSticky(tag);
  const full = {
    body,
    icon,
    badge: icon,
    tag,
    renotify: true,
    requireInteraction: sticky,
    silent: false,
    timestamp: Date.now(),
    vibrate: sticky ? [200, 100, 200, 100, 300] : [120, 60, 120],
    data,
  };
  return self.registration.showNotification(title, full).catch(() => (
    self.registration.showNotification(title, {
      body,
      icon,
      tag,
      renotify: true,
      data,
    })
  )).catch(() => (
    self.registration.showNotification(title, { body, tag, data })
  ));
}

self.addEventListener('push', (event) => {
  const payload = readPushPayload(event);
  event.waitUntil(displayNotification(payload));
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type !== 'SHOW_NOTIFICATION') return;
  event.waitUntil(displayNotification(msg));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : absoluteUrl('/');
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(client.url).origin === self.location.origin;
      } catch (_) {
        sameOrigin = false;
      }
      if (!sameOrigin || !('focus' in client)) continue;
      await client.focus();
      if ('navigate' in client) {
        try { await client.navigate(target); } catch (_) { /* older browsers */ }
      }
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    let subscription = event.newSubscription || null;
    if (!subscription) {
      try {
        const existing = event.oldSubscription;
        subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: existing && existing.options
            ? existing.options.applicationServerKey
            : undefined,
        });
      } catch (_) {
        subscription = null;
      }
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      client.postMessage({
        type: 'PUSH_SUBSCRIPTION_CHANGED',
        subscription: subscription ? subscription.toJSON() : null,
      });
    }
  })());
});
