'use strict';

/**
 * Reverse proxy: /supabase/* → NEXT_PUBLIC_SUPABASE_URL (*.supabase.co).
 *
 * Lets the browser (and Google OAuth authorize / callback hops) use
 * https://eisymyanmar.com/supabase instead of the raw project URL, without
 * a Supabase Pro custom domain.
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL — upstream origin (required)
 *   SUPABASE_BROWSER_PROXY_PATH — public mount path (default /supabase)
 *   SUPABASE_BROWSER_PROXY — set false/off to disable public URL rewriting
 *   PUBLIC_BASE_URL — site origin used when rewriting Location / redirect_uri
 *   SUPABASE_PROXY_TIMEOUT_MS — upstream fetch timeout (default 60000)
 */
const express = require('express');
const {
  getSupabaseConfig,
  supabaseBrowserProxyPath,
  resolvePublicSiteOrigin,
  rewriteSupabaseProxyLocation,
} = require('../lib/supabase');

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
  const { url } = getSupabaseConfig();
  return String(url || '').trim().replace(/\/+$/, '');
}

function buildForwardHeaders(req, upstreamUrl) {
  const out = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower === 'host') continue;
    out[key] = value;
  }
  out.host = upstreamUrl.hostname;
  out['x-forwarded-host'] = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  out['x-forwarded-proto'] = String(
    (req.headers['x-forwarded-proto'] || req.protocol || 'https')
  ).split(',')[0].trim();
  out['x-forwarded-for'] = req.ip || req.socket?.remoteAddress || '';
  return out;
}

function bodyForForward(req) {
  const method = (req.method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return undefined;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return req.body;
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('application/json') && req.body != null && typeof req.body === 'object') {
    return JSON.stringify(req.body);
  }
  if (ct.includes('application/x-www-form-urlencoded') && req.body && typeof req.body === 'object') {
    return new URLSearchParams(req.body).toString();
  }
  return undefined;
}

function restPathFromRequest(req) {
  const full = req.originalUrl || `${req.baseUrl || ''}${req.url || '/'}`;
  const q = full.indexOf('?');
  const pathOnly = q >= 0 ? full.slice(0, q) : full;
  const search = q >= 0 ? full.slice(q) : '';
  const mount = supabaseBrowserProxyPath();
  const escaped = mount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const after = pathOnly.replace(new RegExp(`^${escaped}\\/?`, 'i'), '/') || '/';
  return { pathname: after.replace(/\/{2,}/g, '/'), search };
}

router.use(async (req, res) => {
  const origin = resolveUpstreamOrigin();
  if (!origin || !/^https?:\/\//i.test(origin)) {
    return res.status(503).json({
      error: 'Supabase proxy is not configured',
      code: 'SUPABASE_PROXY_NOT_CONFIGURED',
    });
  }

  let upstreamBase;
  try {
    upstreamBase = new URL(origin);
  } catch {
    return res.status(500).json({
      error: 'Invalid NEXT_PUBLIC_SUPABASE_URL',
      code: 'SUPABASE_PROXY_CONFIG',
    });
  }

  const { pathname, search } = restPathFromRequest(req);
  const target = new URL(pathname + search, `${upstreamBase.protocol}//${upstreamBase.host}`);
  const method = (req.method || 'GET').toUpperCase();
  const headers = buildForwardHeaders(req, target);
  const body = bodyForForward(req);
  if (body !== undefined) {
    delete headers['content-length'];
  }

  const publicOrigin = resolvePublicSiteOrigin(req);
  const proxyPath = supabaseBrowserProxyPath();
  const timeoutMs = Math.min(
    120000,
    Math.max(5000, Number(process.env.SUPABASE_PROXY_TIMEOUT_MS) || 60000)
  );

  try {
    const resp = await fetch(target.href, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    const buf = Buffer.from(await resp.arrayBuffer());
    res.status(resp.status);
    for (const [k, v] of resp.headers.entries()) {
      const low = k.toLowerCase();
      if (HOP_BY_HOP.has(low) || low === 'content-encoding' || low === 'content-length') continue;
      if (low === 'location') {
        res.setHeader(
          k,
          rewriteSupabaseProxyLocation(v, {
            upstreamOrigin: origin,
            publicOrigin,
            proxyPath,
          })
        );
        continue;
      }
      res.setHeader(k, v);
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res.send(buf);
  } catch (err) {
    console.error('[supabase/proxy] upstream fetch failed', target.href, err.message || err);
    return res.status(502).json({
      error: 'Supabase upstream unreachable',
      code: 'SUPABASE_PROXY_UPSTREAM_ERROR',
      detail: String(err.message || err).slice(0, 200),
    });
  }
});

module.exports = router;
