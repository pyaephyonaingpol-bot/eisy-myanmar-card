const crypto = require('crypto');
const { getDb } = require('../db');
const { debitUsdt, formatUsdt } = require('./walletService');
const { getUsdtBalances } = require('./usdtLedgerService');
const { isLikelyTronAddress } = require('./tronMasterWalletService');
const { syncUserWalletById } = require('./supabaseSyncService');
const { getSupabase, isSupabaseEnabled } = require('../lib/supabase');
const { invalidateUserWalletCache } = require('./supabaseWalletReadService');

const MIN_SCAN_PAY_USDT = 0.01;
const MAX_SCAN_PAY_USDT = 50000;

function roundUsdt(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function buildRefCode() {
  return `SP${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function buildJournalId() {
  return `SCAN-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function getRpcClient() {
  try {
    const admin = require('../../../lib/supabaseAdmin');
    if (typeof admin.isSupabaseAdminEnabled === 'function' && admin.isSupabaseAdminEnabled()) {
      return admin.getSupabaseAdmin();
    }
  } catch (_) {
    /* optional */
  }
  if (isSupabaseEnabled()) return getSupabase();
  return null;
}

function isMissingScanPayRpc(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || '');
  if (code === 'PGRST202' || code === 'PGRST205' || code === '42883') return true;
  if (/Could not find the function/i.test(message)) return true;
  if (/debit_usdt_for_scan_pay/i.test(message) && /schema cache|does not exist/i.test(message)) {
    return true;
  }
  return false;
}

function normalizeNetwork(raw) {
  const value = String(raw || 'TRC20').trim().toUpperCase();
  if (['TRC20', 'TRON', 'TRX'].includes(value)) return 'TRC20';
  if (['BEP20', 'BSC', 'BNB'].includes(value)) return 'BEP20';
  if (['ERC20', 'ETH', 'ETHEREUM'].includes(value)) return 'ERC20';
  return value || 'TRC20';
}

function isLikelyEvmAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(addr || '').trim());
}

function parsePaymentQrPayload(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) {
    const err = new Error('QR payload is empty');
    err.code = 'EMPTY_QR';
    throw err;
  }

  if (raw.startsWith('{')) {
    try {
      const json = JSON.parse(raw);
      return {
        destination_address: String(json.address || json.to || json.wallet || '').trim(),
        amount_usdt: json.amount != null
          ? Number(json.amount)
          : (json.amount_usdt != null ? Number(json.amount_usdt) : null),
        network: normalizeNetwork(json.network || json.chain || 'TRC20'),
        recipient_email: json.email || json.to_email || null,
        note: json.note || json.memo || null,
        raw,
      };
    } catch (_) { /* fall through */ }
  }

  if (/^eisy:\/\//i.test(raw) || /^eisymyanmar:\/\//i.test(raw)) {
    try {
      const url = new URL(raw.replace(/^eisy:/i, 'https:').replace(/^eisymyanmar:/i, 'https:'));
      const amount = url.searchParams.get('amount') || url.searchParams.get('amount_usdt');
      return {
        destination_address: String(url.searchParams.get('address') || url.searchParams.get('to') || '').trim(),
        amount_usdt: amount != null ? Number(amount) : null,
        network: normalizeNetwork(url.searchParams.get('network') || 'TRC20'),
        recipient_email: url.searchParams.get('email') || url.searchParams.get('to_email') || null,
        note: url.searchParams.get('note') || null,
        raw,
      };
    } catch (_) { /* fall through */ }
  }

  if (/^tron:/i.test(raw)) {
    // Avoid `new URL()` — hostnames are lowercased; Tron base58 is case-sensitive.
    const withoutScheme = raw.replace(/^tron:/i, '');
    const qIdx = withoutScheme.indexOf('?');
    const addressPart = qIdx >= 0 ? withoutScheme.slice(0, qIdx) : withoutScheme;
    const queryPart = qIdx >= 0 ? withoutScheme.slice(qIdx + 1) : '';
    let address = '';
    try {
      address = decodeURIComponent(addressPart.replace(/^\/*/, '').replace(/\/$/, ''));
    } catch (_) {
      address = addressPart.replace(/^\/*/, '').replace(/\/$/, '');
    }
    const params = new URLSearchParams(queryPart);
    const amount = params.get('amount') || params.get('value');
    return {
      destination_address: address,
      amount_usdt: amount != null ? Number(amount) : null,
      network: 'TRC20',
      recipient_email: null,
      note: params.get('memo') || null,
      raw,
    };
  }

  if (/^ethereum:/i.test(raw)) {
    const amountMatch = raw.match(/[?&](?:uint256|amount|value)=(\d+(?:\.\d+)?)/i);
    let amount = amountMatch ? Number(amountMatch[1]) : null;
    if (amount != null && amount >= 1000 && Number.isInteger(Number(amountMatch[1]))) {
      amount = roundUsdt(amount / 1e6);
    }
    const addrMatch = raw.match(/ethereum:(0x[a-fA-F0-9]{40})/i)
      || raw.match(/address=(0x[a-fA-F0-9]{40})/i);
    return {
      destination_address: addrMatch ? addrMatch[1] : '',
      amount_usdt: amount,
      network: /@56\b/.test(raw) ? 'BEP20' : 'ERC20',
      recipient_email: null,
      note: null,
      raw,
    };
  }

  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(raw)) {
    return {
      destination_address: raw,
      amount_usdt: null,
      network: 'TRC20',
      recipient_email: null,
      note: null,
      raw,
    };
  }

  if (isLikelyEvmAddress(raw)) {
    return {
      destination_address: raw,
      amount_usdt: null,
      network: 'BEP20',
      recipient_email: null,
      note: null,
      raw,
    };
  }

  const lines = raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const addressLine = lines.find((l) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(l) || isLikelyEvmAddress(l));
  const amountLine = lines.find((l) => /^\d+(\.\d+)?$/.test(l) && Number(l) > 0);
  if (addressLine) {
    return {
      destination_address: addressLine,
      amount_usdt: amountLine != null ? Number(amountLine) : null,
      network: addressLine.startsWith('T') ? 'TRC20' : 'BEP20',
      recipient_email: null,
      note: null,
      raw,
    };
  }

  const err = new Error('Could not parse a payment address from this QR code');
  err.code = 'UNPARSEABLE_QR';
  throw err;
}

function validateDestination(address, network) {
  const addr = String(address || '').trim();
  const net = normalizeNetwork(network);
  if (!addr) {
    const err = new Error('Destination address is required');
    err.code = 'MISSING_ADDRESS';
    throw err;
  }
  if (net === 'TRC20') {
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr) || !isLikelyTronAddress(addr)) {
      const err = new Error('Invalid TRC20 (Tron) destination address');
      err.code = 'INVALID_ADDRESS';
      throw err;
    }
  } else if (!isLikelyEvmAddress(addr)) {
    const err = new Error(`Invalid ${net} destination address`);
    err.code = 'INVALID_ADDRESS';
    throw err;
  }
  return { address: addr, network: net };
}

async function findByIdempotencyKey(key) {
  if (!key) return null;
  const db = getDb();
  return db.get('SELECT * FROM usdt_scan_payments WHERE idempotency_key = ?', key);
}

async function insertScanPayment(row) {
  const db = getDb();
  const result = await db.run(
    `INSERT INTO usdt_scan_payments (
      user_id, ref_code, idempotency_key, destination_address, network,
      amount_usdt, fee_usdt, total_debit_usdt, qr_payload, status, payout_status,
      payout_tx_hash, journal_id, note, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.user_id,
    row.ref_code,
    row.idempotency_key || null,
    row.destination_address,
    row.network,
    row.amount_usdt,
    row.fee_usdt,
    row.total_debit_usdt,
    row.qr_payload || null,
    row.status || 'completed',
    row.payout_status || 'pending',
    row.payout_tx_hash || null,
    row.journal_id || null,
    row.note || null,
    row.metadata ? JSON.stringify(row.metadata) : null
  );
  return db.get('SELECT * FROM usdt_scan_payments WHERE id = ?', result.lastID);
}

async function trySupabaseAtomicDebit(userId, amountUsdt, {
  journalId,
  description,
  metadata,
} = {}) {
  const sb = getRpcClient();
  if (!sb) return null;

  try {
    const { data, error } = await sb.rpc('debit_usdt_for_scan_pay', {
      p_user_id: String(userId),
      p_amount: amountUsdt,
      p_idempotency_key: journalId,
      p_description: description || null,
      p_metadata: metadata && typeof metadata === 'object' ? metadata : {},
    });

    if (error) {
      if (isMissingScanPayRpc(error)) return null;
      const err = new Error(error.message || 'Supabase Scan Pay debit failed');
      err.code = error.code || 'SUPABASE_RPC_ERROR';
      throw err;
    }

    if (data && data.ok === false) {
      const err = new Error(data.error || 'Scan Pay debit rejected');
      err.code = data.code || 'SCAN_PAY_DENIED';
      if (data.required_usdt != null) err.required_usdt = Number(data.required_usdt);
      if (data.available_usdt != null) err.available_usdt = Number(data.available_usdt);
      throw err;
    }

    try { invalidateUserWalletCache(userId); } catch (_) { /* optional */ }

    return {
      mode: 'supabase_rpc',
      journal_id: data?.journal_id || journalId,
      duplicate: Boolean(data?.duplicate),
      balance_before: data?.balance_before != null ? Number(data.balance_before) : null,
      balance_after: data?.balance_after != null ? Number(data.balance_after) : null,
    };
  } catch (err) {
    if (isMissingScanPayRpc(err)) return null;
    throw err;
  }
}

async function executeScanPay(userId, {
  destinationAddress,
  network = 'TRC20',
  amountUsdt,
  qrPayload = null,
  note = null,
  idempotencyKey = null,
} = {}) {
  if (idempotencyKey) {
    const existing = await findByIdempotencyKey(String(idempotencyKey).trim());
    if (existing) {
      const balances = await getUsdtBalances(userId);
      return { duplicate: true, payment: existing, wallet: balances };
    }
  }

  let parsed = null;
  if (qrPayload) {
    try { parsed = parsePaymentQrPayload(qrPayload); } catch (_) { parsed = null; }
  }

  const amount = roundUsdt(
    amountUsdt != null ? amountUsdt : (parsed?.amount_usdt != null ? parsed.amount_usdt : NaN)
  );
  if (!Number.isFinite(amount) || amount < MIN_SCAN_PAY_USDT) {
    const err = new Error(`Enter a valid amount (min ${MIN_SCAN_PAY_USDT} USDT)`);
    err.code = 'INVALID_AMOUNT';
    throw err;
  }
  if (amount > MAX_SCAN_PAY_USDT) {
    const err = new Error(`Maximum Scan Pay amount is ${MAX_SCAN_PAY_USDT} USDT`);
    err.code = 'AMOUNT_TOO_LARGE';
    throw err;
  }

  const destRaw = destinationAddress || parsed?.destination_address;
  const netRaw = network || parsed?.network || 'TRC20';
  const { address, network: destNetwork } = validateDestination(destRaw, netRaw);

  const feeUsdt = 0;
  const totalDebit = roundUsdt(amount + feeUsdt);
  const journalId = String(idempotencyKey || buildJournalId()).trim();
  const refCode = buildRefCode();
  const shortAddr = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const description = `Scan Pay ${refCode} — ${formatUsdt(amount)} to ${shortAddr} (${destNetwork})`;
  const metadata = {
    purpose: 'usdt_scan_pay',
    ref_code: refCode,
    destination_address: address,
    network: destNetwork,
    amount_usdt: amount,
    fee_usdt: feeUsdt,
    qr_payload: qrPayload ? String(qrPayload).slice(0, 500) : null,
    note: note || parsed?.note || null,
  };

  let debitMeta = await trySupabaseAtomicDebit(userId, totalDebit, {
    journalId,
    description,
    metadata,
  });

  let tursoDebited = false;
  if (!debitMeta?.duplicate) {
    try {
      await debitUsdt(userId, totalDebit, {
        txType: 'scan_pay',
        description,
        referenceType: 'usdt_scan_payments',
        referenceId: null,
        createdBy: 'user',
        metadata,
        counterpartyAddress: address,
        network: destNetwork,
        journalId,
      });
      tursoDebited = true;
    } catch (err) {
      if (debitMeta?.mode === 'supabase_rpc') {
        err.message = `Local ledger sync failed after Supabase debit: ${err.message}`;
      }
      throw err;
    }
  }

  if (!debitMeta) {
    debitMeta = { mode: 'turso', journal_id: journalId, duplicate: false };
  }

  let payment;
  try {
    payment = await insertScanPayment({
      user_id: userId,
      ref_code: refCode,
      idempotency_key: idempotencyKey ? String(idempotencyKey).trim() : journalId,
      destination_address: address,
      network: destNetwork,
      amount_usdt: amount,
      fee_usdt: feeUsdt,
      total_debit_usdt: totalDebit,
      qr_payload: qrPayload ? String(qrPayload).slice(0, 2000) : null,
      status: 'completed',
      payout_status: destNetwork === 'TRC20' ? 'pending' : 'skipped',
      journal_id: debitMeta.journal_id || journalId,
      note: note || parsed?.note || null,
      metadata: {
        ...metadata,
        debit_mode: debitMeta.mode,
        turso_debited: tursoDebited,
      },
    });
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE') && idempotencyKey) {
      const existing = await findByIdempotencyKey(String(idempotencyKey).trim());
      if (existing) {
        const balances = await getUsdtBalances(userId);
        return { duplicate: true, payment: existing, wallet: balances };
      }
    }
    throw err;
  }

  try {
    await syncUserWalletById(userId);
  } catch (err) {
    console.warn('[scan-pay] supabase wallet sync:', err.message);
  }

  const balances = await getUsdtBalances(userId);
  return {
    duplicate: Boolean(debitMeta.duplicate),
    payment,
    wallet: balances,
    message: `Paid ${formatUsdt(amount)} via Scan Pay to ${address}`,
  };
}

async function listScanPaymentsForUser(userId, { limit = 50 } = {}) {
  const db = getDb();
  const cap = Math.max(1, Math.min(100, Number(limit) || 50));
  return db.all(
    `SELECT * FROM usdt_scan_payments
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    userId,
    cap
  );
}

module.exports = {
  MIN_SCAN_PAY_USDT,
  MAX_SCAN_PAY_USDT,
  parsePaymentQrPayload,
  validateDestination,
  executeScanPay,
  listScanPaymentsForUser,
  roundUsdt,
};
