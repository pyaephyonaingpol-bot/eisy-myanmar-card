/**
 * Eisy Myanmar service worker.
 * Shows Web Push messages on the phone lock screen / notification shade,
 * including when the app tab is in the background or closed.
 */
'use strict';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function absoluteUrl(path) {
  try {
    return new URL(path || '/', self.location.origin).href;
  } catch (_) {
    return self.location.origin + '/';
  }
}

function show(title, body, extra) {
  const data = extra || {};
  return self.registration.showNotification(title || 'Eisy Myanmar', {
    body: body || '',
    icon: '/brand/logo-icon.png',
    badge: '/brand/logo-icon.png',
    tag: data.tag || 'eisy',
    renotify: true,
    data: { url: absoluteUrl(data.url || '/') },
  });
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(show(payload.title, payload.body, payload));
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type !== 'SHOW_NOTIFICATION') return;
  event.waitUntil(show(msg.title, msg.body, msg));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : absoluteUrl('/');
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) {
          try { await client.navigate(target); } catch (_) { /* older browsers */ }
        }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
