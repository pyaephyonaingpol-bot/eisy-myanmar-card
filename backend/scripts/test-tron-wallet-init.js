#!/usr/bin/env node
'use strict';

/**
 * Verify MASTER_PRIVATE_KEY / TRON_MASTER_WALLET / TRON_API_KEY wiring.
 * Never prints secret values — only shapes, truncated address, and API reachability.
 *
 * Usage: node backend/scripts/test-tron-wallet-init.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
require('../src/lib/loadEnv');

const { envIsSet, firstEnv } = require('../src/lib/envAliases');
const {
  getMasterPrivateKey,
  getMasterWalletAddress,
  getMasterWalletInfo,
} = require('../src/services/tronMasterWalletService');

function maskAddress(addr) {
  const a = String(addr || '');
  if (a.length < 10) return a || null;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

async function pingTronGrid(apiKey) {
  const host = firstEnv('TRON_FULL_HOST', 'TRONGRID_FULL_HOST') || 'https://api.trongrid.io';
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${host.replace(/\/$/, '')}/wallet/getnowblock`, {
      method: 'POST',
      headers,
      body: '{}',
      signal: ctrl.signal,
    });
    let blockNum = null;
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      blockNum = body?.block_header?.raw_data?.number ?? null;
    }
    return { ok: res.ok, status: res.status, block: blockNum, host };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const report = {
    env: {
      MASTER_PRIVATE_KEY: envIsSet(
        'MASTER_PRIVATE_KEY',
        'MASTER_WALLET_PRIVATE_KEY',
        'TRON_MASTER_PRIVATE_KEY'
      ),
      TRON_MASTER_WALLET: envIsSet(
        'TRON_MASTER_WALLET',
        'MASTER_WALLET_ADDRESS',
        'MASTER_TRON_ADDRESS',
        'TRON_MASTER_ADDRESS'
      ),
      TRON_API_KEY: envIsSet('TRON_API_KEY', 'TRONGRID_API_KEY', 'TRON_PRO_API_KEY'),
    },
    wallet: null,
    trongrid: null,
    balance: null,
    ok: false,
  };

  console.log('TRON wallet init check (secrets never printed)\n');
  for (const [k, v] of Object.entries(report.env)) {
    console.log(`  ${v ? '✓' : '✗'} ${k}: ${v ? 'SET' : 'MISSING'}`);
  }

  if (!report.env.MASTER_PRIVATE_KEY) {
    console.error('\nFAIL: MASTER_PRIVATE_KEY is not set in this process environment.');
    console.error('Vercel Production secrets are not injected into Cloud Agents by default.');
    console.error('After deploy, verify with: curl -sS https://eisymyanmar.com/health/tron');
    process.exit(2);
  }

  try {
    getMasterPrivateKey();
    console.log('\n  ✓ private key parses (64-hex)');
  } catch (err) {
    console.error(`\nFAIL: private key init: ${err.code || ''} ${err.message}`);
    process.exit(1);
  }

  try {
    const address = getMasterWalletAddress();
    report.wallet = {
      address_masked: maskAddress(address),
      configured_explicit: report.env.TRON_MASTER_WALLET,
    };
    console.log(`  ✓ wallet address: ${report.wallet.address_masked}`);
  } catch (err) {
    console.error(`\nFAIL: wallet address: ${err.code || ''} ${err.message}`);
    process.exit(1);
  }

  const apiKey = firstEnv('TRON_API_KEY', 'TRONGRID_API_KEY', 'TRON_PRO_API_KEY');
  report.trongrid = await pingTronGrid(apiKey);
  console.log(
    `  ${report.trongrid.ok ? '✓' : '✗'} TronGrid ${report.trongrid.host} → HTTP ${report.trongrid.status}`
    + (report.trongrid.block != null ? ` block=${report.trongrid.block}` : '')
    + (apiKey ? ' (API key present)' : ' (no API key — public rate limits)')
  );

  try {
    const info = await getMasterWalletInfo();
    report.balance = {
      address_masked: maskAddress(info.address),
      usdt: info.usdtBalance,
      trx: info.trxBalance,
      source: info.source,
      trx_low: info.trxLow,
    };
    console.log(
      `  ✓ balance query via ${info.source}: USDT=${info.usdtBalance} TRX=${info.trxBalance}`
      + (info.trxLow ? ' (TRX low)' : '')
    );
  } catch (err) {
    console.error(`  ✗ balance query failed: ${err.code || ''} ${err.message}`);
    report.balance = { error: err.code || err.message };
  }

  report.ok = Boolean(
    report.env.MASTER_PRIVATE_KEY
    && report.wallet
    && report.trongrid?.ok
    && report.balance
    && report.balance.usdt != null
  );

  try {
    fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
    fs.writeFileSync(
      '/opt/cursor/artifacts/tron-wallet-init-check.json',
      JSON.stringify(report, null, 2)
    );
    console.log('\nWrote /opt/cursor/artifacts/tron-wallet-init-check.json');
  } catch (_) { /* ignore */ }

  if (!report.ok) {
    console.error('\nTRON wallet init check — FAILED');
    process.exit(1);
  }
  console.log('\nTRON wallet init check — OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
