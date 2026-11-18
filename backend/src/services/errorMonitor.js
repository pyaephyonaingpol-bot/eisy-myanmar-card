/**
 * Central error monitoring: Sentry (when SENTRY_DSN is set) + structured logs
 * + rate-limited Telegram alerts for severe/server failures.
 *
 * Works on Vercel serverless and long-lived Express (Droplet) without crashing
 * if Sentry packages/env are missing.
 */

'use strict';

const crypto = require('crypto');

let sentry = null;
let initialized = false;
let processHandlersInstalled = false;

/** @type {Map<string, number>} fingerprint → last alert epoch ms */
const alertCooldown = new Map();
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function resolveDsn() {
  return String(
    process.env.SENTRY_DSN
      || process.env.NEXT_PUBLIC_SENTRY_DSN
      || ''
  ).trim();
}

function resolveEnvironment() {
  return String(
    process.env.SENTRY_ENVIRONMENT
      || process.env.VERCEL_ENV
      || process.env.NODE_ENV
      || 'development'
  ).trim();
}

function resolveRelease() {
  return String(
    process.env.SENTRY_RELEASE
      || process.env.VERCEL_GIT_COMMIT_SHA
      || process.env.GIT_COMMIT
      || ''
  ).trim() || undefined;
}

function isEnabled() {
  if (envFlag('SENTRY_DISABLED', false)) return false;
  return Boolean(resolveDsn());
}

function getPublicClientConfig() {
  const dsn = String(
    process.env.NEXT_PUBLIC_SENTRY_DSN
      || process.env.SENTRY_DSN_PUBLIC
      || ''
  ).trim();
  // Never expose the server-only DSN if a dedicated public one is unset —
  // Sentry browser DSNs are designed to be public, but ops may prefer a
  // separate project. Fall back to SENTRY_DSN only when explicitly allowed.
  const allowServerDsnInBrowser = envFlag('SENTRY_EXPOSE_DSN_TO_BROWSER', false);
  const browserDsn = dsn || (allowServerDsnInBrowser ? resolveDsn() : '');
  return {
    enabled: Boolean(browserDsn) && !envFlag('SENTRY_DISABLED', false),
    dsn: browserDsn || null,
    environment: resolveEnvironment(),
    release: resolveRelease() || null,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1) || 0.1,
  };
}

function initErrorMonitor(options = {}) {
  if (initialized) return { ok: true, sentry: Boolean(sentry) };
  initialized = true;

  const dsn = resolveDsn();
  if (!dsn || envFlag('SENTRY_DISABLED', false)) {
    if (!options.silent) {
      console.log('[error-monitor] Sentry disabled — structured logs + Telegram only'
        + (dsn ? ' (SENTRY_DISABLED)' : ' (set SENTRY_DSN)'));
    }
    return { ok: true, sentry: false };
  }

  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: resolveEnvironment(),
      release: resolveRelease(),
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1) || 0.1,
      // Avoid PII by default; callers may attach scrubbed context.
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.request?.headers) {
          const scrub = { ...event.request.headers };
          for (const key of Object.keys(scrub)) {
            if (/authorization|cookie|x-eisy|proxy-key|api[-_]?key|secret/i.test(key)) {
              scrub[key] = '[Filtered]';
            }
          }
          event.request.headers = scrub;
        }
        return event;
      },
    });
    sentry = Sentry;
    console.log('[error-monitor] Sentry initialized', {
      environment: resolveEnvironment(),
      release: resolveRelease() || null,
    });
    return { ok: true, sentry: true };
  } catch (err) {
    console.warn('[error-monitor] Sentry init failed:', err.message);
    sentry = null;
    return { ok: false, sentry: false, error: err.message };
  }
}

function fingerprintFor(err, context = {}) {
  const code = err?.code || context.code || '';
  const status = err?.status || context.status || '';
  const path = context.path || context.route || '';
  const msg = String(err?.message || context.message || 'error').slice(0, 120);
  return crypto
    .createHash('sha1')
    .update(`${code}|${status}|${path}|${msg}`)
    .digest('hex')
    .slice(0, 16);
}

function shouldAlertTelegram(fingerprint) {
  const now = Date.now();
  const last = alertCooldown.get(fingerprint) || 0;
  if (now - last < ALERT_COOLDOWN_MS) return false;
  alertCooldown.set(fingerprint, now);
  // Cap map growth
  if (alertCooldown.size > 500) {
    for (const [k, ts] of alertCooldown) {
      if (now - ts > ALERT_COOLDOWN_MS) alertCooldown.delete(k);
    }
  }
  return true;
}

function severityFromError(err, context = {}) {
  if (context.severity) return String(context.severity);
  const status = Number(err?.status || context.status || 0);
  const code = String(err?.code || context.code || '');
  if (status >= 500 || code === 'REQUEST_TIMEOUT' || /timeout|ECONNRESET|ENOTFOUND/i.test(code + (err?.message || ''))) {
    return 'high';
  }
  if (status === 429 || status === 408) return 'medium';
  return 'medium';
}

function logStructured(level, message, meta = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    message: String(message || '').slice(0, 500),
    ...meta,
  };
  const text = JSON.stringify(line);
  if (level === 'error' || level === 'fatal') console.error('[error-monitor]', text);
  else if (level === 'warn') console.warn('[error-monitor]', text);
  else console.log('[error-monitor]', text);
}

async function maybeTelegramAlert(err, context = {}, severity = 'high') {
  if (!envFlag('ERROR_MONITOR_TELEGRAM', true)) return;
  // Only alert on high/critical by default
  if (!['high', 'critical'].includes(String(severity).toLowerCase())) return;
  const fp = fingerprintFor(err, context);
  if (!shouldAlertTelegram(fp)) return;
  try {
    const { notifyAdminSecurityAlert } = require('./telegram');
    notifyAdminSecurityAlert({
      title: context.title || 'Application error',
      severity,
      details: [
        `Message: ${String(err?.message || context.message || 'unknown').slice(0, 200)}`,
        err?.code ? `Code: ${err.code}` : null,
        context.path ? `Path: ${String(context.path).slice(0, 160)}` : null,
        context.method ? `Method: ${context.method}` : null,
        context.status ? `Status: ${context.status}` : null,
        context.source ? `Source: ${context.source}` : null,
        `Fingerprint: ${fp}`,
        sentry ? 'Sentry: captured' : 'Sentry: not configured',
      ].filter(Boolean),
    });
  } catch (alertErr) {
    console.warn('[error-monitor] telegram alert skipped:', alertErr.message);
  }
}

/**
 * Capture an exception. Safe to call before/without Sentry.
 * @returns {{ captured: boolean, sentryId: string|null, fingerprint: string }}
 */
function captureError(err, context = {}) {
  initErrorMonitor({ silent: true });
  const error = err instanceof Error ? err : new Error(String(err || 'Unknown error'));
  const severity = severityFromError(error, context);
  const fingerprint = fingerprintFor(error, context);

  logStructured('error', error.message, {
    code: error.code || context.code || null,
    status: error.status || context.status || null,
    path: context.path || null,
    source: context.source || 'server',
    fingerprint,
    stack: String(error.stack || '').split('\n').slice(0, 4).join(' | '),
  });

  let sentryId = null;
  if (sentry) {
    try {
      sentry.withScope((scope) => {
        if (context.tags && typeof context.tags === 'object') {
          for (const [k, v] of Object.entries(context.tags)) scope.setTag(k, String(v));
        }
        if (context.userId) scope.setUser({ id: String(context.userId) });
        if (context.extra) scope.setExtras(context.extra);
        scope.setLevel(severity === 'critical' ? 'fatal' : severity === 'high' ? 'error' : 'warning');
        scope.setFingerprint([fingerprint]);
        if (context.path) scope.setTag('path', String(context.path).slice(0, 120));
        if (context.source) scope.setTag('source', String(context.source));
        sentryId = sentry.captureException(error);
      });
    } catch (sentryErr) {
      console.warn('[error-monitor] captureException failed:', sentryErr.message);
    }
  }

  // Fire-and-forget alert
  maybeTelegramAlert(error, context, severity).catch(() => {});

  return { captured: true, sentryId, fingerprint };
}

function captureMessage(message, { level = 'info', ...context } = {}) {
  initErrorMonitor({ silent: true });
  logStructured(level === 'warning' ? 'warn' : level, message, {
    path: context.path || null,
    source: context.source || 'server',
  });
  if (sentry) {
    try {
      sentry.withScope((scope) => {
        if (context.tags) {
          for (const [k, v] of Object.entries(context.tags)) scope.setTag(k, String(v));
        }
        scope.setLevel(level);
        sentry.captureMessage(String(message), level);
      });
    } catch (_) { /* ignore */ }
  }
}

function installProcessHandlers() {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;
  initErrorMonitor({ silent: true });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason || 'unhandledRejection'));
    err.code = err.code || 'UNHANDLED_REJECTION';
    captureError(err, {
      source: 'process',
      title: 'Unhandled promise rejection',
      severity: 'high',
      tags: { kind: 'unhandledRejection' },
    });
  });

  process.on('uncaughtException', (err) => {
    const error = err instanceof Error ? err : new Error(String(err || 'uncaughtException'));
    error.code = error.code || 'UNCAUGHT_EXCEPTION';
    captureError(error, {
      source: 'process',
      title: 'Uncaught exception',
      severity: 'critical',
      tags: { kind: 'uncaughtException' },
    });
    // Do not exit here — Vercel/serverless and Express prefer to keep serving.
  });
}

/**
 * Express error middleware — place after routes.
 * Captures 5xx / unexpected errors then responds JSON.
 */
function createExpressErrorHandler() {
  // eslint-disable-next-line no-unused-vars
  return function expressErrorHandler(err, req, res, _next) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    if (safeStatus >= 500 || err?.code === 'REQUEST_TIMEOUT') {
      captureError(err, {
        source: 'express',
        title: 'API route error',
        path: String(req.originalUrl || req.url || '').slice(0, 200),
        method: req.method,
        status: safeStatus,
        userId: req.user?.id || null,
        severity: safeStatus >= 500 ? 'high' : 'medium',
        tags: { kind: 'express_error' },
      });
    }
    if (res.headersSent) return;
    res.status(safeStatus).json({
      error: safeStatus >= 500
        ? 'Internal server error'
        : (err?.message || 'Request failed'),
      code: err?.code || (safeStatus >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
    });
  };
}

/**
 * Lightweight request middleware: capture slow requests as performance warnings.
 */
function createSlowRequestMonitor(thresholdMs) {
  const threshold = Number(thresholdMs)
    || Number(process.env.SENTRY_SLOW_REQUEST_MS)
    || 15000;
  return function slowRequestMonitor(req, res, next) {
    const started = Date.now();
    res.on('finish', () => {
      const dur = Date.now() - started;
      if (dur < threshold) return;
      const path = String(req.originalUrl || req.url || '').slice(0, 200);
      if (path.startsWith('/api/webhook')) return;
      captureMessage(`Slow request ${req.method} ${path} (${dur}ms)`, {
        level: 'warning',
        source: 'performance',
        path,
        tags: { kind: 'slow_request', method: req.method },
        extra: { duration_ms: dur, status: res.statusCode },
      });
    });
    next();
  };
}

function flush(timeoutMs = 2000) {
  if (!sentry || typeof sentry.flush !== 'function') return Promise.resolve(true);
  return sentry.flush(timeoutMs).catch(() => false);
}

function _resetForTests() {
  sentry = null;
  initialized = false;
  processHandlersInstalled = false;
  alertCooldown.clear();
}

module.exports = {
  initErrorMonitor,
  installProcessHandlers,
  captureError,
  captureMessage,
  createExpressErrorHandler,
  createSlowRequestMonitor,
  getPublicClientConfig,
  isEnabled,
  flush,
  _resetForTests,
};
