/**
 * TRON USDT TRC20 deposit indexer — polls TronGrid for inbound transfers to the
 * master wallet and auto-credits matching pending deposit requests.
 *
 * Matching uses gross deposit amount + FIFO among open requests (shared deposit address).
 * Duplicate protection: tron_indexed_transfers table + deposit tx_hash uniqueness + claimForCredit.
 */

const { getDb } = require('../db');
const { getSetting, setSetting, parseRecordMetadata } = require('./settingsService');
const DepositRequest = require('../models/DepositRequest');
const {
  creditDepositAndVerify,
  assertTxHashAvailable,
  findVerifiedDepositByTxHash,
} = require('./depositService');
const { verifyUsdtTransaction, amountWithinTolerance, USDT_TRC20_CONTRACT } = require('./usdtBlockchainService');
const { getMasterWalletAddress } = require('./tronMasterWalletService');
const { formatUsdt } = require('./walletService');

const TRONGRID_HOST =
  process.env.TRON_FULL_HOST || process.env.TRONGRID_FULL_HOST || 'https://api.trongrid.io';
const CURSOR_KEY = 'tron_deposit_indexer_last_ms';
const POLL_MS = Math.max(15_000, parseInt(process.env.TRON_DEPOSIT_POLL_MS || '30000', 10) || 30_000);
const LOOKBACK_MS = Math.max(
  60_000,
  parseInt(process.env.TRON_DEPOSIT_LOOKBACK_MS || String(7 * 24 * 60 * 60 * 1000), 10)
    || 7 * 24 * 60 * 60 * 1000
);
const MATCH_WINDOW_MS = Math.max(
  60_000,
  parseInt(process.env.TRON_DEPOSIT_MATCH_WINDOW_MS || String(48 * 60 * 60 * 1000), 10)
    || 48 * 60 * 60 * 1000
);
const TRC20_DECIMALS = 6;

let pollTimer = null;
let pollInFlight = false;

function isIndexerEnabled() {
  if (String(process.env.TRON_DEPOSIT_INDEXER || '').toLowerCase() === 'false') {
    return false;
  }
  if (process.env.NODE_ENV === 'test') {
    return false;
  }
  try {
    getMasterWalletAddress();
    return true;
  } catch (_) {
    return false;
  }
}

function normalizeTronAddress(addr) {
  return String(addr || '').trim();
}

function parseTrc20Amount(raw) {
  if (raw == null) return NaN;
  const str = String(raw).trim();
  if (!str) return NaN;
  if (str.includes('.')) return parseFloat(str);
  const big = BigInt(str);
  const divisor = BigInt(10) ** BigInt(TRC20_DECIMALS);
  const whole = Number(big / divisor);
  const frac = Number(big % divisor) / Number(divisor);
  return Math.round((whole + frac) * 1e6) / 1e6;
}

async function fetchJson(url, timeoutMs = 20000) {
  const headers = { Accept: 'application/json' };
  const apiKey = process.env.TRONGRID_API_KEY || process.env.TRON_PRO_API_KEY;
  if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      const err = new Error(`TronGrid HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchIncomingTrc20Transfers({ address, minTimestamp, fingerprint }) {
  const params = new URLSearchParams({
    limit: '200',
    contract_address: USDT_TRC20_CONTRACT,
    only_to: 'true',
    order_by: 'block_timestamp,asc',
  });
  if (minTimestamp != null) params.set('min_timestamp', String(minTimestamp));
  if (fingerprint) params.set('fingerprint', fingerprint);

  const url = `${TRONGRID_HOST}/v1/accounts/${encodeURIComponent(address)}/transactions/trc20?${params}`;
  const data = await fetchJson(url);
  return {
    transfers: Array.isArray(data?.data) ? data.data : [],
    fingerprint: data?.meta?.fingerprint || null,
  };
}

async function getCursorMs() {
  const raw = await getSetting(CURSOR_KEY);
  const parsed = parseInt(String(raw || ''), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return Date.now() - LOOKBACK_MS;
}

async function setCursorMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await setSetting(CURSOR_KEY, String(Math.floor(ms)));
}

async function isTransferIndexed(txHash) {
  const db = getDb();
  const row = await db.get(
    'SELECT tx_hash, status FROM tron_indexed_transfers WHERE tx_hash = ?',
    txHash
  );
  return row || null;
}

async function recordIndexedTransfer({
  txHash,
  blockTimestamp,
  fromAddress,
  toAddress,
  amountUsdt,
  depositId,
  status,
  errorMessage,
  metadata,
}) {
  const db = getDb();
  await db.run(`
    INSERT INTO tron_indexed_transfers (
      tx_hash, block_timestamp, from_address, to_address, amount_usdt,
      deposit_id, status, error_message, metadata, processed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(tx_hash) DO UPDATE SET
      deposit_id = COALESCE(excluded.deposit_id, tron_indexed_transfers.deposit_id),
      status = excluded.status,
      error_message = excluded.error_message,
      metadata = COALESCE(excluded.metadata, tron_indexed_transfers.metadata),
      processed_at = datetime('now')
  `,
  txHash,
  blockTimestamp,
  fromAddress || null,
  toAddress,
  amountUsdt,
  depositId || null,
  status,
  errorMessage || null,
  metadata ? JSON.stringify(metadata) : null);
}

function isPlatformDirectUsdtDeposit(deposit) {
  const meta = parseRecordMetadata(deposit.metadata);
  const channel = meta.deposit_channel || meta.pricing?.deposit_channel;
  if (channel === 'p2p') return false;
  return deposit.purpose === 'usdt_topup' || deposit.deposit_currency === 'USDT';
}

async function findMatchingDeposit({ amountUsdt, blockTimestampMs, txHash }) {
  const db = getDb();
  const transferAtSec = Math.floor(blockTimestampMs / 1000);
  const windowStartSec = transferAtSec - Math.floor(MATCH_WINDOW_MS / 1000);

  const rows = await db.all(`
    SELECT dr.*
    FROM deposit_requests_v2 dr
    WHERE dr.purpose = 'usdt_topup'
      AND dr.deposit_currency = 'USDT'
      AND UPPER(COALESCE(dr.usdt_network, 'TRC20')) = 'TRC20'
      AND dr.status IN ('PENDING', 'SUBMITTED')
      AND datetime(dr.created_at) <= datetime(?, 'unixepoch')
      AND datetime(dr.created_at) >= datetime(?, 'unixepoch')
      AND (
        dr.tx_hash IS NULL OR TRIM(dr.tx_hash) = ''
        OR dr.tx_hash = ? OR dr.txn_id = ? OR dr.kpay_transaction_id = ?
      )
    ORDER BY dr.created_at ASC
    LIMIT 50
  `, transferAtSec, windowStartSec, txHash, txHash, txHash);

  for (const row of rows) {
    if (!isPlatformDirectUsdtDeposit(row)) continue;

    const meta = parseRecordMetadata(row.metadata);
    const expectedGross = Number(row.amount_usd ?? meta.amount_usdt ?? meta.gross_usdt ?? 0);
    if (!amountWithinTolerance(amountUsdt, expectedGross)) continue;

    if (row.tx_hash && String(row.tx_hash).trim() && String(row.tx_hash).trim() !== txHash) {
      continue;
    }

    return row;
  }

  return null;
}

async function processIncomingTransfer(transfer, masterAddress) {
  const txHash = String(transfer.transaction_id || transfer.transactionId || '').trim();
  if (!txHash) {
    return { skipped: true, reason: 'missing_tx_hash' };
  }

  const existing = await isTransferIndexed(txHash);
  if (existing && ['credited', 'orphan', 'duplicate'].includes(existing.status)) {
    return { skipped: true, reason: 'already_indexed', status: existing.status };
  }

  const toAddress = normalizeTronAddress(transfer.to || transfer.to_address);
  if (toAddress !== normalizeTronAddress(masterAddress)) {
    return { skipped: true, reason: 'wrong_recipient' };
  }

  const tokenAddr = normalizeTronAddress(
    transfer.token_info?.address || transfer.contract_address || transfer.tokenId
  );
  const symbol = String(transfer.token_info?.symbol || transfer.token_info?.name || '').toUpperCase();
  if (tokenAddr !== USDT_TRC20_CONTRACT && symbol !== 'USDT') {
    return { skipped: true, reason: 'not_usdt' };
  }

  if (String(transfer.type || '').toLowerCase() === 'approval') {
    return { skipped: true, reason: 'approval_not_transfer' };
  }

  const amountUsdt = parseTrc20Amount(transfer.value ?? transfer.amount ?? transfer.quant);
  if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
    return { skipped: true, reason: 'invalid_amount' };
  }

  const blockTimestamp = Number(transfer.block_timestamp || transfer.blockTimestamp || 0);
  if (!Number.isFinite(blockTimestamp) || blockTimestamp <= 0) {
    return { skipped: true, reason: 'invalid_timestamp' };
  }

  const verifiedExisting = await findVerifiedDepositByTxHash(txHash);
  if (verifiedExisting) {
    await recordIndexedTransfer({
      txHash,
      blockTimestamp,
      fromAddress: transfer.from,
      toAddress,
      amountUsdt,
      depositId: verifiedExisting.id,
      status: 'duplicate',
      errorMessage: 'TxHash already used for verified deposit',
    });
    return { skipped: true, reason: 'duplicate_verified', depositId: verifiedExisting.id };
  }

  const deposit = await findMatchingDeposit({
    amountUsdt,
    blockTimestampMs: blockTimestamp,
    txHash,
  });

  if (!deposit) {
    await recordIndexedTransfer({
      txHash,
      blockTimestamp,
      fromAddress: transfer.from,
      toAddress,
      amountUsdt,
      status: 'orphan',
      errorMessage: 'No matching pending USDT deposit request',
      metadata: { amount_usdt: amountUsdt },
    });
    console.warn(
      `[tron-indexer] Orphan inbound transfer ${txHash}: ${formatUsdt(amountUsdt)} — no open deposit match`
    );
    return { orphan: true, txHash, amountUsdt };
  }

  try {
    await assertTxHashAvailable(txHash, deposit.id);
  } catch (err) {
    await recordIndexedTransfer({
      txHash,
      blockTimestamp,
      fromAddress: transfer.from,
      toAddress,
      amountUsdt,
      depositId: deposit.id,
      status: 'duplicate',
      errorMessage: err.message,
    });
    return { skipped: true, reason: 'tx_hash_reused', error: err.message };
  }

  const meta = parseRecordMetadata(deposit.metadata);
  const expectedAddress = meta.deposit_address || masterAddress;
  const expectedGross = Number(deposit.amount_usd ?? meta.amount_usdt ?? 0);

  let verification;
  try {
    verification = await verifyUsdtTransaction({
      network: 'TRC20',
      txHash,
      expectedAddress,
      expectedAmountUsdt: expectedGross,
    });
  } catch (err) {
    console.warn(`[tron-indexer] Verify error for ${txHash}:`, err.message);
    return { retry: true, txHash, error: err.message };
  }

  if (!verification.ok) {
    if (verification.status === 'pending') {
      return { retry: true, txHash, verification };
    }
    await recordIndexedTransfer({
      txHash,
      blockTimestamp,
      fromAddress: transfer.from,
      toAddress,
      amountUsdt,
      depositId: deposit.id,
      status: 'error',
      errorMessage: verification.message || 'On-chain verification failed',
      metadata: { verification },
    });
    return { error: true, txHash, verification };
  }

  let workingDeposit = deposit;
  if (workingDeposit.status === 'PENDING') {
    workingDeposit = await DepositRequest.submitProof(deposit.id, {
      kpayTransactionId: txHash,
      txnId: txHash,
      txHash,
      userNote: 'Auto-detected by TRON deposit indexer',
    });
  }

  try {
    const creditResult = await creditDepositAndVerify(workingDeposit, {
      txnId: txHash,
      createdBy: 'tron-indexer',
      adminNote: `Auto-credited via TRON indexer — ${formatUsdt(verification.amountUsdt)} on-chain`,
    });

    await recordIndexedTransfer({
      txHash,
      blockTimestamp,
      fromAddress: transfer.from,
      toAddress,
      amountUsdt,
      depositId: creditResult.deposit?.id || deposit.id,
      status: creditResult.alreadyVerified ? 'duplicate' : 'credited',
      metadata: {
        ref_code: deposit.ref_code,
        user_id: deposit.user_id,
        verification,
      },
    });

    if (!creditResult.alreadyVerified) {
      console.log(
        `[tron-indexer] Credited deposit #${deposit.id} (${deposit.ref_code}) `
        + `from tx ${txHash} — ${formatUsdt(verification.amountUsdt)}`
      );
    }

    return {
      credited: !creditResult.alreadyVerified,
      alreadyVerified: Boolean(creditResult.alreadyVerified),
      depositId: deposit.id,
      txHash,
      blockTimestamp,
    };
  } catch (err) {
    await recordIndexedTransfer({
      txHash,
      blockTimestamp,
      fromAddress: transfer.from,
      toAddress,
      amountUsdt,
      depositId: deposit.id,
      status: 'error',
      errorMessage: err.message,
    });
    console.error(`[tron-indexer] Credit failed for ${txHash}:`, err.message);
    return { error: true, txHash, errorMessage: err.message };
  }
}

async function pollMasterWalletDeposits() {
  if (!isIndexerEnabled()) {
    return { enabled: false };
  }
  if (pollInFlight) {
    return { skipped: true, reason: 'in_flight' };
  }

  pollInFlight = true;
  const stats = {
    fetched: 0,
    credited: 0,
    orphans: 0,
    skipped: 0,
    errors: 0,
    retries: 0,
  };

  try {
    const masterAddress = getMasterWalletAddress();
    let minTimestamp = await getCursorMs();
    let fingerprint = null;
    let maxTimestamp = minTimestamp;
    let pages = 0;

    do {
      const page = await fetchIncomingTrc20Transfers({
        address: masterAddress,
        minTimestamp,
        fingerprint,
      });
      pages += 1;
      fingerprint = page.fingerprint;
      const batch = page.transfers || [];
      stats.fetched += batch.length;

      for (const transfer of batch) {
        const ts = Number(transfer.block_timestamp || 0);
        if (Number.isFinite(ts) && ts > maxTimestamp) {
          maxTimestamp = ts;
        }

        const result = await processIncomingTransfer(transfer, masterAddress);
        if (result.credited) stats.credited += 1;
        else if (result.orphan) stats.orphans += 1;
        else if (result.retry) stats.retries += 1;
        else if (result.error) stats.errors += 1;
        else stats.skipped += 1;
      }

      if (!fingerprint || batch.length === 0) break;
      if (pages >= 20) {
        console.warn('[tron-indexer] Stopping pagination after 20 pages — will continue next poll');
        break;
      }
    } while (fingerprint);

    if (maxTimestamp > minTimestamp) {
      await setCursorMs(maxTimestamp);
    }

    if (stats.credited > 0 || stats.orphans > 0) {
      console.log('[tron-indexer] Poll complete:', stats);
    }

    return { ...stats, masterAddress, cursorMs: maxTimestamp };
  } catch (err) {
    console.error('[tron-indexer] Poll failed:', err.message);
    return { error: err.message, ...stats };
  } finally {
    pollInFlight = false;
  }
}

function startTronDepositIndexer() {
  if (!isIndexerEnabled()) {
    console.log('[tron-indexer] Disabled (set MASTER_WALLET_ADDRESS / MASTER_PRIVATE_KEY and TRON_DEPOSIT_INDEXER!=false)');
    return null;
  }

  if (pollTimer) return pollTimer;

  const masterAddress = getMasterWalletAddress();
  console.log(
    `[tron-indexer] Starting — polling ${masterAddress} every ${Math.round(POLL_MS / 1000)}s via TronGrid`
  );

  pollMasterWalletDeposits().catch((err) => {
    console.error('[tron-indexer] Initial poll failed:', err.message);
  });

  pollTimer = setInterval(() => {
    pollMasterWalletDeposits().catch((err) => {
      console.error('[tron-indexer] Poll failed:', err.message);
    });
  }, POLL_MS);
  pollTimer.unref?.();

  return pollTimer;
}

function stopTronDepositIndexer() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function getIndexerStatus() {
  const enabled = isIndexerEnabled();
  let masterAddress = null;
  try {
    masterAddress = enabled ? getMasterWalletAddress() : null;
  } catch (_) { /* ignore */ }

  const db = getDb();
  const counts = await db.get(`
    SELECT
      SUM(CASE WHEN status = 'credited' THEN 1 ELSE 0 END) AS credited,
      SUM(CASE WHEN status = 'orphan' THEN 1 ELSE 0 END) AS orphans,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
      COUNT(*) AS total
    FROM tron_indexed_transfers
  `);

  return {
    enabled,
    polling: Boolean(pollTimer),
    poll_interval_ms: POLL_MS,
    master_address: masterAddress,
    cursor_ms: enabled ? await getCursorMs() : null,
    indexed: {
      total: Number(counts?.total || 0),
      credited: Number(counts?.credited || 0),
      orphans: Number(counts?.orphans || 0),
      errors: Number(counts?.errors || 0),
    },
  };
}

module.exports = {
  isIndexerEnabled,
  pollMasterWalletDeposits,
  processIncomingTransfer,
  startTronDepositIndexer,
  stopTronDepositIndexer,
  getIndexerStatus,
};
