'use strict';

/**
 * Durable card-issue abuse controls (survive serverless cold starts):
 * - Per-user daily limit from cards_v2.created_at (default 1 card / 24h)
 * - Strike ledger in transaction_logs → auto blockUser
 * - HMAC confirm tokens for human confirmation step
 */

const crypto = require('crypto');
const Card = require('../models/Card');
const TransactionLog = require('../models/TransactionLog');
const { firstEnv } = require('../lib/envAliases');

// Same secret source as PIN tokens in cryptoService.
const AUTH_SECRET = firstEnv('AUTH_SECRET', 'JWT_SECRET') || 'eisy-dev-secret-change-in-production';

const CONFIRM_ACK = 'ISSUE_VIRTUAL_CARD';
const CONFIRM_PURPOSE = 'card-issue-confirm';
const ABUSE_REF_TYPE = 'card_issue_abuse';
const ABUSE_LOG_TYPE = 'admin_adjustment';

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const DAILY_CARD_LIMIT_MESSAGE =
  'Daily card limit reached. You can only issue 1 card per day.';

/** Rolling 24h window for the durable daily card cap (DB-backed). */
function cardIssueDailyWindowMs() {
  return envInt('CARD_ISSUE_DAILY_WINDOW_MS', 24 * 60 * 60 * 1000);
}

function cardIssueDailyMax() {
  return envInt('CARD_ISSUE_DAILY_MAX', 1);
}

/** @deprecated alias — same as daily window (kept for older env docs). */
function cardIssueCooldownMs() {
  return envInt(
    'RATE_LIMIT_CARD_ISSUE_WINDOW_MS',
    cardIssueDailyWindowMs()
  );
}

function cardIssueConfirmTtlMs() {
  return envInt('CARD_ISSUE_CONFIRM_TTL_MS', 90 * 1000);
}

function abuseStrikeLimit() {
  return envInt('CARD_ISSUE_ABUSE_STRIKES', 3);
}

function abuseWindowMs() {
  return envInt('CARD_ISSUE_ABUSE_WINDOW_MS', 24 * 60 * 60 * 1000);
}

function parseSqliteTimeMs(value) {
  if (value == null) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  const s = String(value).trim();
  if (!s) return 0;
  // SQLite datetime('now') is UTC without timezone — treat as UTC.
  const normalized = /Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(' ', 'T')}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : 0;
}

function httpError(message, status, code, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function isCountableCardIssueRow(row) {
  const status = String(row?.status || '').toLowerCase();
  if (status === 'terminated' || status === 'cancelled') return false;
  // Pending placeholders that never became a real card still count toward
  // spam attempts if they were created via the issue path.
  return true;
}

/**
 * Last successful local card row time for this user (any non-terminated row).
 */
async function getLastCardIssueAtMs(userId) {
  const rows = await Card.findByUserId(userId);
  let latest = 0;
  for (const row of rows || []) {
    if (!isCountableCardIssueRow(row)) continue;
    const ms = parseSqliteTimeMs(row.created_at);
    if (ms > latest) latest = ms;
  }
  return latest;
}

/**
 * Count cards issued for this user inside the rolling daily window.
 * Uses cards_v2.created_at timestamps (durable across serverless instances).
 */
async function countCardsIssuedInWindow(userId, windowMs = cardIssueDailyWindowMs()) {
  const since = Date.now() - windowMs;
  const rows = await Card.findByUserId(userId);
  let count = 0;
  let latest = 0;
  for (const row of rows || []) {
    if (!isCountableCardIssueRow(row)) continue;
    const ms = parseSqliteTimeMs(row.created_at);
    if (ms >= since) {
      count += 1;
      if (ms > latest) latest = ms;
    }
  }
  return { count, last_at: latest || null };
}

/**
 * Durable daily limit: default 1 card per rolling 24 hours.
 */
async function assertCardIssueDailyLimit(userId) {
  const windowMs = cardIssueDailyWindowMs();
  const max = cardIssueDailyMax();
  const { count, last_at: lastAt } = await countCardsIssuedInWindow(userId, windowMs);
  if (count < max) {
    return { ok: true, count, last_at: lastAt, retry_after_ms: 0 };
  }
  const retryAfter = lastAt ? Math.max(0, windowMs - (Date.now() - lastAt)) : windowMs;
  const err = httpError(
    DAILY_CARD_LIMIT_MESSAGE,
    429,
    'CARD_ISSUE_DAILY_LIMIT',
    {
      retry_after_ms: retryAfter,
      last_issue_at: lastAt ? new Date(lastAt).toISOString() : null,
      issued_in_window: count,
      daily_max: max,
    }
  );
  err._cardIssueDailyLimit = true;
  // Backward-compatible flag for older strike handlers.
  err._cardIssueCooldown = true;
  throw err;
}

/** @deprecated use assertCardIssueDailyLimit */
async function assertCardIssueCooldown(userId) {
  return assertCardIssueDailyLimit(userId);
}

async function countRecentAbuseStrikes(userId) {
  const sinceMs = Date.now() - abuseWindowMs();
  const rows = await TransactionLog.findByUserId(userId, {
    limit: 50,
    type: ABUSE_LOG_TYPE,
  });
  let count = 0;
  for (const row of rows || []) {
    let meta = {};
    try {
      meta = row.metadata ? JSON.parse(row.metadata) : {};
    } catch {
      meta = {};
    }
    if (meta.action !== 'card_issue_abuse_strike') continue;
    if (String(row.reference_type || '') !== ABUSE_REF_TYPE) continue;
    const created = parseSqliteTimeMs(row.created_at);
    if (created >= sinceMs) count += 1;
  }
  return count;
}

/**
 * Record a strike; auto-block when threshold is reached.
 * @returns {{ strikes: number, blocked: boolean, block_result?: object }}
 */
async function recordCardIssueAbuseStrike(userId, {
  reason = 'card_issue_rate_abuse',
  ip = null,
  path = null,
  email = null,
} = {}) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) {
    return { strikes: 0, blocked: false };
  }

  await TransactionLog.create({
    userId: id,
    type: ABUSE_LOG_TYPE,
    direction: 'neutral',
    referenceType: ABUSE_REF_TYPE,
    referenceId: id,
    description: `Card issue abuse strike: ${reason}`,
    metadata: {
      action: 'card_issue_abuse_strike',
      reason,
      ip: ip || null,
      path: path || null,
      email: email || null,
    },
    ipAddress: ip || null,
    createdBy: 'system',
  }).catch((err) => {
    console.warn('[card-issue-abuse] strike log skipped:', err.message);
  });

  const strikes = await countRecentAbuseStrikes(id);
  const limit = abuseStrikeLimit();
  if (strikes < limit) {
    try {
      const { notifyAdminSecurityAlert } = require('./telegram');
      notifyAdminSecurityAlert({
        title: 'Card issue abuse strike',
        severity: 'high',
        details: [
          `User id: ${id}`,
          `Email: ${email || 'n/a'}`,
          `IP: ${ip || 'unknown'}`,
          `Strikes: ${strikes}/${limit}`,
          `Reason: ${reason}`,
          path ? `Path: ${String(path).slice(0, 160)}` : null,
        ].filter(Boolean),
      });
    } catch (_) { /* ignore */ }
    return { strikes, blocked: false };
  }

  let blockResult = null;
  try {
    const { blockUser } = require('./adminUserBlockService');
    blockResult = await blockUser(id, {
      reason: `Auto-blocked after ${strikes} card-issue abuse strikes (${reason})`,
      adminEmail: 'system:card-issue-abuse',
    });
  } catch (err) {
    console.error('[card-issue-abuse] auto-block failed:', err.message);
  }

  try {
    const { notifyAdminSecurityAlert } = require('./telegram');
    notifyAdminSecurityAlert({
      title: 'User auto-blocked — card issue abuse',
      severity: 'critical',
      details: [
        `User id: ${id}`,
        `Email: ${email || 'n/a'}`,
        `IP: ${ip || 'unknown'}`,
        `Strikes: ${strikes}/${limit}`,
        `Reason: ${reason}`,
        `Sessions revoked: ${blockResult?.sessions_revoked ?? 'n/a'}`,
      ],
    });
  } catch (_) { /* ignore */ }

  return { strikes, blocked: true, block_result: blockResult };
}

function createCardIssueConfirmToken(userId) {
  const exp = Date.now() + cardIssueConfirmTtlMs();
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${userId}.${exp}.${nonce}.${CONFIRM_PURPOSE}`;
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
  return {
    confirm_token: `${Buffer.from(payload).toString('base64url')}.${sig}`,
    confirm_ack: CONFIRM_ACK,
    expires_at: new Date(exp).toISOString(),
    expires_in_ms: cardIssueConfirmTtlMs(),
  };
}

function verifyCardIssueConfirmToken(token, userId) {
  if (!token) return false;
  try {
    const [payloadB64, sig] = String(token).split('.');
    if (!payloadB64 || !sig) return false;
    const payload = Buffer.from(payloadB64, 'base64url').toString();
    const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expBuf.length) return false;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;
    const [tokenUserId, exp, nonce, purpose] = payload.split('.');
    if (purpose !== CONFIRM_PURPOSE) return false;
    if (!nonce || nonce.length < 16) return false;
    if (parseInt(tokenUserId, 10) !== parseInt(userId, 10)) return false;
    if (Date.now() > parseInt(exp, 10)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Reject bot scripts that skip the confirm challenge or fill honeypots.
 */
function assertCardIssueBotChallenge(body = {}, userId) {
  const website = String(body.website ?? body.company_url ?? body.fax ?? '').trim();
  if (website) {
    throw httpError('Request rejected', 403, 'BOT_CHALLENGE_FAILED');
  }
  const intent = String(body.client_intent || '').trim();
  if (intent && intent !== 'issue_virtual_card') {
    throw httpError('Invalid client intent', 400, 'INVALID_CLIENT_INTENT');
  }
  const ack = String(body.confirm_ack || '').trim();
  if (ack !== CONFIRM_ACK) {
    throw httpError(
      'Confirm that you want to issue a virtual card, then try again.',
      403,
      'CARD_ISSUE_CONFIRM_REQUIRED'
    );
  }
  const token = String(body.confirm_token || '').trim();
  if (!verifyCardIssueConfirmToken(token, userId)) {
    throw httpError(
      'Card request confirmation expired or invalid. Confirm again.',
      403,
      'CARD_ISSUE_CONFIRM_INVALID'
    );
  }
  return true;
}

module.exports = {
  CONFIRM_ACK,
  CONFIRM_PURPOSE,
  DAILY_CARD_LIMIT_MESSAGE,
  cardIssueCooldownMs,
  cardIssueDailyWindowMs,
  cardIssueDailyMax,
  abuseStrikeLimit,
  getLastCardIssueAtMs,
  countCardsIssuedInWindow,
  assertCardIssueDailyLimit,
  assertCardIssueCooldown,
  countRecentAbuseStrikes,
  recordCardIssueAbuseStrike,
  createCardIssueConfirmToken,
  verifyCardIssueConfirmToken,
  assertCardIssueBotChallenge,
};
