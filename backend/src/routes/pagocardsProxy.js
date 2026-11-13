'use strict';

/**
 * Reverse proxy: /api/pago/* → Pagocards upstream so Droplet :3000 matches
 * PAGO_CARD_API_BASE_URL=http://HOST:3000/api/pago (no separate nginx required).
 *
 * SECURITY: Anonymous access is denied. Callers must send
 * `x-eisy-pago-proxy-key` matching PAGO_PROXY_ACCESS_KEY (or a SHA-256
 * derivation of PAGO_CARD_SECRET_KEY). The server-side Pagocards client
 * always attaches this header — browsers / attackers cannot use the Droplet
 * whitelist as an open card-create relay.
 *
 * Query strings are forwarded unchanged (e.g. `?pageNum=1`).
 *
 * Env:
 *   PAGO_PROXY_UPSTREAM_ORIGIN — default https://pagocards.com
 *   PAGO_PROXY_ACCESS_KEY — optional explicit shared secret
 */

const express = require('express');
const path = require('path');
const {
  PAGO_PROXY_ACCESS_HEADER,
  requestHasValidPagoProxyAccess,
} = require(path.join(__dirname, '../../../lib/pagoProxyAccess.cjs'));

const router = express.Router();

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

function resolveUpstreamOrigin() {
  const raw = String(process.env.PAGO_PROXY_UPSTREAM_ORIGIN || 'https://pagocards.com').trim();
  return raw.replace(/\/+$/, '');
}

/**
 * Path after /api/pago: may be /cards/x (client join) or /api/v1/cards/x.
 */
function upstreamPathname(restPath) {
  const p = restPath.startsWith('/') ? restPath : `/${restPath}`;
  if (/^\/api\/v1(\/|$)/i.test(p)) return p.replace(/\/{2,}/g, '/');
  if (/^\/api\/admin(\/|$)/i.test(p)) return p.replace(/\/{2,}/g, '/');
  if (p === '/' || p === '') return '/api/v1';
  return `/api/v1${p}`.replace(/\/{2,}/g, '/');
}

function buildForwardHeaders(req, upstreamUrl) {
  const out = {};
  const upstreamHost = upstreamUrl.hostname;
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    // Never forward our proxy gate key to Pagocards.
    if (lower === PAGO_PROXY_ACCESS_HEADER) continue;
    out[key] = value;
  }
  out.host = upstreamHost;
  out['x-forwarded-for'] = req.ip || req.socket?.remoteAddress || '';
  return out;
}

function bodyForForward(req) {
  const method = (req.method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return undefined;
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('application/json') && req.body != null && typeof req.body === 'object') {
    return JSON.stringify(req.body);
  }
  return undefined;
}

function alertUnauthorizedProxyAttempt(req) {
  try {
    const { notifyAdminSecurityAlert } = require('../services/telegram');
    const method = String(req.method || 'GET').toUpperCase();
    const url = String(req.originalUrl || req.url || '').slice(0, 200);
    notifyAdminSecurityAlert({
      title: 'Unauthorized Pagocards proxy attempt',
      severity: 'critical',
      details: [
        `Method: ${method}`,
        `Path: \`${url}\``,
        `IP: ${req.ip || req.socket?.remoteAddress || 'unknown'}`,
        'Action: blocked (missing/invalid proxy access key)',
      ],
    });
  } catch (err) {
    console.warn('[pago/proxy] security alert skipped:', err.message);
  }
}

router.use((req, res, next) => {
  if (String(req.method || '').toUpperCase() === 'OPTIONS') return next();
  if (requestHasValidPagoProxyAccess(req)) return next();
  console.warn(
    '[pago/proxy] denied unauthorized request',
    String(req.method || '').toUpperCase(),
    String(req.originalUrl || req.url || '').slice(0, 160),
    req.ip || ''
  );
  alertUnauthorizedProxyAttempt(req);
  return res.status(401).json({
    error: 'Pagocards proxy authentication required',
    code: 'PAGO_PROXY_UNAUTHORIZED',
  });
});

router.use(async (req, res) => {
  const origin = resolveUpstreamOrigin();
  let upstreamBase;
  try {
    upstreamBase = new URL(origin);
  } catch {
    return res.status(500).json({ error: 'Invalid PAGO_PROXY_UPSTREAM_ORIGIN', code: 'PAGO_PROXY_CONFIG' });
  }

  const full = req.originalUrl || `${req.baseUrl || ''}${req.url || '/'}`;
  const q = full.indexOf('?');
  const pathAndQuery = q >= 0 ? full.slice(0, q) : full;
  const search = q >= 0 ? full.slice(q) : '';

  const afterPago = pathAndQuery.replace(/^\/api\/pago\/?/i, '/') || '/';
  const upPath = upstreamPathname(afterPago === '/' ? '/api/v1' : afterPago);
  const target = new URL(upPath + search, `${upstreamBase.protocol}//${upstreamBase.host}`);

  const method = (req.method || 'GET').toUpperCase();
  const headers = buildForwardHeaders(req, target);
  if (!headers['content-type'] && method !== 'GET' && method !== 'HEAD') {
    headers['content-type'] = 'application/json';
  }

  const body = bodyForForward(req);
  if (body !== undefined) {
    delete headers['content-length'];
  }
  const timeoutMs = Math.min(120000, Math.max(5000, Number(process.env.PAGO_PROXY_TIMEOUT_MS) || 60000));

  try {
    const resp = await fetch(target.href, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const buf = Buffer.from(await resp.arrayBuffer());
    res.status(resp.status);
    for (const [k, v] of resp.headers.entries()) {
      const low = k.toLowerCase();
      if (HOP_BY_HOP.has(low) || low === 'content-encoding') continue;
      res.setHeader(k, v);
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res.send(buf);
  } catch (err) {
    console.error('[pago/proxy] upstream fetch failed', target.href, err.message || err);
    return res.status(502).json({
      error: 'Pagocards upstream unreachable',
      code: 'PAGO_PROXY_UPSTREAM_ERROR',
      detail: String(err.message || err).slice(0, 200),
    });
  }
});

module.exports = router;
