#!/usr/bin/env node
/**
 * Lightweight fixed-IP egress proxy for Bitnob API calls.
 *
 * Deploy on a small VPS with a static public IP, whitelist that IP in Bitnob,
 * and point the Vercel app at this proxy via:
 *   BITNOB_EGRESS_PROXY_URL=https://your-proxy.example.com
 *   BITNOB_EGRESS_PROXY_SECRET=<shared secret>
 *
 * This process:
 *   - Requires X-Eisy-Bitnob-Proxy-Key on every /api/* request
 *   - Forwards method / path / query / body + Bitnob HMAC headers upstream
 *   - Only allows paths under /api/ (not an open relay)
 *
 * Run:
 *   BITNOB_EGRESS_PROXY_SECRET=… node backend/scripts/bitnob-egress-proxy.js
 *   npm run bitnob-egress-proxy
 *
 * Env:
 *   BITNOB_EGRESS_PROXY_SECRET   required shared secret
 *   BITNOB_EGRESS_UPSTREAM_URL   default https://api.bitnob.com
 *   BITNOB_API_BASE_URL          alias for upstream if EGRESS_UPSTREAM unset
 *   PORT / BITNOB_EGRESS_PROXY_PORT   listen port (default 8787)
 *   BITNOB_EGRESS_PROXY_BIND     bind address (default 0.0.0.0)
 *   BITNOB_EGRESS_PROXY_TIMEOUT_MS    upstream timeout (default 30000)
 */
'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const PROXY_KEY_HEADER = 'x-eisy-bitnob-proxy-key';
const FORWARDED_REQ_HEADERS = [
  'accept',
  'content-type',
  'x-auth-client',
  'x-auth-timestamp',
  'x-auth-nonce',
  'x-auth-signature',
];

function env(name, fallback = '') {
  const v = process.env[name];
  return v == null ? fallback : String(v).trim();
}

function requireSecret() {
  const secret = env('BITNOB_EGRESS_PROXY_SECRET');
  if (!secret || secret.includes('...')) {
    console.error(
      '[bitnob-egress-proxy] Set BITNOB_EGRESS_PROXY_SECRET to a strong shared secret.'
    );
    process.exit(1);
  }
  return secret;
}

function getUpstream() {
  const raw =
    env('BITNOB_EGRESS_UPSTREAM_URL')
    || env('BITNOB_API_BASE_URL')
    || 'https://api.bitnob.com';
  try {
    return new URL(raw.replace(/\/$/, ''));
  } catch {
    console.error('[bitnob-egress-proxy] Invalid upstream URL:', raw);
    process.exit(1);
  }
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) {
    // Still run a compare to keep timing flatter on length mismatch.
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function readBody(req, limitBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function pickForwardHeaders(req) {
  const out = {};
  for (const name of FORWARDED_REQ_HEADERS) {
    const value = req.headers[name];
    if (value != null && value !== '') out[name] = value;
  }
  return out;
}

function forwardToUpstream(upstream, req, bodyBuf, timeoutMs) {
  const target = new URL(req.url, upstream);
  // Hardening: never let the client override the upstream host via absolute-form.
  target.protocol = upstream.protocol;
  target.host = upstream.host;

  if (!target.pathname.startsWith('/api/')) {
    const err = new Error('Only /api/* paths may be proxied');
    err.statusCode = 404;
    return Promise.reject(err);
  }

  const transport = target.protocol === 'http:' ? http : https;
  const headers = {
    ...pickForwardHeaders(req),
    Host: upstream.host,
    Connection: 'close',
  };
  if (bodyBuf && bodyBuf.length) {
    headers['Content-Length'] = bodyBuf.length;
  }

  return new Promise((resolve, reject) => {
    const upstreamReq = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers,
        timeout: timeoutMs,
      },
      (upstreamRes) => {
        const chunks = [];
        upstreamRes.on('data', (c) => chunks.push(c));
        upstreamRes.on('end', () => {
          resolve({
            statusCode: upstreamRes.statusCode || 502,
            headers: upstreamRes.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );

    upstreamReq.on('timeout', () => {
      upstreamReq.destroy();
      const err = new Error(`Upstream timed out after ${timeoutMs}ms`);
      err.statusCode = 504;
      reject(err);
    });
    upstreamReq.on('error', (err) => {
      err.statusCode = err.statusCode || 502;
      reject(err);
    });

    if (bodyBuf && bodyBuf.length && req.method !== 'GET' && req.method !== 'HEAD') {
      upstreamReq.write(bodyBuf);
    }
    upstreamReq.end();
  });
}

function createBitnobEgressProxyServer(options = {}) {
  const secret = options.secret || requireSecret();
  const upstream = options.upstream || getUpstream();
  const timeoutMs = Number(options.timeoutMs || env('BITNOB_EGRESS_PROXY_TIMEOUT_MS') || 30000);

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    try {
      if (req.method === 'GET' && (req.url === '/health' || req.url === '/healthz')) {
        return sendJson(res, 200, {
          ok: true,
          service: 'bitnob-egress-proxy',
          upstream: upstream.origin,
        });
      }

      if (!req.url || !req.url.startsWith('/api/')) {
        return sendJson(res, 404, {
          success: false,
          message: 'Not found — this proxy only forwards /api/* to Bitnob',
        });
      }

      const provided = req.headers[PROXY_KEY_HEADER];
      if (!timingSafeEqualString(provided, secret)) {
        return sendJson(res, 401, {
          success: false,
          message: 'Unauthorized — missing or invalid proxy key',
          code: 'BITNOB_EGRESS_PROXY_UNAUTHORIZED',
        });
      }

      const bodyBuf = await readBody(req);
      const upstreamRes = await forwardToUpstream(upstream, req, bodyBuf, timeoutMs);

      const outHeaders = {
        'Cache-Control': 'no-store',
        Connection: 'close',
      };
      const contentType = upstreamRes.headers['content-type'];
      if (contentType) outHeaders['Content-Type'] = contentType;
      outHeaders['Content-Length'] = upstreamRes.body.length;
      outHeaders['X-Eisy-Bitnob-Proxy-Ms'] = String(Date.now() - started);

      res.writeHead(upstreamRes.statusCode, outHeaders);
      res.end(upstreamRes.body);
    } catch (err) {
      const status = err.statusCode || 502;
      console.error('[bitnob-egress-proxy]', err.message);
      sendJson(res, status, {
        success: false,
        message: err.message || 'Proxy error',
        code: 'BITNOB_EGRESS_PROXY_ERROR',
      });
    }
  });

  server.proxyMeta = { secret, upstream, timeoutMs, keyHeader: PROXY_KEY_HEADER };
  return server;
}

function main() {
  const secret = requireSecret();
  const upstream = getUpstream();
  const port = Number(env('PORT') || env('BITNOB_EGRESS_PROXY_PORT') || 8787);
  const bind = env('BITNOB_EGRESS_PROXY_BIND') || '0.0.0.0';
  const server = createBitnobEgressProxyServer({ secret, upstream });

  server.listen(port, bind, () => {
    console.log(
      `[bitnob-egress-proxy] listening on http://${bind}:${port} → ${upstream.origin}`
    );
    console.log(
      '[bitnob-egress-proxy] Whitelist this host\'s public IP in the Bitnob dashboard.'
    );
  });
}

module.exports = {
  PROXY_KEY_HEADER,
  createBitnobEgressProxyServer,
  timingSafeEqualString,
  pickForwardHeaders,
};

if (require.main === module) {
  main();
}
