'use strict';

const crypto = require('crypto');

function extractBearerToken(authorizationHeader) {
  const header = String(authorizationHeader || '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

function timingSafeEqualStrings(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Validate Vercel Cron / external scheduler Bearer token against CRON_SECRET.
 * @returns {{ authorized: boolean, code?: string, status?: number }}
 */
function authorizeCronBearer(authorizationHeader) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!secret) {
    return { authorized: false, code: 'CRON_NOT_CONFIGURED', status: 503 };
  }
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    return { authorized: false, code: 'CRON_UNAUTHORIZED', status: 401 };
  }
  if (!timingSafeEqualStrings(token, secret)) {
    return { authorized: false, code: 'CRON_UNAUTHORIZED', status: 401 };
  }
  return { authorized: true };
}

module.exports = {
  extractBearerToken,
  authorizeCronBearer,
};
