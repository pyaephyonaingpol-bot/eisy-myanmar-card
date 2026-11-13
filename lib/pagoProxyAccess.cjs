'use strict';

/**
 * Shared secret for /api/pago reverse proxy.
 * Prevents anonymous clients from using the Droplet's Pagocards IP whitelist
 * as an open relay when they possess (or guess) publickey/secretkey headers.
 */

const crypto = require('crypto');

const PAGO_PROXY_ACCESS_HEADER = 'x-eisy-pago-proxy-key';

function resolvePagoProxyAccessKey(env = process.env) {
  const explicit = String(env.PAGO_PROXY_ACCESS_KEY || '').trim();
  if (explicit) return explicit;
  const secret = String(env.PAGO_CARD_SECRET_KEY || '').trim();
  if (!secret) return '';
  return crypto
    .createHash('sha256')
    .update(`eisy-pago-proxy-v1:${secret}`)
    .digest('hex');
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requestHasValidPagoProxyAccess(req, env = process.env) {
  const expected = resolvePagoProxyAccessKey(env);
  if (!expected) return false;
  const provided = String(
    req?.headers?.[PAGO_PROXY_ACCESS_HEADER]
      || req?.headers?.['X-Eisy-Pago-Proxy-Key']
      || ''
  ).trim();
  return timingSafeEqualString(provided, expected);
}

module.exports = {
  PAGO_PROXY_ACCESS_HEADER,
  resolvePagoProxyAccessKey,
  timingSafeEqualString,
  requestHasValidPagoProxyAccess,
};
