'use strict';

/**
 * Programmatic Netts / TRON sweep env readiness (never logs secret values).
 */
const { envIsSet, firstEnv, tronFullHost } = require('../lib/envAliases');

const CHECKS = [
  {
    id: 'TRON_ENERGY_API_URL',
    label: 'TRON_ENERGY_API_URL',
    ok: () => envIsSet('TRON_ENERGY_API_URL'),
    hint: 'Netts order endpoint (e.g. https://netts.io/apiv2/order1h)',
  },
  {
    id: 'TRON_ENERGY_API_KEY',
    label: 'TRON_ENERGY_API_KEY',
    ok: () => envIsSet('TRON_ENERGY_API_KEY'),
    hint: 'Netts dashboard API key',
  },
  {
    id: 'TRON_NETTS_REAL_IP',
    label: 'TRON_NETTS_REAL_IP',
    ok: () => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(firstEnv('TRON_NETTS_REAL_IP')),
    hint: 'Droplet public IPv4 whitelisted in Netts (X-Real-IP header)',
  },
  {
    id: 'TRON_FULL_HOST',
    label: 'TRON_FULL_HOST',
    ok: () => Boolean(tronFullHost()),
    hint: () => {
      try {
        return `resolved host: ${new URL(tronFullHost()).host}`;
      } catch {
        return `host: ${tronFullHost()}`;
      }
    },
  },
  {
    id: 'CENTRAL_WALLET_ADDRESS',
    label: 'CENTRAL_WALLET_ADDRESS (or MASTER_WALLET_ADDRESS)',
    ok: () => envIsSet('CENTRAL_WALLET_ADDRESS', 'MASTER_WALLET_ADDRESS', 'TRON_MASTER_WALLET'),
    hint: 'USDT sweep destination',
  },
  {
    id: 'MASTER_PRIVATE_KEY',
    label: 'MASTER_PRIVATE_KEY',
    ok: () => envIsSet('MASTER_PRIVATE_KEY', 'MASTER_WALLET_PRIVATE_KEY', 'TRON_MASTER_PRIVATE_KEY'),
    hint: 'HD fallback + master signing',
  },
  {
    id: 'TRON_HD_SEED',
    label: 'TRON HD seed',
    ok: () => envIsSet('TRON_HD_MNEMONIC', 'TRON_HD_SEED_HEX') || envIsSet('MASTER_PRIVATE_KEY'),
    hint: 'TRON_HD_MNEMONIC preferred, or MASTER_PRIVATE_KEY fallback',
  },
  {
    id: 'TRON_API_KEY',
    label: 'TRON API key',
    ok: () => envIsSet('TRON_API_KEY', 'TRONGRID_API_KEY', 'TRON_PRO_API_KEY'),
    hint: 'TronGrid rate limits without a key',
  },
  {
    id: 'DATABASE_URL',
    label: 'DATABASE_URL (+ auth token for Turso)',
    ok: () => {
      const url = firstEnv('DATABASE_URL', 'TURSO_DATABASE_URL', 'LIBSQL_URL');
      if (!url) return false;
      if (/^libsql:\/\//i.test(url) || /turso/i.test(url)) {
        return envIsSet('DATABASE_AUTH_TOKEN', 'TURSO_AUTH_TOKEN', 'LIBSQL_AUTH_TOKEN');
      }
      return true;
    },
    hint: 'Custodial deposit address list',
  },
];

function evaluateSweepEnvChecks() {
  const results = CHECKS.map((row) => {
    const pass = row.ok();
    const hint = typeof row.hint === 'function' ? row.hint() : row.hint;
    return {
      id: row.id,
      label: row.label,
      ok: pass,
      hint: hint || null,
    };
  });
  const failed = results.filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    results,
    failed,
  };
}

async function evaluateSweepEnv({ verifyAddresses = false, preflightLimit = 1 } = {}) {
  const checks = evaluateSweepEnvChecks();
  let preflight = null;
  let preflightOk = true;

  try {
    const sweep = require('./tronSweepService');
    preflight = await sweep.buildSweepPreflightReport({
      verifyAddresses,
      limit: preflightLimit,
    });
    preflightOk = Boolean(preflight.ready);
  } catch (err) {
    preflightOk = false;
    preflight = { ready: false, blockers: ['PREFLIGHT_ERROR'], error: err.message };
  }

  const ok = checks.ok && preflightOk;
  return {
    ok,
    checks,
    preflight,
  };
}

module.exports = {
  evaluateSweepEnvChecks,
  evaluateSweepEnv,
};
