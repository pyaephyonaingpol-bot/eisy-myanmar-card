/**
 * Kripicard Instant Card maintenance / downtime helpers.
 *
 * Detects temporary provider outages (maintenance windows, 5xx, timeouts,
 * access-disabled) and shapes a stable, user-friendly payload the Instant Card
 * UI can show while polling for recovery.
 */

'use strict';

const CARD_PROVIDER_MAINTENANCE = 'CARD_PROVIDER_MAINTENANCE';
const CARD_ISSUANCE_PAUSED = 'CARD_ISSUANCE_PAUSED';

const DEFAULT_USER_MESSAGE =
  'Card issuing is temporarily unavailable while Kripicard performs maintenance. '
  + 'Your wallet was not charged (or was refunded). Please try again shortly.';

const DEFAULT_RETRY_AFTER_SECONDS = 60;

const MAINTENANCE_MESSAGE_RE = /maintenance|under\s*maint|temporarily\s*(unavailable|disabled|down)|service\s*unavailable|try\s*again\s*later|api access is disabled|provider.*(down|unavailable)|gateway\s*timeout|bad\s*gateway|overloaded/i;

function envFlag(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultValue;
}

/** Operator kill-switch: CARD_ISSUANCE_PAUSED=true blocks Instant Card issue. */
function isCardIssuancePaused() {
  return envFlag('CARD_ISSUANCE_PAUSED', false);
}

function retryAfterSeconds() {
  const n = Number(process.env.KRIPICARD_CARD_MAINTENANCE_RETRY_SEC);
  if (Number.isFinite(n) && n >= 15 && n <= 3600) return Math.floor(n);
  return DEFAULT_RETRY_AFTER_SECONDS;
}

function cardIssuancePausedPayload(extra = {}) {
  return {
    success: false,
    available: false,
    maintenance: true,
    retryable: true,
    retry_after_seconds: retryAfterSeconds(),
    error:
      'Instant Card issuing is temporarily paused for maintenance. '
      + 'Please try again in a few minutes — your USDT wallet will not be charged until issuing is restored.',
    code: CARD_ISSUANCE_PAUSED,
    message:
      'Instant Card issuing is temporarily paused for maintenance. '
      + 'Please try again in a few minutes — your USDT wallet will not be charged until issuing is restored.',
    ...extra,
  };
}

function assertCardIssuanceNotPaused() {
  if (!isCardIssuancePaused()) return;
  const payload = cardIssuancePausedPayload();
  const err = new Error(payload.error);
  err.code = payload.code;
  err.status = 503;
  err.retryable = true;
  err.retry_after_seconds = payload.retry_after_seconds;
  err.maintenance = true;
  throw err;
}

/**
 * True when a Kripicard/provider failure looks like temporary card maintenance
 * or downtime the user should retry later.
 */
function isTemporaryCardProviderOutage(err) {
  if (!err) return false;
  const code = String(err.code || '').toUpperCase();
  const providerCode = String(err.providerCode || err.body?.code || '').toUpperCase();
  const status = Number(err.status) || 0;
  const message = String(err.message || err.body?.message || '');

  if (
    code === CARD_PROVIDER_MAINTENANCE
    || code === CARD_ISSUANCE_PAUSED
    || code === 'KRIPICARD_API_ACCESS_DISABLED'
    || code === 'KRIPICARD_TIMEOUT'
    || code === 'KRIPICARD_SERVER_ERROR'
    || code === 'KRIPICARD_FORBIDDEN'
  ) {
    return true;
  }

  if (providerCode === 'API_ACCESS_DISABLED' || providerCode.includes('MAINTENANCE')) {
    return true;
  }

  if (status === 502 || status === 503 || status === 504 || status >= 500) {
    return true;
  }

  if (MAINTENANCE_MESSAGE_RE.test(message)) {
    return true;
  }

  return false;
}

/**
 * Normalize any thrown error into a card-maintenance shaped error when appropriate.
 * Leaves non-maintenance errors untouched.
 */
function asCardMaintenanceError(err, { refunded = null } = {}) {
  if (!err || !isTemporaryCardProviderOutage(err)) return err;
  if (err.code === CARD_ISSUANCE_PAUSED) return err;

  const retrySec = err.retry_after_seconds || retryAfterSeconds();
  const friendly = new Error(DEFAULT_USER_MESSAGE);
  friendly.code = CARD_PROVIDER_MAINTENANCE;
  friendly.status = 503;
  friendly.retryable = true;
  friendly.retry_after_seconds = retrySec;
  friendly.maintenance = true;
  friendly.providerCode = err.providerCode || err.body?.code || null;
  friendly.provider_status = err.status || null;
  friendly.cause_code = err.code || null;
  if (refunded != null) friendly.refunded = refunded;
  else if (err.refund_failed === true) friendly.refunded = false;
  else if (err.refunded != null) friendly.refunded = err.refunded;
  return friendly;
}

function cardProviderMaintenancePayload(err = null, extra = {}) {
  const normalized = err ? asCardMaintenanceError(err) : null;
  const retrySec = normalized?.retry_after_seconds || retryAfterSeconds();
  return {
    success: false,
    available: false,
    maintenance: true,
    retryable: true,
    retry_after_seconds: retrySec,
    error: normalized?.message || DEFAULT_USER_MESSAGE,
    message: normalized?.message || DEFAULT_USER_MESSAGE,
    code: normalized?.code || CARD_PROVIDER_MAINTENANCE,
    provider_code: normalized?.providerCode || null,
    provider_status: normalized?.provider_status || null,
    cause_code: normalized?.cause_code || null,
    refunded: normalized?.refunded,
    ...extra,
  };
}

/** Compact status block for GET /card/bins and /card/pricing-kripicard. */
function cardIssuanceAvailability({ providerError = null } = {}) {
  if (isCardIssuancePaused()) {
    const paused = cardIssuancePausedPayload();
    return {
      available: false,
      maintenance: true,
      retryable: true,
      retry_after_seconds: paused.retry_after_seconds,
      code: paused.code,
      message: paused.message,
    };
  }
  if (providerError && isTemporaryCardProviderOutage(providerError)) {
    const payload = cardProviderMaintenancePayload(providerError);
    return {
      available: false,
      maintenance: true,
      retryable: true,
      retry_after_seconds: payload.retry_after_seconds,
      code: payload.code,
      message: payload.message,
      provider_code: payload.provider_code,
    };
  }
  return {
    available: true,
    maintenance: false,
    retryable: false,
    retry_after_seconds: null,
    code: null,
    message: null,
  };
}

module.exports = {
  CARD_PROVIDER_MAINTENANCE,
  CARD_ISSUANCE_PAUSED,
  DEFAULT_USER_MESSAGE,
  DEFAULT_RETRY_AFTER_SECONDS,
  isCardIssuancePaused,
  cardIssuancePausedPayload,
  assertCardIssuanceNotPaused,
  isTemporaryCardProviderOutage,
  asCardMaintenanceError,
  cardProviderMaintenancePayload,
  cardIssuanceAvailability,
  retryAfterSeconds,
};
