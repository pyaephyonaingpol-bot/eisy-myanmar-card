/**
 * Shared USDT amount helpers — 2 decimal places for all ledger debits/credits.
 * Caps prevent fat-finger and abuse on top-up / internal transfer.
 */

'use strict';

const USDT_DECIMALS = 2;
const USDT_SCALE = 10 ** USDT_DECIMALS;

/** Default safety caps (USDT). Override via env. */
const MAX_CARD_TOPUP_USDT = Math.max(
  1,
  Number(process.env.MAX_CARD_TOPUP_USDT || 50000) || 50000
);
const MAX_INTERNAL_TRANSFER_USDT = Math.max(
  1,
  Number(process.env.MAX_INTERNAL_TRANSFER_USDT || 50000) || 50000
);
const MIN_POSITIVE_USDT = 0.01;

function roundUsdt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * USDT_SCALE) / USDT_SCALE;
}

/**
 * Validate and normalize a user-supplied USDT amount.
 * Rejects NaN / Infinity / negative / zero (unless allowZero) / above max.
 *
 * @returns {number} rounded amount
 */
function assertUsdtAmount(raw, {
  min = MIN_POSITIVE_USDT,
  max = null,
  field = 'amount',
  allowZero = false,
} = {}) {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    const err = new Error(`${field} must be a finite number`);
    err.code = 'INVALID_AMOUNT';
    err.status = 400;
    throw err;
  }
  const amount = roundUsdt(n);
  if (!Number.isFinite(amount)) {
    const err = new Error(`${field} must be a finite number`);
    err.code = 'INVALID_AMOUNT';
    err.status = 400;
    throw err;
  }
  if (allowZero ? amount < 0 : amount <= 0) {
    const err = new Error(`${field} must be positive`);
    err.code = 'INVALID_AMOUNT';
    err.status = 400;
    throw err;
  }
  if (min != null && amount < Number(min) - 1e-12) {
    const err = new Error(`${field} must be at least ${Number(min).toFixed(2)} USDT`);
    err.code = 'AMOUNT_TOO_SMALL';
    err.status = 400;
    throw err;
  }
  if (max != null && amount > Number(max) + 1e-12) {
    const err = new Error(`${field} cannot exceed ${Number(max).toFixed(2)} USDT`);
    err.code = 'AMOUNT_TOO_LARGE';
    err.status = 400;
    throw err;
  }
  return amount;
}

module.exports = {
  USDT_DECIMALS,
  USDT_SCALE,
  MIN_POSITIVE_USDT,
  MAX_CARD_TOPUP_USDT,
  MAX_INTERNAL_TRANSFER_USDT,
  roundUsdt,
  assertUsdtAmount,
};
