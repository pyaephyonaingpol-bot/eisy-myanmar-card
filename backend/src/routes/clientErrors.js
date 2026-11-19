/**
 * Ingest browser / SPA error reports.
 * Rate-limited per IP; forwards severe events to errorMonitor (Sentry + Telegram).
 */

'use strict';

const express = require('express');
const { createSlidingWindowMiddleware } = require('../middleware/slidingWindowRateLimit');
const { captureError, captureMessage } = require('../services/errorMonitor');

const router = express.Router();

const ingestLimiter = createSlidingWindowMiddleware({
  name: 'client-errors',
  limit: Number(process.env.RATE_LIMIT_CLIENT_ERRORS_MAX || 30) || 30,
  windowMs: Number(process.env.RATE_LIMIT_CLIENT_ERRORS_WINDOW_MS || 60_000) || 60_000,
  keyGenerator: (req) => {
    try {
      const { getRequestIp } = require('../middleware/ipBlocklist');
      return `client-errors:${getRequestIp(req) || req.ip || 'unknown'}`;
    } catch {
      return `client-errors:${req.ip || 'unknown'}`;
    }
  },
});

router.post('/', ingestLimiter, (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const message = String(body.message || '').trim().slice(0, 400);
  if (!message) {
    return res.status(400).json({ error: 'message required', code: 'INVALID_PAYLOAD' });
  }

  const status = Number(body.status) || 0;
  const code = String(body.code || '').slice(0, 80) || null;
  const path = String(body.path || '').slice(0, 200) || null;
  const source = String(body.source || 'client').slice(0, 60);

  // Drop cascade / expected soft noise so SPA polls do not Telegram-storm.
  if (
    code === 'BOOTSTRAP_FAILED'
    || /bootstrap failed/i.test(message)
    || body.suppressErrorReport
    || (path && (
      path.includes('/api/client-errors')
      || path.includes('/api/config/monitoring')
    ))
    || (
      (code === 'REQUEST_TIMEOUT' || code === 'REQUEST_ABORTED' || code === 'NETWORK_ERROR')
      && path
      && (/\/api\/user\/cards\/[^/]+\/3ds/.test(path) || /\/api\/user\/cards\/3ds\//.test(path))
    )
  ) {
    console.warn('[client-errors] skipped cascade ingest', { code, path: path || null });
    return res.status(204).end();
  }

  const err = new Error(message);
  err.code = code || 'CLIENT_ERROR';
  err.status = status || undefined;
  if (body.stack) err.stack = String(body.stack).slice(0, 2000);

  const severe = status >= 500
    || status === 503
    || code === 'REQUEST_TIMEOUT'
    || code === 'NETWORK_ERROR'
    || source === 'window.onerror'
    || source === 'unhandledrejection';

  if (severe) {
    captureError(err, {
      source: `client:${source}`,
      title: 'Client-side error',
      path,
      method: body.method || null,
      status: status || null,
      severity: status >= 500 || code === 'REQUEST_TIMEOUT' ? 'high' : 'medium',
      tags: { kind: 'client_error', client_source: source },
      extra: {
        href: body.href ? String(body.href).slice(0, 300) : null,
        userAgent: body.userAgent ? String(body.userAgent).slice(0, 200) : null,
        fingerprint: body.fingerprint || null,
      },
    });
  } else {
    captureMessage(message, {
      level: 'warning',
      source: `client:${source}`,
      path,
      tags: { kind: 'client_error_soft' },
    });
  }

  return res.status(204).end();
});

module.exports = router;
