/**
 * Sweep USDT from per-user HD deposit addresses → master wallet.
 *
 * MANUAL ONLY — not started by cron or server boot. Trigger via:
 *   - POST /api/admin/sweep-deposits (admin API)
 *   - npm run sweep:tron-deposits (CLI)
 *
 * Because deposit addresses hold no TRX by default, each sweep:
 *   1. Sends a small TRX gas top-up from the master wallet → deposit address
 *   2. Waits briefly for confirmation
 *   3. Transfers the full USDT TRC-20 balance from the deposit address → master
 *
 * HD private keys are derived ephemerally and never persisted/logged.
 */
const {
  TronWeb,
} = require('tronweb');
const { getDb } = require('../db');
const tronMaster = require('./tronMasterWalletService');
const {
  isHdEnabled,
  deriveTronAddressForUser,
  deriveTronAccountAtIndex,
} = require('./tronHdWalletService');

const {
  USDT_TRC20_CONTRACT,
  USDT_TRC20_ABI,
  sunToUsdt,
} = tronMaster;

const TRON_FULL_HOST =
  process.env.TRON_FULL_HOST || process.env.TRONGRID_FULL_HOST || 'https://api.trongrid.io';
const DEFAULT_FEE_LIMIT = Number(process.env.TRON_USDT_FEE_LIMIT_SUN) || 100_000_000;

/** TRX sent from master → deposit address to cover USDT transfer bandwidth/energy burn. */
function getSweepGasTrx() {
  const n = Number(process.env.TRON_SWEEP_GAS_TRX || 1.1);
  return Number.isFinite(n) && n > 0 ? n : 1.1;
}

/** Skip USDT sweep when deposit balance is below this (USDT). */
function getMinSweepUsdt() {
  const n = Number(process.env.TRON_SWEEP_MIN_USDT || 0.01);
  return Number.isFinite(n) && n >= 0 ? n : 0.01;
}

/** Wait after TRX top-up before broadcasting USDT transfer (ms). */
function getGasWaitMs() {
  const n = parseInt(process.env.TRON_SWEEP_GAS_WAIT_MS || '3000', 10);
  return Number.isFinite(n) && n >= 0 ? n : 3000;
}

/**
 * If the deposit address already has at least this much TRX, skip the gas top-up.
 * Default slightly below gas amount so we don't re-fund every run.
 */
function getSkipGasIfTrxAtLeast() {
  const configured = process.env.TRON_SWEEP_SKIP_GAS_IF_TRX;
  if (configured != null && String(configured).trim() !== '') {
    const n = Number(configured);
    return Number.isFinite(n) && n >= 0 ? n : getSweepGasTrx() * 0.5;
  }
  return getSweepGasTrx() * 0.5;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTronWeb(privateKey) {
  const headers = {};
  const apiKey = process.env.TRONGRID_API_KEY || process.env.TRON_PRO_API_KEY;
  if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;
  return new TronWeb({
    fullHost: TRON_FULL_HOST,
    headers,
    privateKey,
  });
}

function trxToSun(amountTrx) {
  const n = Number(amountTrx);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('TRX amount must be a positive number');
  }
  return Math.round(n * 1e6);
}

function sunToTrx(sun) {
  return Number(sun || 0) / 1e6;
}

function extractTxId(result) {
  if (!result) return null;
  if (typeof result === 'string') return result;
  return result.txid || result.transaction?.txID || result.txID || null;
}

/**
 * Send native TRX from the master wallet to a deposit address (gas top-up).
 */
async function sendTrxFromMaster(toAddress, amountTrx, { dryRun = false, createTw = createTronWeb } = {}) {
  const masterKey = tronMaster.getMasterPrivateKey();
  const masterTw = createTw(masterKey);
  const fromAddress = masterTw.address.fromPrivateKey(masterKey);
  const to = String(toAddress || '').trim();

  if (!masterTw.isAddress(to)) {
    const err = new Error(`Invalid TRX destination: ${to}`);
    err.code = 'SWEEP_INVALID_DESTINATION';
    throw err;
  }
  if (to === fromAddress) {
    const err = new Error('Cannot send TRX gas to the master wallet itself');
    err.code = 'SWEEP_INVALID_DESTINATION';
    throw err;
  }

  const amountSun = trxToSun(amountTrx);
  const masterTrxSun = await masterTw.trx.getBalance(fromAddress);
  if (Number(masterTrxSun) < amountSun) {
    const err = new Error(
      `Master wallet has insufficient TRX for gas top-up `
      + `(need ${amountTrx} TRX, have ${sunToTrx(masterTrxSun)} TRX)`
    );
    err.code = 'SWEEP_INSUFFICIENT_MASTER_TRX';
    err.details = { needTrx: amountTrx, haveTrx: sunToTrx(masterTrxSun), master: fromAddress };
    throw err;
  }

  if (dryRun) {
    return {
      dryRun: true,
      fromAddress,
      toAddress: to,
      amountTrx: Number(amountTrx),
      amountSun,
      txId: null,
    };
  }

  const result = await masterTw.trx.sendTransaction(to, amountSun);
  const ok = result === true
    || result?.result === true
    || Boolean(extractTxId(result));
  if (!ok && result?.code) {
    const err = new Error(`TRX gas transfer failed: ${result.message || result.code}`);
    err.code = 'SWEEP_TRX_TRANSFER_FAILED';
    err.details = result;
    throw err;
  }

  const txId = extractTxId(result);
  if (!txId) {
    const err = new Error('TRX gas transfer submitted but no tx id returned');
    err.code = 'SWEEP_TRX_NO_TXID';
    throw err;
  }

  console.log(`[tron/sweep] TRX gas ${amountTrx} → ${to} tx=${txId}`);
  return {
    dryRun: false,
    fromAddress,
    toAddress: to,
    amountTrx: Number(amountTrx),
    amountSun,
    txId,
  };
}

/**
 * Transfer the full USDT balance from a deposit address to the master wallet.
 */
async function sweepUsdtToMaster({
  privateKeyHex,
  fromAddress,
  masterAddress,
  dryRun = false,
  createTw = createTronWeb,
} = {}) {
  const childTw = createTw(privateKeyHex);
  const from = String(fromAddress || childTw.address.fromPrivateKey(privateKeyHex)).trim();
  const to = String(masterAddress || tronMaster.getMasterWalletAddress()).trim();

  if (!childTw.isAddress(from) || !childTw.isAddress(to)) {
    const err = new Error('Invalid sweep from/to address');
    err.code = 'SWEEP_INVALID_ADDRESS';
    throw err;
  }
  if (from === to) {
    const err = new Error('Deposit address equals master — nothing to sweep');
    err.code = 'SWEEP_SAME_ADDRESS';
    throw err;
  }

  // Read-only balance query can use any TronWeb; prefer child instance.
  childTw.setAddress(from);
  const contract = await childTw.contract(USDT_TRC20_ABI, USDT_TRC20_CONTRACT);
  const raw = await contract.methods.balanceOf(from).call();
  const sun = (raw?.toString?.() ?? String(raw || '0'));
  const usdt = sunToUsdt(raw);
  const minUsdt = getMinSweepUsdt();

  if (!(usdt >= minUsdt) || BigInt(sun) <= 0n) {
    return {
      skipped: true,
      reason: 'below_min_usdt',
      fromAddress: from,
      toAddress: to,
      usdtBalance: usdt,
      minUsdt,
      txId: null,
    };
  }

  if (dryRun) {
    return {
      dryRun: true,
      skipped: false,
      fromAddress: from,
      toAddress: to,
      usdtBalance: usdt,
      amountSun: sun,
      txId: null,
    };
  }

  let txId;
  try {
    txId = await contract.methods.transfer(to, sun).send({
      feeLimit: DEFAULT_FEE_LIMIT,
      callValue: 0,
      shouldPollResponse: false,
      keepTxID: true,
    });
  } catch (err) {
    const wrapped = new Error(`USDT sweep failed: ${err.message || String(err)}`);
    wrapped.code = 'SWEEP_USDT_TRANSFER_FAILED';
    wrapped.cause = err;
    throw wrapped;
  }

  const hash = extractTxId(txId);
  if (!hash) {
    const err = new Error('USDT sweep submitted but no tx id returned');
    err.code = 'SWEEP_USDT_NO_TXID';
    throw err;
  }

  console.log(`[tron/sweep] USDT ${usdt} ${from} → ${to} tx=${hash}`);
  return {
    dryRun: false,
    skipped: false,
    fromAddress: from,
    toAddress: to,
    usdtBalance: usdt,
    amountUsdt: usdt,
    amountSun: sun,
    txId: hash,
  };
}

/**
 * Full single-address sweep: TRX gas from master, then USDT back to master.
 */
async function sweepDepositAddress({
  address,
  privateKeyHex,
  userId = null,
  derivationIndex = null,
  dryRun = false,
  forceGas = false,
  createTw = createTronWeb,
  waitFn = sleep,
} = {}) {
  if (!isHdEnabled() && !privateKeyHex) {
    const err = new Error('TRON HD is not configured — cannot derive deposit keys for sweep');
    err.code = 'TRON_HD_NOT_CONFIGURED';
    throw err;
  }

  let key = privateKeyHex;
  let fromAddress = String(address || '').trim();
  let index = derivationIndex;

  if (!key) {
    if (userId != null) {
      const derived = deriveTronAddressForUser(userId);
      key = derived.privateKeyHex;
      fromAddress = derived.address;
      index = derived.index;
    } else if (index != null) {
      const derived = deriveTronAccountAtIndex(Number(index));
      key = derived.privateKeyHex;
      fromAddress = derived.address;
    } else {
      const err = new Error('userId, derivationIndex, or privateKeyHex is required to sweep');
      err.code = 'SWEEP_KEY_REQUIRED';
      throw err;
    }
  }

  if (address && fromAddress && String(address).trim() !== fromAddress) {
    const err = new Error(
      `Address mismatch: provided ${address} but derived ${fromAddress}`
    );
    err.code = 'SWEEP_ADDRESS_MISMATCH';
    throw err;
  }

  const masterAddress = tronMaster.getMasterWalletAddress();
  const probeTw = createTw(key);
  probeTw.setAddress(fromAddress);

  // Peek USDT first — skip entirely when nothing to sweep.
  const contract = await probeTw.contract(USDT_TRC20_ABI, USDT_TRC20_CONTRACT);
  const rawBal = await contract.methods.balanceOf(fromAddress).call();
  const usdtBalance = sunToUsdt(rawBal);
  if (usdtBalance < getMinSweepUsdt()) {
    return {
      ok: true,
      skipped: true,
      reason: 'below_min_usdt',
      userId: userId != null ? Number(userId) : null,
      derivationIndex: index,
      depositAddress: fromAddress,
      masterAddress,
      usdtBalance,
      gas: null,
      usdt: null,
    };
  }

  const trxSun = await probeTw.trx.getBalance(fromAddress);
  const trxBalance = sunToTrx(trxSun);
  const gasTrx = getSweepGasTrx();
  const skipThreshold = getSkipGasIfTrxAtLeast();
  const needsGas = forceGas || trxBalance < skipThreshold;

  let gasResult = null;
  if (needsGas) {
    gasResult = await sendTrxFromMaster(fromAddress, gasTrx, { dryRun, createTw });
    if (!dryRun) {
      const waitMs = getGasWaitMs();
      if (waitMs > 0) {
        console.log(`[tron/sweep] waiting ${waitMs}ms for TRX gas confirmation…`);
        await waitFn(waitMs);
      }
    }
  } else {
    gasResult = {
      skipped: true,
      reason: 'deposit_has_trx',
      trxBalance,
      skipThreshold,
    };
  }

  const usdtResult = await sweepUsdtToMaster({
    privateKeyHex: key,
    fromAddress,
    masterAddress,
    dryRun,
    createTw,
  });

  return {
    ok: true,
    skipped: Boolean(usdtResult.skipped),
    reason: usdtResult.reason || null,
    userId: userId != null ? Number(userId) : null,
    derivationIndex: index,
    depositAddress: fromAddress,
    masterAddress,
    usdtBalance,
    trxBalanceBefore: trxBalance,
    gas: gasResult,
    usdt: usdtResult,
  };
}

/**
 * List custodial HD deposit addresses from the local DB.
 */
async function listSweepableDepositAddresses({ limit = 500 } = {}) {
  const db = getDb();
  const rows = await db.all(`
    SELECT id, user_id, address, derivation_index, derivation_path, updated_at
    FROM user_usdt_wallet_addresses
    WHERE network = 'TRC20'
      AND address_type = 'custodial'
      AND derivation_index IS NOT NULL
    ORDER BY derivation_index ASC
    LIMIT ?
  `, Math.min(Math.max(Number(limit) || 500, 1), 5000));
  return rows || [];
}

/**
 * Sweep one user by id (derives HD key from seed).
 */
async function sweepUserDeposit(userId, opts = {}) {
  return sweepDepositAddress({ userId, ...opts });
}

/**
 * Sweep all known custodial HD deposit addresses.
 */
async function sweepAllCustodialDeposits({
  dryRun = false,
  limit = 500,
  forceGas = false,
  onProgress = null,
  createTw = createTronWeb,
  waitFn = sleep,
} = {}) {
  const rows = await listSweepableDepositAddresses({ limit });
  const results = [];
  let swept = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const result = await sweepDepositAddress({
        userId: row.user_id,
        address: row.address,
        derivationIndex: row.derivation_index,
        dryRun,
        forceGas,
        createTw,
        waitFn,
      });
      results.push(result);
      if (result.skipped) skipped += 1;
      else swept += 1;
      if (typeof onProgress === 'function') onProgress(result);
    } catch (err) {
      failed += 1;
      const failure = {
        ok: false,
        userId: row.user_id,
        depositAddress: row.address,
        derivationIndex: row.derivation_index,
        error: err.message,
        code: err.code || 'SWEEP_FAILED',
      };
      results.push(failure);
      console.error('[tron/sweep] failed for user', row.user_id, err.message);
      if (typeof onProgress === 'function') onProgress(failure);
    }
  }

  return {
    ok: failed === 0,
    dryRun,
    checked: rows.length,
    swept,
    skipped,
    failed,
    gasTrx: getSweepGasTrx(),
    minUsdt: getMinSweepUsdt(),
    results,
  };
}

/** Prevent overlapping manual sweeps (admin API / CLI). Not a cron — invoke explicitly. */
let sweepInFlight = false;

async function runManualSweep({
  userId = null,
  dryRun = false,
  forceGas = false,
  limit = 500,
  createTw,
  waitFn,
} = {}) {
  if (sweepInFlight) {
    const err = new Error('A TRON deposit sweep is already in progress');
    err.code = 'SWEEP_IN_PROGRESS';
    throw err;
  }
  sweepInFlight = true;
  const startedAt = new Date().toISOString();
  try {
    const inject = {};
    if (createTw) inject.createTw = createTw;
    if (waitFn) inject.waitFn = waitFn;

    let summary;
    if (userId != null && userId !== '') {
      const id = Number(userId);
      if (!Number.isInteger(id) || id <= 0) {
        const err = new Error('user_id must be a positive integer');
        err.code = 'SWEEP_INVALID_USER';
        throw err;
      }
      const result = await sweepUserDeposit(id, { dryRun, forceGas, ...inject });
      summary = {
        ok: result.ok !== false,
        mode: 'user',
        dryRun: Boolean(dryRun),
        checked: 1,
        swept: result.skipped ? 0 : (result.ok === false ? 0 : 1),
        skipped: result.skipped ? 1 : 0,
        failed: result.ok === false ? 1 : 0,
        gasTrx: getSweepGasTrx(),
        minUsdt: getMinSweepUsdt(),
        results: [result],
      };
    } else {
      summary = await sweepAllCustodialDeposits({ dryRun, forceGas, limit, ...inject });
      summary.mode = 'all';
    }
    return {
      ...summary,
      manual: true,
      scheduled: false,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
  } finally {
    sweepInFlight = false;
  }
}

function isSweepInFlight() {
  return sweepInFlight;
}

module.exports = {
  getSweepGasTrx,
  getMinSweepUsdt,
  getGasWaitMs,
  sendTrxFromMaster,
  sweepUsdtToMaster,
  sweepDepositAddress,
  sweepUserDeposit,
  sweepAllCustodialDeposits,
  listSweepableDepositAddresses,
  runManualSweep,
  isSweepInFlight,
  trxToSun,
  sunToTrx,
};
