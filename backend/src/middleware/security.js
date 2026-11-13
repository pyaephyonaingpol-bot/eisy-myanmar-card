/**
 * Express site security: Helmet headers + rate limiting.
 * Aligned with common UK/fintech API hardening practices.
 */

'use strict';

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

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

function rateLimitHandler(_req, res) {
  res.status(429).json({
    error: 'Too many requests. Please try again later.',
    code: 'RATE_LIMITED',
  });
}

/** Broad API protection against volumetric abuse. */
function createApiRateLimiter() {
  return rateLimit({
    windowMs: envInt('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    max: envInt('RATE_LIMIT_API_MAX', 300),
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    skip: shouldSkipRateLimit,
  });
}

/** Stricter limits on auth / OTP / PIN (brute-force resistance). */
function createAuthRateLimiter() {
  return rateLimit({
    windowMs: envInt('RATE_LIMIT_AUTH_WINDOW_MS', 15 * 60 * 1000),
    max: envInt('RATE_LIMIT_AUTH_MAX', 25),
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    skip: (req) => String(req.method || '').toUpperCase() === 'OPTIONS',
  });
}

/** KYC upload / submit — expensive + sensitive. */
function createKycRateLimiter() {
  return rateLimit({
    windowMs: envInt('RATE_LIMIT_KYC_WINDOW_MS', 60 * 60 * 1000),
    max: envInt('RATE_LIMIT_KYC_MAX', 20),
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    skip: (req) => String(req.method || '').toUpperCase() === 'OPTIONS',
  });
}

/** Signup / OTP send — tighter than general auth to stop temp-mail spam. */
function createSignupRateLimiter() {
  return rateLimit({
    windowMs: envInt('RATE_LIMIT_SIGNUP_WINDOW_MS', 60 * 60 * 1000),
    max: envInt('RATE_LIMIT_SIGNUP_MAX', 8),
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    skip: (req) => String(req.method || '').toUpperCase() === 'OPTIONS',
  });
}

/**
 * Virtual card issue — per authenticated user (falls back to IP).
 * Stops rapid consecutive Pagocards creates after account takeover / free-fee abuse.
 */
function createCardIssueRateLimiter() {
  return rateLimit({
    windowMs: envInt('RATE_LIMIT_CARD_ISSUE_WINDOW_MS', 60 * 60 * 1000),
    max: envInt('RATE_LIMIT_CARD_ISSUE_MAX', 3),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, _next, options) => {
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
      return rateLimitHandler(req, res, _next, options);
    },
    keyGenerator: (req) => {
      const uid = req.user?.id != null ? String(req.user.id) : '';
      if (uid) return `card-issue:user:${uid}`;
      return `card-issue:ip:${req.ip || 'unknown'}`;
    },
    validate: { keyGeneratorIpFallback: false },
    skip: (req) => String(req.method || '').toUpperCase() === 'OPTIONS',
  });
}

module.exports = {
  createHelmetMiddleware,
  createApiRateLimiter,
  createAuthRateLimiter,
  createKycRateLimiter,
  createSignupRateLimiter,
  createCardIssueRateLimiter,
  isWebhookPath,
  shouldSkipRateLimit,
};
