/**
 * Credit confirmed TRC20 USDT that arrives on a user's HD custodial address.
 *
 * The Supabase pending-order matcher only credits a transfer when an order
 * with the same amount already exists. A plain send to the HD address never
 * created that order, and Vercel does not keep the interval poller alive.
 * This watcher reads TronGrid (or a Tron-style webhook body), verifies the
 * transfer, and credits the custodial owner once per tx hash.
 */
const { getDb } = require('../db');
const { isTronDepositEnabled } = require('./securityFlags');

const USDT_TRC20_CONTRACT = process.env.USDT_TRC20_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const SCAN_INTERVAL_MS = Math.max(5000, parseInt(process.env.TRON_HD_SCAN_INTERVAL_MS || '20000', 10) || 20000);
const READ_SCAN_TIMEOUT_MS = Math.max(1000, parseInt(process.env.TRON_HD_READ_SCAN_TIMEOUT_MS || '6000', 10) || 6000);

const lastUserScanAt = new Map();
const userScanInflight = new Map();

function parseSqliteTimeMs(value) {
  if (!value) return NaN;
  const raw = String(value).trim();
  if (!raw) return NaN;
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const withZone = /Z$|[+-]\d\d:?\d\d$/.test(normalized) ? normalized : `${normalized}Z`;
  return Date.parse(withZone);
}

function humanUsdtFromRaw(raw, decimals = 6) {
  if (raw == null || raw === '') return NaN;
  const str = String(raw).trim();
  if (!str) return NaN;
  if (str.includes('.')) {
    const n = Number(str);
    return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : NaN;
  }
  try {
    const big = BigInt(str);
    const divisor = 10n ** BigInt(Number.isFinite(Number(decimals)) ? Number(decimals) : 6);
    const whole = Number(big / divisor);
    const frac = Number(big % divisor) / Number(divisor);
    return Math.round((whole + frac) * 1e6) / 1e6;
  } catch {
    return NaN;
  }
}

function looksLikeTransfer(body) {
  const type = String(body?.type || body?.eventName || body?.event_name || 'Transfer').toLowerCase();
  return type.includes('transfer');
}

function parseOneTronDepositNotice(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (!looksLikeTransfer(body)) return null;

  const topic = body.topicMap || body.result || {};
  const tokenInfo = body.token_info || body.tokenInfo || {};
  const symbol = String(tokenInfo.symbol || topic.symbol || '').trim().toUpperCase();
  if (symbol && symbol !== 'USDT') return null;

  const contract = String(
    body.contract_address
    || body.contractAddress
    || tokenInfo.address
    || ''
  ).trim();
  if (contract && contract !== USDT_TRC20_CONTRACT) return null;

  const txHash = String(
    body.tx_hash
    || body.txHash
    || body.txn_id
    || body.transaction_id
    || body.transactionId
    || body.txID
    || body.txId
    || ''
  ).trim();
  if (!txHash) return null;

  const toAddress = String(
    body.to_address
    || body.toAddress
    || body.address
    || body.to
    || topic.to
    || topic.to_address
    || ''
  ).trim();

  let amountUsdt = body.amount_usdt ?? body.amountUsdt ?? body.amount;
  if (amountUsdt == null || amountUsdt === '') {
    const raw = body.value ?? topic.value ?? topic.amount ?? body.quant;
    const decimals = Number(tokenInfo.decimals ?? topic.decimals ?? 6);
    amountUsdt = humanUsdtFromRaw(raw, decimals);
  } else {
    amountUsdt = Number(amountUsdt);
  }

  const network = String(body.network || 'TRC20').toUpperCase();
  return {
    txHash,
    toAddress,
    amountUsdt: Number.isFinite(Number(amountUsdt)) ? Number(amountUsdt) : null,
    network,
    depositId: body.deposit_id || body.depositId || null,
    blockTimestampMs: Number(body.block_timestamp || body.blockTimestamp || topic.block_timestamp || 0) || 0,
  };
}

function collectNoticeNodes(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body.transactions)) return body.transactions;
  if (Array.isArray(body.events)) return body.events;
  return [body];
}

function parseTronDepositNotices(body) {
  const notices = [];
  const seen = new Set();
  for (const node of collectNoticeNodes(body)) {
    const notice = parseOneTronDepositNotice(node);
    if (!notice || seen.has(notice.txHash)) continue;
    seen.add(notice.txHash);
    notices.push(notice);
  }
  return notices;
}

async function listCustodialTrc20Addresses({ userId = null, limit = 100 } = {}) {
  const db = getDb();
  const cap = Math.min(Math.max(Number(limit) || 100, 1), 200);
  if (userId) {
    const row = await db.get(`
      SELECT user_id, address, created_at
      FROM user_usdt_wallet_addresses
      WHERE user_id = ? AND network = 'TRC20' AND address_type = 'custodial'
        AND address IS NOT NULL AND TRIM(address) != ''
      LIMIT 1
    `, userId);
    return row?.address ? [row] : [];
  }
  return db.all(`
    SELECT user_id, address, created_at
    FROM user_usdt_wallet_addresses
    WHERE network = 'TRC20' AND address_type = 'custodial'
      AND address IS NOT NULL AND TRIM(address) != ''
    ORDER BY updated_at DESC
    LIMIT ?
  `, cap);
}

function inboundFloorMs(row) {
  const created = parseSqliteTimeMs(row?.created_at);
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, created - 120_000);
}

function shouldScanHdDepositsOnRead() {
  const raw = process.env.TRON_HD_SCAN_ON_READ;
  if (raw != null && String(raw).trim() !== '') {
    return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
  }
  return process.env.NODE_ENV !== 'test';
}

async function creditInboundHdDeposits({
  userId = null,
  addresses = null,
  fetchTransfers = null,
  limit = 100,
} = {}) {
  if (!isTronDepositEnabled()) {
    return { ok: true, skipped: true, reason: 'deposits_disabled', credited: 0, addresses: 0 };
  }

  const rows = Array.isArray(addresses)
    ? addresses
    : await listCustodialTrc20Addresses({ userId, limit });
  if (!rows.length) {
    return { ok: true, credited: 0, already_verified: 0, addresses: 0, scanned: 0 };
  }

  const { fetchIncomingUsdtTransfers, parseTrc20TransferAmount } = require('./tronOrderService');
  const { applyIncomingDepositCredit } = require('./depositCreditService');
  const { findVerifiedDepositByTxHash } = require('./depositService');
  const { getDepositFeeSettings } = require('./settingsService');
  const loadTransfers = fetchTransfers || fetchIncomingUsdtTransfers;
  const settings = await getDepositFeeSettings();
  const minUsdt = Number(settings.minimum_usdt_deposit) || 0;

  let scanned = 0;
  let credited = 0;
  let already = 0;
  let skipped = 0;
  const errors = [];
  const matches = [];

  for (const row of rows) {
    const address = String(row.address || '').trim();
    if (!address) continue;
    const floorMs = inboundFloorMs(row);
    let transfers;
    try {
      transfers = await loadTransfers({
        address,
        minTimestampMs: floorMs,
        limit: 50,
        orderBy: 'block_timestamp,desc',
      });
    } catch (err) {
      errors.push({ address, error: err.message, code: err.code || 'TRONGRID_FETCH_FAILED' });
      continue;
    }

    for (const transfer of transfers || []) {
      scanned += 1;
      const txId = String(transfer?.transaction_id || transfer?.txHash || transfer?.tx_hash || '').trim();
      const to = String(transfer?.to || transfer?.to_address || '').trim();
      if (!txId || to !== address) {
        skipped += 1;
        continue;
      }
      const txMs = Number(transfer?.block_timestamp || transfer?.blockTimestampMs || 0);
      if (floorMs > 0 && txMs > 0 && txMs < floorMs) {
        skipped += 1;
        continue;
      }
      const amountUsdt = Number.isFinite(Number(transfer?.amountUsdt))
        ? Number(transfer.amountUsdt)
        : parseTrc20TransferAmount(transfer);
      if (!(amountUsdt > 0) || (minUsdt > 0 && amountUsdt + 1e-9 < minUsdt)) {
        skipped += 1;
        continue;
      }

      const verified = await findVerifiedDepositByTxHash(txId);
      if (verified) {
        already += 1;
        continue;
      }

      try {
        const result = await applyIncomingDepositCredit({
          source: 'blockchain_webhook',
          userId: row.user_id,
          txHash: txId,
          toAddress: address,
          amountUsdt,
          network: 'TRC20',
          createdBy: 'tron-indexer',
          adminNote: 'TRON HD inbound USDT auto-credit',
          verifyTransfer: async (params) => {
            if (String(params.txHash || '').trim() !== txId) {
              return { ok: false, message: 'Transaction hash does not match the TronGrid transfer' };
            }
            if (String(params.expectedAddress || '').trim() !== address) {
              return { ok: false, message: 'Deposit address does not match the TronGrid transfer' };
            }
            const expected = Number(params.expectedAmountUsdt);
            const tol = Math.max(0.01, expected * 0.005);
            if (!Number.isFinite(expected) || Math.abs(amountUsdt - expected) > tol) {
              return { ok: false, message: 'Transfer amount does not match the deposit' };
            }
            return { ok: true, status: 'confirmed', amountUsdt, network: 'TRC20', txHash: txId };
          },
        });
        if (result.credited) credited += 1;
        else if (result.alreadyVerified) already += 1;
        matches.push({
          tx_hash: txId,
          user_id: Number(row.user_id),
          credited: Boolean(result.credited),
          net_usdt: result.net_usdt ?? null,
          balance_usdt: result.balance_usdt ?? null,
        });
      } catch (err) {
        if (err.code === 'TX_HASH_REUSED') {
          already += 1;
          continue;
        }
        errors.push({ address, tx_hash: txId, error: err.message, code: err.code || 'HD_CREDIT_FAILED' });
      }
    }
  }

  if (credited > 0) {
    console.log(`[tron/hd] credited ${credited} inbound USDT deposit(s)`);
  }

  return {
    ok: errors.length === 0,
    credited,
    already_verified: already,
    skipped,
    scanned,
    addresses: rows.length,
    matches,
    errors: errors.length ? errors : undefined,
  };
}

async function creditUserHdDeposits(userId, opts = {}) {
  return creditInboundHdDeposits({ ...opts, userId });
}

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ skipped: true, reason: 'timeout', credited: 0 });
    }, ms);
    Promise.resolve(promise).then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }).catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, credited: 0 });
    });
  });
}

/**
 * Scan one user's HD address while they load the wallet or deposit screen.
 * Tests skip this unless TRON_HD_SCAN_ON_READ=true. Repeated calls share one
 * in-flight scan and then wait SCAN_INTERVAL_MS.
 */
async function scanUserHdDepositsBestEffort(userId) {
  if (!shouldScanHdDepositsOnRead()) {
    return { skipped: true, reason: 'scan_on_read_disabled', credited: 0 };
  }
  if (!isTronDepositEnabled()) {
    return { skipped: true, reason: 'deposits_disabled', credited: 0 };
  }
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    return { skipped: true, reason: 'invalid_user', credited: 0 };
  }

  const existing = userScanInflight.get(id);
  if (existing) return withTimeout(existing, READ_SCAN_TIMEOUT_MS);

  const now = Date.now();
  const previous = lastUserScanAt.get(id) || 0;
  if (now - previous < SCAN_INTERVAL_MS) {
    return { skipped: true, reason: 'throttled', credited: 0 };
  }
  lastUserScanAt.set(id, now);

  const work = creditUserHdDeposits(id).finally(() => {
    userScanInflight.delete(id);
  });
  userScanInflight.set(id, work);
  return withTimeout(work, READ_SCAN_TIMEOUT_MS);
}

async function creditDepositNotice(notice, { verifyTransfer, source = 'blockchain_webhook' } = {}) {
  const { applyIncomingDepositCredit } = require('./depositCreditService');
  return applyIncomingDepositCredit({
    source,
    depositId: notice.depositId,
    txHash: notice.txHash,
    toAddress: notice.toAddress,
    amountUsdt: notice.amountUsdt,
    network: notice.network || 'TRC20',
    createdBy: 'blockchain',
    adminNote: `Blockchain webhook credit (${notice.network || 'TRC20'})`,
    verifyTransfer,
  });
}

module.exports = {
  USDT_TRC20_CONTRACT,
  parseTronDepositNotices,
  parseOneTronDepositNotice,
  humanUsdtFromRaw,
  listCustodialTrc20Addresses,
  creditInboundHdDeposits,
  creditUserHdDeposits,
  scanUserHdDepositsBestEffort,
  creditDepositNotice,
  shouldScanHdDepositsOnRead,
};
