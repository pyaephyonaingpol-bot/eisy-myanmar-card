/**
 * Express site security: Helmet headers + rate limiting.
 * Aligned with common UK/fintech API hardening practices.
 *
 * Broad / auth / KYC / proxy / card-API limiters use a sliding-window
 * algorithm (Upstash Redis when configured, otherwise in-memory).
 * Card-issue abuse limiters keep express-rate-limit + strike handlers.
 */

'use strict';

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createSlidingWindowMiddleware } = require('./slidingWindowRateLimit');

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function isWebhookPath(req) {
  const url = String(req.originalUrl || req.url || '');
  return url.startsWith('/api/webhook') || url.startsWith('/webhook');
}

/** Never throttle CORS preflights — browsers need OPTIONS to succeed for SPA API calls. */
function shouldSkipRateLimit(req) {
  if (String(req.method || '').toUpperCase() === 'OPTIONS') return true;
  return isWebhookPath(req);
}

function skipOptionsOnly(req) {
  return String(req.method || '').toUpperCase() === 'OPTIONS';
}

/**
 * Security headers (XSS / clickjacking / MIME sniffing / HSTS in production).
 * CSP is intentionally not locked down to `default-src 'self'` only — the SPA
 * serves inline scripts; frameguard + nosniff still mitigate clickjacking/XSS vectors.
 */
function createHelmetMiddleware() {
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production'
    || process.env.VERCEL === '1';

  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    noSniff: true,
    xssFilter: true,
    hsts: isProd
      ? { maxAge: 31536000, includeSubDomains: true, preload: false }
      : false,
  });
}

function rateLimitHandler(_req, res, result = {}) {
  const retryAfterMs = Math.max(0, (result.reset || Date.now()) - Date.now());
  res.status(429).json({
    error: 'Too many requests. Please try again later.',
    code: 'RATE_LIMITED',
    retry_after_ms: retryAfterMs,
  });
}

function ipOrUserKey(req, prefix) {
  const uid = req.user?.id != null ? String(req.user.id) : '';
  if (uid) return `${prefix}:user:${uid}`;
  try {
    const { getRequestIp } = require('./ipBlocklist');
    return `${prefix}:ip:${getRequestIp(req) || req.ip || 'unknown'}`;
  } catch {
    return `${prefix}:ip:${req.ip || 'unknown'}`;
  }
}

/** Broad API protection against volumetric abuse (sliding window). */
function createApiRateLimiter() {
  return createSlidingWindowMiddleware({
    name: 'api',
    windowMs: envInt('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    limit: envInt('RATE_LIMIT_API_MAX', 300),
    skip: shouldSkipRateLimit,
    keyGenerator: (req) => ipOrUserKey(req, 'api'),
    handler: rateLimitHandler,
  });
}

/** Stricter limits on auth / OTP / PIN (brute-force resistance). */
function createAuthRateLimiter() {
  return createSlidingWindowMiddleware({
    name: 'auth',
    windowMs: envInt('RATE_LIMIT_AUTH_WINDOW_MS', 15 * 60 * 1000),
    limit: envInt('RATE_LIMIT_AUTH_MAX', 25),
    skip: skipOptionsOnly,
    keyGenerator: (req) => ipOrUserKey(req, 'auth'),
    handler: rateLimitHandler,
  });
}

/** KYC upload / submit — expensive + sensitive. */
function createKycRateLimiter() {
  return createSlidingWindowMiddleware({
    name: 'kyc',
    windowMs: envInt('RATE_LIMIT_KYC_WINDOW_MS', 60 * 60 * 1000),
    limit: envInt('RATE_LIMIT_KYC_MAX', 20),
    skip: skipOptionsOnly,
    keyGenerator: (req) => ipOrUserKey(req, 'kyc'),
    handler: rateLimitHandler,
  });
}

/** Signup / OTP send — tighter than general auth to stop temp-mail spam. */
function createSignupRateLimiter() {
  return createSlidingWindowMiddleware({
    name: 'signup',
    windowMs: envInt('RATE_LIMIT_SIGNUP_WINDOW_MS', 60 * 60 * 1000),
    limit: envInt('RATE_LIMIT_SIGNUP_MAX', 8),
    skip: skipOptionsOnly,
    keyGenerator: (req) => ipOrUserKey(req, 'signup'),
    handler: rateLimitHandler,
  });
}

/**
 * User card API paths that hit Pagocards (detail / tx / 3DS / topup / sync).
 * Separate from card-issue abuse limits — stops spam refresh / proxy burn.
 */
function createCardApiRateLimiter() {
  return createSlidingWindowMiddleware({
    name: 'card-api',
    windowMs: envInt('RATE_LIMIT_CARD_API_WINDOW_MS', 60 * 1000),
    limit: envInt('RATE_LIMIT_CARD_API_MAX', 60),
    skip: skipOptionsOnly,
    keyGenerator: (req) => ipOrUserKey(req, 'card-api'),
    handler: (req, res, result) => {
      const retryAfterMs = Math.max(0, (result.reset || Date.now()) - Date.now());
      return res.status(429).json({
        error: 'Too many card API requests. Please slow down.',
        code: 'CARD_API_RATE_LIMITED',
        retry_after_ms: retryAfterMs,
      });
    },
  });
}

/**
 * Pagocards reverse proxy (/api/pago) — keyed by IP + optional proxy key fingerprint.
 * Protects the Droplet whitelist from volumetric abuse even with a valid access key.
 */
function createPagoProxyRateLimiter() {
  return createSlidingWindowMiddleware({
    name: 'pago-proxy',
    windowMs: envInt('RATE_LIMIT_PAGO_PROXY_WINDOW_MS', 60 * 1000),
    limit: envInt('RATE_LIMIT_PAGO_PROXY_MAX', 120),
    skip: skipOptionsOnly,
    keyGenerator: (req) => {
      const { getRequestIp } = require('./ipBlocklist');
      const ip = getRequestIp(req) || req.ip || 'unknown';
      const keyHdr = String(
        req.headers['x-eisy-pago-proxy-key']
          || req.headers['x-pago-proxy-key']
          || ''
      ).trim().slice(0, 24);
      return keyHdr ? `pago-proxy:${ip}:${keyHdr}` : `pago-proxy:${ip}`;
    },
    handler: (req, res, result) => {
      const retryAfterMs = Math.max(0, (result.reset || Date.now()) - Date.now());
      return res.status(429).json({
        error: 'Too many Pagocards proxy requests. Please try again later.',
        code: 'PAGO_PROXY_RATE_LIMITED',
        retry_after_ms: retryAfterMs,
      });
    },
  });
}

/**
 * Supabase same-origin browser proxy (/supabase) — IP sliding window.
 */
function createSupabaseProxyRateLimiter() {
  return createSlidingWindowMiddleware({
    name: 'supabase-proxy',
    windowMs: envInt('RATE_LIMIT_SUPABASE_PROXY_WINDOW_MS', 60 * 1000),
    limit: envInt('RATE_LIMIT_SUPABASE_PROXY_MAX', 200),
    skip: skipOptionsOnly,
    keyGenerator: (req) => {
      const { getRequestIp } = require('./ipBlocklist');
      return `supabase-proxy:${getRequestIp(req) || req.ip || 'unknown'}`;
    },
    handler: rateLimitHandler,
  });
}

/**
 * Virtual card issue — per authenticated user (falls back to IP).
 * Default: 1 request / 24h / user (aligned with durable daily card cap).
 * On trip: abuse strike → auto-block.
 */
function createCardIssueRateLimiter() {
  return rateLimit({
    windowMs: envInt('RATE_LIMIT_CARD_ISSUE_WINDOW_MS', 24 * 60 * 60 * 1000),
    max: envInt('RATE_LIMIT_CARD_ISSUE_MAX', 1),
    standardHeaders: true,
    legacyHeaders: false,
    handler: async (req, res, _next, options) => {
      let blocked = false;
      try {
        const { getRequestIp } = require('./ipBlocklist');
        const { recordCardIssueAbuseStrike } = require('../services/cardIssueAbuseService');
        const result = await recordCardIssueAbuseStrike(req.user?.id, {
          reason: 'card_issue_user_rate_limit',
          ip: getRequestIp(req) || req.ip || null,
          path: String(req.originalUrl || req.url || ''),
          email: req.user?.email || null,
        });
        blocked = Boolean(result?.blocked);
      } catch (err) {
        console.warn('[rate-limit] card-issue abuse strike skipped:', err.message);
      }
      if (blocked) {
        return res.status(403).json({
          error: 'Account suspended due to card request abuse.',
          code: 'ACCOUNT_BLOCKED',
        });
      }
      try {
        const { notifyAdminSecurityAlert } = require('../services/telegram');
        notifyAdminSecurityAlert({
          title: 'Card issue rate limit hit',
          severity: 'high',
          details: [
            `User id: ${req.user?.id || 'n/a'}`,
            `Email: ${req.user?.email || 'n/a'}`,
            `IP: ${req.ip || 'unknown'}`,
            `Path: ${String(req.originalUrl || req.url || '').slice(0, 160)}`,
          ],
        });
      } catch (err) {
        console.warn('[rate-limit] card-issue alert skipped:', err.message);
      }
      return res.status(options.statusCode || 429).json({
        error: 'Daily card limit reached. You can only issue 1 card per day.',
        code: 'CARD_ISSUE_USER_RATE_LIMITED',
      });
    },
    keyGenerator: (req) => {
      const uid = req.user?.id != null ? String(req.user.id) : '';
      if (uid) return `card-issue:user:${uid}`;
      const { getRequestIp } = require('./ipBlocklist');
      return `card-issue:ip:${getRequestIp(req) || 'unknown'}`;
    },
    validate: { keyGeneratorIpFallback: false },
    skip: skipOptionsOnly,
  });
}

/**
 * Virtual card issue — hard IP cap (independent of user account).
 * Stops multi-account spam from one IP that bypasses the per-user limiter.
 * On trip: temporary ban the IP + Telegram alert.
 */
function createCardIssueIpRateLimiter() {
  const { getRequestIp, temporaryBanIp } = require('./ipBlocklist');
  return rateLimit({
    windowMs: envInt('RATE_LIMIT_CARD_ISSUE_IP_WINDOW_MS', 60 * 60 * 1000),
    max: envInt('RATE_LIMIT_CARD_ISSUE_IP_MAX', 3),
    standardHeaders: true,
    legacyHeaders: false,
    handler: async (req, res, _next, options) => {
      const ip = getRequestIp(req) || 'unknown';
      const banUntil = temporaryBanIp(ip);
      let blocked = false;
      if (req.user?.id) {
        try {
          const { recordCardIssueAbuseStrike } = require('../services/cardIssueAbuseService');
          const result = await recordCardIssueAbuseStrike(req.user.id, {
            reason: 'card_issue_ip_rate_limit',
            ip,
            path: String(req.originalUrl || req.url || ''),
            email: req.user?.email || null,
          });
          blocked = Boolean(result?.blocked);
        } catch (err) {
          console.warn('[rate-limit] card-issue IP abuse strike skipped:', err.message);
        }
      }
      try {
        const { notifyAdminSecurityAlert } = require('../services/telegram');
        notifyAdminSecurityAlert({
          title: 'Card issue IP rate limit — temporary ban',
          severity: 'critical',
          details: [
            `IP: ${ip}`,
            `User id: ${req.user?.id || 'n/a'}`,
            `Email: ${req.user?.email || 'n/a'}`,
            `Ban until: ${banUntil ? new Date(banUntil).toISOString() : 'n/a'}`,
            `Path: ${String(req.originalUrl || req.url || '').slice(0, 160)}`,
            'Add IP to BLOCKED_IPS for a durable deny across serverless instances.',
          ],
        });
      } catch (err) {
        console.warn('[rate-limit] card-issue IP alert skipped:', err.message);
      }
      if (blocked) {
        return res.status(403).json({
          error: 'Account suspended due to card request abuse.',
          code: 'ACCOUNT_BLOCKED',
        });
      }
      return res.status(429).json({
        error: 'Too many card requests from this network. Try again later.',
        code: 'CARD_ISSUE_IP_RATE_LIMITED',
        retry_after_ms: Math.max(0, (banUntil || Date.now()) - Date.now()),
      });
    },
    keyGenerator: (req) => `card-issue-ip:${getRequestIp(req) || 'unknown'}`,
    validate: { keyGeneratorIpFallback: false },
    skip: skipOptionsOnly,
  });
}

module.exports = {
  createHelmetMiddleware,
  createApiRateLimiter,
  createAuthRateLimiter,
  createKycRateLimiter,
  createSignupRateLimiter,
  createCardApiRateLimiter,
  createPagoProxyRateLimiter,
  createSupabaseProxyRateLimiter,
  createCardIssueRateLimiter,
  createCardIssueIpRateLimiter,
  isWebhookPath,
  shouldSkipRateLimit,
};
