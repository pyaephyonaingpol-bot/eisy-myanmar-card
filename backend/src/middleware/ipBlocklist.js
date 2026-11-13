'use strict';

/**
 * IP deny-list for active abuse incidents.
 * - Hardcoded seeds for known spam sources
 * - BLOCKED_IPS / IP_BLOCKLIST env (comma/space separated)
 * - Runtime temporary bans (in-memory; also set BLOCKED_IPS for durable blocks)
 */

/** Known card-issue spam source (2026-11 incident). */
const HARDCODED_BLOCKED_IPS = Object.freeze([
  '162.35.41.40',
]);

/** @type {Map<string, number>} ip → ban expiry (epoch ms) */
const temporaryBans = new Map();

/** Avoid Telegram spam from the same blocked IP. */
const alertCooldownMs = 15 * 60 * 1000;
/** @type {Map<string, number>} */
const lastAlertAt = new Map();

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function normalizeIp(raw) {
  let ip = String(raw || '').trim().toLowerCase();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  // Strip brackets from IPv6 literals if present.
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  return ip;
}

function getRequestIp(req) {
  if (req?.ip) return normalizeIp(req.ip);
  const xff = req?.headers?.['x-forwarded-for'];
  if (xff) return normalizeIp(String(xff).split(',')[0]);
  return normalizeIp(req?.socket?.remoteAddress || req?.connection?.remoteAddress);
}

function loadEnvBlockedIps() {
  const raw = String(process.env.BLOCKED_IPS || process.env.IP_BLOCKLIST || '').trim();
  if (!raw) return [];
  return raw.split(/[,\s]+/).map(normalizeIp).filter(Boolean);
}

function pruneExpiredTempBans(now = Date.now()) {
  for (const [ip, until] of temporaryBans.entries()) {
    if (until <= now) temporaryBans.delete(ip);
  }
}

function isIpBlocked(ip) {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  if (HARDCODED_BLOCKED_IPS.includes(normalized)) return true;
  if (loadEnvBlockedIps().includes(normalized)) return true;
  pruneExpiredTempBans();
  const until = temporaryBans.get(normalized);
  return Boolean(until && until > Date.now());
}

/**
 * Temporarily ban an IP (in-memory). Prefer BLOCKED_IPS for durable blocks on Vercel.
 * @returns {number} ban expiry epoch ms
 */
function temporaryBanIp(ip, ttlMs) {
  const normalized = normalizeIp(ip);
  if (!normalized) return 0;
  const ttl = Math.max(
    60_000,
    Number(ttlMs) || envInt('CARD_ISSUE_IP_BAN_MS', 6 * 60 * 60 * 1000)
  );
  const until = Date.now() + ttl;
  const prev = temporaryBans.get(normalized) || 0;
  temporaryBans.set(normalized, Math.max(prev, until));
  return temporaryBans.get(normalized);
}

function maybeAlertBlockedIp(ip, path) {
  const normalized = normalizeIp(ip) || 'unknown';
  const now = Date.now();
  const last = lastAlertAt.get(normalized) || 0;
  if (now - last < alertCooldownMs) return;
  lastAlertAt.set(normalized, now);
  try {
    const { notifyAdminSecurityAlert } = require('../services/telegram');
    notifyAdminSecurityAlert({
      title: 'Blocked request from denylisted IP',
      severity: 'critical',
      details: [
        `IP: ${normalized}`,
        `Path: ${String(path || '').slice(0, 160)}`,
        'Action: 403 IP_BLOCKED',
      ],
    });
  } catch (err) {
    console.warn('[ip-blocklist] alert skipped:', err.message);
  }
}

function createIpBlocklistMiddleware() {
  return function ipBlocklistMiddleware(req, res, next) {
    if (String(req.method || '').toUpperCase() === 'OPTIONS') return next();
    const ip = getRequestIp(req);
    if (!isIpBlocked(ip)) return next();
    console.warn(
      '[ip-blocklist] denied',
      ip,
      String(req.method || '').toUpperCase(),
      String(req.originalUrl || req.url || '').slice(0, 160)
    );
    maybeAlertBlockedIp(ip, req.originalUrl || req.url);
    return res.status(403).json({
      error: 'Access denied',
      code: 'IP_BLOCKED',
    });
  };
}

module.exports = {
  HARDCODED_BLOCKED_IPS,
  normalizeIp,
  getRequestIp,
  loadEnvBlockedIps,
  isIpBlocked,
  temporaryBanIp,
  createIpBlocklistMiddleware,
};
