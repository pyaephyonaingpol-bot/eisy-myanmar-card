/**
 * Sliding-window rate limiter for Express.
 *
 * Prefer Upstash Redis when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 * (or KV_REST_API_URL + KV_REST_API_TOKEN) are set — shared across Vercel
 * instances. Otherwise falls back to an in-process true sliding window
 * (timestamps pruned to the active window).
 *
 * Always responds with HTTP 429 + code RATE_LIMITED when exceeded (unless a
 * custom handler is provided).
 */

'use strict';

/** @type {Map<string, number[]>} */
const memoryBuckets = new Map();

let upstashWarnedMissing = false;
/** @type {Map<string, any>} */
const upstashClients = new Map();

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function resolveUpstashEnv() {
  const url = String(
    process.env.UPSTASH_REDIS_REST_URL
      || process.env.KV_REST_API_URL
      || ''
  ).trim();
  const token = String(
    process.env.UPSTASH_REDIS_REST_TOKEN
      || process.env.KV_REST_API_TOKEN
      || ''
  ).trim();
  if (!url || !token) return null;
  return { url, token };
}

/** Convert ms → Upstash duration string ("10 s", "15 m", "1 h", "1 d"). */
function windowMsToUpstashDuration(windowMs) {
  const ms = Math.max(1, Math.floor(Number(windowMs) || 1));
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000} d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000} h`;
  if (ms % 60_000 === 0) return `${ms / 60_000} m`;
  const secs = Math.max(1, Math.ceil(ms / 1000));
  return `${secs} s`;
}

function pruneMemoryBucket(key, windowStart) {
  const arr = memoryBuckets.get(key);
  if (!arr || !arr.length) {
    memoryBuckets.delete(key);
    return [];
  }
  let i = 0;
  while (i < arr.length && arr[i] <= windowStart) i += 1;
  if (i > 0) arr.splice(0, i);
  if (!arr.length) {
    memoryBuckets.delete(key);
    return [];
  }
  return arr;
}

/**
 * In-memory true sliding window: keep request timestamps within [now-windowMs, now].
 * @returns {{ success: boolean, limit: number, remaining: number, reset: number, backend: string }}
 */
function consumeMemory(key, { limit, windowMs }) {
  const now = Date.now();
  const windowStart = now - windowMs;
  const arr = pruneMemoryBucket(key, windowStart);
  if (arr.length >= limit) {
    const oldest = arr[0] || now;
    return {
      success: false,
      limit,
      remaining: 0,
      reset: oldest + windowMs,
      backend: 'memory',
    };
  }
  arr.push(now);
  memoryBuckets.set(key, arr);
  return {
    success: true,
    limit,
    remaining: Math.max(0, limit - arr.length),
    reset: now + windowMs,
    backend: 'memory',
  };
}

function getUpstashRatelimit(name, limit, windowMs) {
  const env = resolveUpstashEnv();
  if (!env) return null;
  const cacheKey = `${name}:${limit}:${windowMs}`;
  if (upstashClients.has(cacheKey)) return upstashClients.get(cacheKey);

  try {
    // Lazy require so unit tests / local boots work without the packages
    // being resolvable in odd layouts.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const { Ratelimit } = require('@upstash/ratelimit');
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const { Redis } = require('@upstash/redis');
    const redis = new Redis({ url: env.url, token: env.token });
    const ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, windowMsToUpstashDuration(windowMs)),
      prefix: `@eisy/ratelimit:${name}`,
      analytics: false,
    });
    upstashClients.set(cacheKey, ratelimit);
    return ratelimit;
  } catch (err) {
    if (!upstashWarnedMissing) {
      upstashWarnedMissing = true;
      console.warn('[rate-limit] Upstash unavailable, using memory sliding window:', err.message);
    }
    return null;
  }
}

/**
 * Consume one slot for `key`.
 * @returns {Promise<{ success: boolean, limit: number, remaining: number, reset: number, backend: string }>}
 */
async function consumeSlidingWindow(key, {
  name = 'default',
  limit = 100,
  windowMs = 60_000,
} = {}) {
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 1));
  const safeWindow = Math.max(1, Math.floor(Number(windowMs) || 1));
  const id = String(key || 'anonymous');

  const upstash = getUpstashRatelimit(name, safeLimit, safeWindow);
  if (upstash) {
    try {
      const result = await upstash.limit(id);
      return {
        success: Boolean(result.success),
        limit: Number(result.limit) || safeLimit,
        remaining: Math.max(0, Number(result.remaining) || 0),
        reset: Number(result.reset) || (Date.now() + safeWindow),
        backend: 'upstash',
      };
    } catch (err) {
      console.warn('[rate-limit] Upstash limit() failed, falling back to memory:', err.message);
    }
  }

  return consumeMemory(`${name}:${id}`, { limit: safeLimit, windowMs: safeWindow });
}

function defaultKeyGenerator(req) {
  try {
    const { getRequestIp } = require('./ipBlocklist');
    const ip = getRequestIp(req) || req.ip || 'unknown';
    const uid = req.user?.id != null ? String(req.user.id) : '';
    return uid ? `user:${uid}` : `ip:${ip}`;
  } catch {
    return `ip:${req.ip || 'unknown'}`;
  }
}

function setRateLimitHeaders(res, result) {
  if (!res || typeof res.setHeader !== 'function') return;
  res.setHeader('X-RateLimit-Limit', String(result.limit));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.reset / 1000)));
  if (!result.success) {
    const retryAfterSec = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfterSec));
  }
}

function defaultExceedHandler(_req, res, result) {
  const retryAfterMs = Math.max(0, (result.reset || Date.now()) - Date.now());
  return res.status(429).json({
    error: 'Too many requests. Please try again later.',
    code: 'RATE_LIMITED',
    retry_after_ms: retryAfterMs,
  });
}

/**
 * Express middleware factory (sliding window).
 *
 * @param {object} options
 * @param {string} [options.name] — bucket namespace / Upstash prefix segment
 * @param {number} [options.limit]
 * @param {number} [options.windowMs]
 * @param {(req) => string|Promise<string>} [options.keyGenerator]
 * @param {(req) => boolean} [options.skip]
 * @param {(req, res, result) => any} [options.handler] — custom 429 handler
 */
function createSlidingWindowMiddleware(options = {}) {
  const name = String(options.name || 'api');
  const limit = options.limit != null ? options.limit : envInt('RATE_LIMIT_API_MAX', 300);
  const windowMs = options.windowMs != null
    ? options.windowMs
    : envInt('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);
  const keyGenerator = typeof options.keyGenerator === 'function'
    ? options.keyGenerator
    : defaultKeyGenerator;
  const skip = typeof options.skip === 'function' ? options.skip : null;
  const handler = typeof options.handler === 'function' ? options.handler : defaultExceedHandler;

  return async function slidingWindowRateLimit(req, res, next) {
    try {
      if (skip && skip(req)) return next();
      const key = await keyGenerator(req);
      const result = await consumeSlidingWindow(key, { name, limit, windowMs });
      setRateLimitHeaders(res, result);
      if (!result.success) {
        return handler(req, res, result);
      }
      return next();
    } catch (err) {
      console.warn('[rate-limit] middleware error (fail-open):', err.message);
      return next();
    }
  };
}

/** Test helper — clear in-memory buckets. */
function _resetMemoryBucketsForTests() {
  memoryBuckets.clear();
  upstashClients.clear();
}

function isUpstashConfigured() {
  return Boolean(resolveUpstashEnv());
}

module.exports = {
  consumeSlidingWindow,
  createSlidingWindowMiddleware,
  windowMsToUpstashDuration,
  isUpstashConfigured,
  defaultKeyGenerator,
  _resetMemoryBucketsForTests,
};
