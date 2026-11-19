/**
 * Client-side error monitor for the SPA.
 * - Loads Sentry Browser SDK from CDN when a public DSN is configured
 * - Captures window.onerror / unhandledrejection
 * - Reports Auth.api timeouts / 5xx / network failures to /api/client-errors
 *   (and Sentry when available)
 */
(function initEisyErrorMonitor(global) {
  'use strict';

  if (global.__EISY_ERROR_MONITOR__) return;
  const state = {
    ready: false,
    sentry: null,
    config: null,
    queue: [],
    lastSent: new Map(),
  };
  global.__EISY_ERROR_MONITOR__ = state;

  const COOLDOWN_MS = 30_000;

  function fingerprint(parts) {
    return String(parts.filter(Boolean).join('|')).slice(0, 180);
  }

  function shouldSend(fp) {
    const now = Date.now();
    const last = state.lastSent.get(fp) || 0;
    if (now - last < COOLDOWN_MS) return false;
    state.lastSent.set(fp, now);
    if (state.lastSent.size > 200) {
      for (const [k, ts] of state.lastSent) {
        if (now - ts > COOLDOWN_MS) state.lastSent.delete(k);
      }
    }
    return true;
  }

  function isCascadePath(path) {
    const p = String(path || '');
    return p.indexOf('/api/client-errors') !== -1
      || p.indexOf('/api/config/monitoring') !== -1;
  }

  function shouldSkipServerIngest(payload) {
    if (!payload) return true;
    if (isCascadePath(payload.path)) return true;
    if (payload.code === 'BOOTSTRAP_FAILED') return true;
    if (/bootstrap failed/i.test(String(payload.message || ''))) return true;
    return false;
  }

  function postClientError(payload) {
    if (shouldSkipServerIngest(payload)) return;
    const fp = fingerprint([payload.code, payload.status, payload.path, payload.message]);
    if (!shouldSend(fp)) return;
    try {
      const body = JSON.stringify({ ...payload, fingerprint: fp, ts: Date.now() });
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon('/api/client-errors', blob);
        return;
      }
      fetch('/api/client-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
        cache: 'no-store',
      }).catch(() => {});
    } catch (_) { /* ignore */ }
  }

  function toPayload(err, extra) {
    const e = err || {};
    return {
      message: String(e.message || extra?.message || 'Client error').slice(0, 400),
      code: e.code || extra?.code || null,
      status: e.status || extra?.status || null,
      path: extra?.path || null,
      method: extra?.method || null,
      source: extra?.source || 'client',
      stack: String(e.stack || '').split('\n').slice(0, 6).join('\n').slice(0, 1500),
      href: String(global.location?.href || '').slice(0, 300),
      userAgent: String(global.navigator?.userAgent || '').slice(0, 200),
    };
  }

  function captureClientError(err, extra) {
    const payload = toPayload(err, extra);
    console.error('[error-monitor]', payload.message, payload);

    if (state.sentry && typeof state.sentry.captureException === 'function') {
      try {
        state.sentry.withScope((scope) => {
          if (payload.path) scope.setTag('path', payload.path);
          if (payload.code) scope.setTag('code', payload.code);
          scope.setTag('source', payload.source || 'client');
          scope.setExtra('payload', payload);
          const error = err instanceof Error ? err : new Error(payload.message);
          state.sentry.captureException(error);
        });
      } catch (_) { /* ignore */ }
    }

    // Always mirror to server (Sentry + Telegram there when configured)
    const severe = !payload.status
      || Number(payload.status) >= 500
      || payload.code === 'REQUEST_TIMEOUT'
      || payload.code === 'NETWORK_ERROR'
      || payload.source === 'window.onerror'
      || payload.source === 'unhandledrejection';
    if (severe) postClientError(payload);
  }

  function installGlobalHandlers() {
    global.addEventListener('error', (event) => {
      const err = event?.error || new Error(event?.message || 'Script error');
      captureClientError(err, {
        source: 'window.onerror',
        path: event?.filename || null,
        code: 'WINDOW_ONERROR',
      });
    });
    global.addEventListener('unhandledrejection', (event) => {
      const reason = event?.reason;
      const err = reason instanceof Error ? reason : new Error(String(reason || 'Unhandled rejection'));
      captureClientError(err, {
        source: 'unhandledrejection',
        code: 'UNHANDLED_REJECTION',
      });
    });
  }

  function patchAuthApi() {
    const Auth = global.Auth;
    if (!Auth || typeof Auth.api !== 'function' || Auth.__eisyErrorMonitorPatched) return;
    Auth.__eisyErrorMonitorPatched = true;
    const original = Auth.api.bind(Auth);
    Auth.api = async function monitoredApi(method, path, body, opts) {
      try {
        return await original(method, path, body, opts);
      } catch (err) {
        const status = Number(err?.status || 0);
        const code = String(err?.code || '');
        const apiPath = String(path || '').slice(0, 200);
        // Never ingest failures of the ingest/monitoring endpoints themselves.
        if (isCascadePath(apiPath) || code === 'BOOTSTRAP_FAILED') {
          throw err;
        }
        if (
          code === 'REQUEST_TIMEOUT'
          || code === 'NETWORK_ERROR'
          || status >= 500
          || status === 408
          || status === 503
        ) {
          captureClientError(err, {
            source: 'auth.api',
            method: String(method || 'GET').toUpperCase(),
            path: apiPath,
            status,
            code,
          });
        }
        throw err;
      }
    };
  }

  function loadSentrySdk(config) {
    if (!config?.enabled || !config.dsn) return Promise.resolve(null);
    if (global.Sentry && typeof global.Sentry.init === 'function') {
      return Promise.resolve(global.Sentry);
    }
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://browser.sentry-cdn.com/8.42.0/bundle.min.js';
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve(global.Sentry || null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }

  async function bootstrap() {
    installGlobalHandlers();
    // Auth may load after this script — retry briefly.
    patchAuthApi();
    let tries = 0;
    const authTimer = setInterval(() => {
      tries += 1;
      patchAuthApi();
      if (global.Auth?.__eisyErrorMonitorPatched || tries > 40) clearInterval(authTimer);
    }, 250);

    try {
      const res = await fetch('/api/config/monitoring', { cache: 'no-store' });
      if (res.ok) {
        state.config = await res.json();
      }
    } catch (_) {
      state.config = { enabled: false };
    }

    const Sentry = await loadSentrySdk(state.config);
    if (Sentry && state.config?.dsn) {
      try {
        Sentry.init({
          dsn: state.config.dsn,
          environment: state.config.environment || 'production',
          release: state.config.release || undefined,
          tracesSampleRate: Number(state.config.tracesSampleRate) || 0.1,
          sendDefaultPii: false,
        });
        state.sentry = Sentry;
      } catch (err) {
        console.warn('[error-monitor] Sentry browser init failed', err);
      }
    }

    state.ready = true;
    while (state.queue.length) {
      const item = state.queue.shift();
      captureClientError(item.err, item.extra);
    }
  }

  global.EisyErrorMonitor = {
    captureError(err, extra) {
      if (!state.ready) {
        state.queue.push({ err, extra });
        return;
      }
      captureClientError(err, extra);
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { bootstrap(); });
  } else {
    bootstrap();
  }
}(typeof window !== 'undefined' ? window : globalThis));
