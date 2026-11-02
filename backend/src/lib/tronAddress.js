'use strict';

/** Mainnet Base58Check TRON addresses: 34 chars, leading T, no 0/O/I/l. */
const TRON_BASE58_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function sanitizeTronAddressInput(addr) {
  if (addr == null) return '';
  return String(addr).trim();
}

function isValidTronBase58Address(addr) {
  const s = sanitizeTronAddressInput(addr);
  if (!s) return false;
  return TRON_BASE58_ADDRESS_RE.test(s);
}

/** @returns {string|null} Normalized address or null when empty / malformed. */
function normalizeTronAddressOrNull(addr) {
  const s = sanitizeTronAddressInput(addr);
  if (!isValidTronBase58Address(s)) return null;
  return s;
}

/**
 * Split DB rows with an `address` field into valid vs invalid (for logging / metrics).
 */
function partitionCustodialAddressRows(rows) {
  const valid = [];
  const invalid = [];
  for (const row of rows || []) {
    const normalized = normalizeTronAddressOrNull(row?.address);
    if (!normalized) {
      invalid.push(row);
      continue;
    }
    valid.push({ ...row, address: normalized });
  }
  return { valid, invalid };
}

module.exports = {
  TRON_BASE58_ADDRESS_RE,
  sanitizeTronAddressInput,
  isValidTronBase58Address,
  normalizeTronAddressOrNull,
  partitionCustodialAddressRows,
};
