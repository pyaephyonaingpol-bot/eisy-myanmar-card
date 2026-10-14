'use strict';

/**
 * Netts /apiv2/order1h energy rental + USDT TRC-20 sweep from child address → central wallet.
 * Used by Express (production) and optionally Next App Router.
 */
const crypto = require('crypto');
const { TronWeb } = require('tronweb');

const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const ENERGY_ORDER_AMOUNT = 65_000;
const USDT_FEE_LIMIT_SUN = 100_000_000;

/** Same minimal ABI as tronSweepService / tronMasterWalletService. */
const USDT_TRC20_ABI = [
  {
    constant: true,
    inputs: [{ name: 'who', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    type: 'function',
    stateMutability: 'view',
  },
  {
    constant: false,
    inputs: [
      { name: '_to', type: 'address' },
      { name: '_value', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    type: 'function',
    stateMutability: 'nonpayable',
  },
];

function getDelegationSettleMs() {
  const n = parseInt(process.env.TRON_SWEEP_NETTS_SETTLE_MS || '2000', 10);
  return Number.isFinite(n) && n >= 0 ? n : 2000;
}

function getNettsFetchTimeoutMs() {
  const n = parseInt(process.env.TRON_NETTS_FETCH_TIMEOUT_MS || '25000', 10);
  return Number.isFinite(n) && n > 0 ? n : 25000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePrivateKey(hex) {
  const trimmed = String(hex || '').trim();
  return trimmed.startsWith('0x') || trimmed.startsWith('0X')
    ? trimmed.slice(2)
    : trimmed;
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    const err = new Error(`Missing required environment variable: ${name}`);
    err.code = 'SWEEP_CONFIG';
    throw err;
  }
  return value;
}

function parseAmountToSun(amountToSweep) {
  const raw = String(amountToSweep).trim();
  if (!raw || !/^-?\d+(\.\d+)?$/.test(raw)) {
    const err = new Error('amountToSweep must be a positive number');
    err.code = 'SWEEP_INVALID_AMOUNT';
    throw err;
  }
  const asNumber = Number(raw);
  if (!Number.isFinite(asNumber) || asNumber <= 0) {
    const err = new Error('amountToSweep must be greater than zero');
    err.code = 'SWEEP_INVALID_AMOUNT';
    throw err;
  }
  const sun = BigInt(Math.round(asNumber * 1_000_000));
  if (sun <= 0n) {
    const err = new Error('amountToSweep is too small after conversion');
    err.code = 'SWEEP_INVALID_AMOUNT';
    throw err;
  }
  return sun.toString();
}

function extractTxId(result) {
  if (!result) return null;
  if (typeof result === 'string') return result;
  if (typeof result === 'object') {
    const tx = result.txid ?? result.txID ?? result.transaction;
    if (typeof tx === 'string') return tx;
    if (tx && typeof tx === 'object') {
      const nestedId = tx.txID ?? tx.txid;
      if (typeof nestedId === 'string') return nestedId;
    }
  }
  return null;
}

/**
 * Netts /order1h success: HTTP 200 or 208 with detail.code === 10000.
 * @see https://doc.netts.io/api/v2/endpoints/order1h
 */
function isNettsOrder1hSuccessful(status, payload) {
  if (status !== 200 && status !== 208) return false;
  const detail = payload?.detail;
  if (!detail || typeof detail !== 'object') return false;
  return detail.code === 10000;
}

/** @deprecated use isNettsOrder1hSuccessful — kept for tests */
function isNettsEnergyOrderSuccessful(status, payload) {
  if (status === 409) return false;
  return isNettsOrder1hSuccessful(status, payload);
}

function classifyNettsFailure(status, payload, text) {
  const blob = [
    typeof payload === 'object' && payload ? JSON.stringify(payload) : '',
    text || '',
    String(status),
  ]
    .join(' ')
    .toLowerCase();

  if (
    status === 402
    || status === 403
    || payload?.code === 1004
    || /insufficient|not enough|low balance|balance too low|payment required|fund your|top up/.test(blob)
  ) {
    return {
      code: 'SWEEP_NETTS_INSUFFICIENT_BALANCE',
      message: 'Netts energy rental failed: insufficient Netts account balance or payment required',
    };
  }
  if (status === 429 || /rate limit|too many requests/.test(blob)) {
    return {
      code: 'SWEEP_NETTS_RATE_LIMIT',
      message: 'Netts energy rental failed: rate limited — retry shortly',
    };
  }
  if (status >= 500 || status === 408) {
    return {
      code: 'SWEEP_NETTS_UNAVAILABLE',
      message: `Netts energy rental failed: upstream unavailable (HTTP ${status})`,
    };
  }
  if (status === 401 || status === 403 || /invalid api key|unauthorized|forbidden|ip not in whitelist/.test(blob)) {
    return {
      code: 'SWEEP_NETTS_AUTH',
      message: 'Netts energy rental failed: invalid API key or IP not whitelisted',
    };
  }
  const detail =
    payload && typeof payload === 'object' ? JSON.stringify(payload) : text || `HTTP ${status}`;
  return {
    code: 'SWEEP_NETTS_FAILED',
    message: `Netts energy rental failed: ${detail}`,
  };
}

function makeIdempotencyKey(apiKey, receiveAddress, amount, nonce) {
  const message = `${receiveAddress}:${amount}:${nonce}`;
  return crypto.createHmac('sha256', apiKey).update(message).digest('hex');
}

function buildNettsRequestHeaders(apiKey, { idempotencyKey } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-API-KEY': apiKey,
  };
  const realIp = process.env.TRON_NETTS_REAL_IP?.trim();
  if (realIp) {
    headers['X-Real-IP'] = realIp;
  }
  if (idempotencyKey) {
    headers['X-Idempotency-Key'] = idempotencyKey;
  }
  return headers;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      const timeoutErr = new Error(`Netts energy rental timed out after ${timeoutMs}ms`);
      timeoutErr.code = 'SWEEP_NETTS_TIMEOUT';
      throw timeoutErr;
    }
    const networkErr = new Error(`Netts energy rental network error: ${err.message || String(err)}`);
    networkErr.code = 'SWEEP_NETTS_NETWORK';
    throw networkErr;
  } finally {
    clearTimeout(timer);
  }
}

function parseNettsOrder1hResponse(data) {
  const detail = data?.detail;
  const orderData = detail?.data && typeof detail.data === 'object' ? detail.data : {};
  return {
    orderId: orderData.orderId ?? null,
    paidTRX: orderData.paidTRX ?? null,
    hash: orderData.hash ?? null,
    delegateAddress: orderData.delegateAddress ?? null,
    energy: orderData.energy ?? null,
    cached: Boolean(data?.idempotency?.cached),
  };
}

async function rentEnergyFromNetts(
  receiveAddress,
  {
    fetchImpl = fetch,
    timeoutMs = getNettsFetchTimeoutMs(),
    amount = ENERGY_ORDER_AMOUNT,
    idempotencyKey = null,
  } = {},
) {
  const apiUrl = requireEnv('TRON_ENERGY_API_URL');
  const apiKey = requireEnv('TRON_ENERGY_API_KEY');
  const energyAmount = Number(amount);
  if (!Number.isFinite(energyAmount) || energyAmount < 61_000) {
    const err = new Error('Netts energy amount must be at least 61000');
    err.code = 'SWEEP_CONFIG';
    throw err;
  }

  const response = await fetchWithTimeout(
    fetchImpl,
    apiUrl,
    {
      method: 'POST',
      headers: buildNettsRequestHeaders(apiKey, { idempotencyKey }),
      body: JSON.stringify({
        amount: energyAmount,
        receiveAddress,
      }),
    },
    timeoutMs,
  );

  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (response.status === 409) {
    const err = new Error(
      data?.message || 'Netts order is still processing — wait before retrying with the same idempotency key',
    );
    err.code = 'SWEEP_NETTS_CONFLICT';
    err.nettsStatus = 409;
    err.nettsBody = data;
    err.retryAfterSeconds = Number(data?.retry_after_seconds) || 3;
    throw err;
  }

  if (!isNettsOrder1hSuccessful(response.status, data)) {
    const classified = classifyNettsFailure(response.status, data, text);
    const err = new Error(classified.message);
    err.code = classified.code;
    err.nettsStatus = response.status;
    err.nettsBody = data;
    throw err;
  }

  const parsed = parseNettsOrder1hResponse(data);
  return {
    ok: true,
    httpStatus: response.status,
    data,
    ...parsed,
  };
}

function createChildTronWeb(fullHost, privateKey) {
  const headers = {};
  const trongridKey = process.env.TRONGRID_API_KEY || process.env.TRON_PRO_API_KEY;
  if (trongridKey?.trim()) {
    headers['TRON-PRO-API-KEY'] = trongridKey.trim();
  }
  return new TronWeb({
    fullHost,
    headers,
    privateKey: normalizePrivateKey(privateKey),
  });
}

async function resolveTransferAmountSun(tronWeb, fromAddress, requestedSun) {
  tronWeb.setAddress(fromAddress);
  const contract = await tronWeb.contract(USDT_TRC20_ABI, USDT_TRC20_CONTRACT);
  const raw = await contract.methods.balanceOf(fromAddress).call();
  const balanceSun = BigInt(raw?.toString?.() ?? String(raw || '0'));
  const req = BigInt(requestedSun);

  if (balanceSun <= 0n) {
    const err = new Error('Child address has zero USDT balance');
    err.code = 'SWEEP_ZERO_BALANCE';
    throw err;
  }
  if (req > balanceSun) {
    return {
      amountInSun: balanceSun.toString(),
      amountCapped: true,
      requestedAmountInSun: requestedSun,
      balanceInSun: balanceSun.toString(),
    };
  }
  return {
    amountInSun: requestedSun,
    amountCapped: false,
    requestedAmountInSun: requestedSun,
    balanceInSun: balanceSun.toString(),
  };
}

/**
 * @param {{ childAddress: string, childPrivateKey: string, amountToSweep: number|string, fetchImpl?: typeof fetch, tronWebFactory?: Function, sleepFn?: Function, nettsTimeoutMs?: number, idempotencyNonce?: string, skipBalanceCap?: boolean }} params
 */
async function sweepUsdtWithNettsEnergy({
  childAddress,
  childPrivateKey,
  amountToSweep,
  fetchImpl = fetch,
  tronWebFactory = createChildTronWeb,
  sleepFn = sleep,
  nettsTimeoutMs = getNettsFetchTimeoutMs(),
  idempotencyNonce = null,
  skipBalanceCap = false,
} = {}) {
  const from = String(childAddress || '').trim();
  const pk = normalizePrivateKey(childPrivateKey);
  if (!from || !pk || amountToSweep == null || amountToSweep === '') {
    const err = new Error('childAddress, childPrivateKey, and amountToSweep are required');
    err.code = 'SWEEP_BAD_REQUEST';
    throw err;
  }

  const tronFullHost = requireEnv('TRON_FULL_HOST');
  const centralWallet = requireEnv('CENTRAL_WALLET_ADDRESS');
  const requestedSun = parseAmountToSun(amountToSweep);

  const tronWeb = tronWebFactory(tronFullHost, pk);
  if (!tronWeb.isAddress(from)) {
    const err = new Error('Invalid childAddress');
    err.code = 'SWEEP_INVALID_ADDRESS';
    throw err;
  }
  if (!tronWeb.isAddress(centralWallet)) {
    const err = new Error('Invalid CENTRAL_WALLET_ADDRESS configuration');
    err.code = 'SWEEP_CONFIG';
    throw err;
  }

  const derivedAddress = tronWeb.address.fromPrivateKey(pk);
  if (derivedAddress !== from) {
    const err = new Error('childPrivateKey does not match childAddress');
    err.code = 'SWEEP_KEY_MISMATCH';
    throw err;
  }

  const apiKey = requireEnv('TRON_ENERGY_API_KEY');
  const nonce =
    String(idempotencyNonce || '').trim() || crypto.randomBytes(16).toString('hex');
  const idempotencyKey = makeIdempotencyKey(apiKey, from, ENERGY_ORDER_AMOUNT, nonce);

  const energyOrder = await rentEnergyFromNetts(from, {
    fetchImpl,
    timeoutMs: nettsTimeoutMs,
    amount: ENERGY_ORDER_AMOUNT,
    idempotencyKey,
  });
  await sleepFn(getDelegationSettleMs());

  let amountInSun = requestedSun;
  let amountCapped = false;
  let balanceInSun = null;
  if (!skipBalanceCap) {
    const resolved = await resolveTransferAmountSun(tronWeb, from, requestedSun);
    amountInSun = resolved.amountInSun;
    amountCapped = resolved.amountCapped;
    balanceInSun = resolved.balanceInSun;
  }

  let sendResult;
  try {
    tronWeb.setAddress(from);
    const contract = await tronWeb.contract(USDT_TRC20_ABI, USDT_TRC20_CONTRACT);
    sendResult = await contract.methods.transfer(centralWallet, amountInSun).send({
      feeLimit: USDT_FEE_LIMIT_SUN,
      callValue: 0,
      shouldPollResponse: false,
      keepTxID: true,
    });
  } catch (chainErr) {
    const err = new Error(`USDT transfer failed: ${chainErr.message || String(chainErr)}`);
    err.code = 'SWEEP_CHAIN_FAILED';
    err.energyOrder = energyOrder.data;
    err.cause = chainErr;
    throw err;
  }

  const txid = extractTxId(sendResult);
  if (!txid) {
    const err = new Error('USDT transfer broadcast but no transaction id was returned');
    err.code = 'SWEEP_NO_TXID';
    err.energyOrder = energyOrder.data;
    err.raw = sendResult;
    throw err;
  }

  return {
    ok: true,
    txid,
    from,
    to: centralWallet,
    amountToSweep,
    amountInSun,
    amountCapped,
    balanceInSun,
    energy: ENERGY_ORDER_AMOUNT,
    idempotencyNonce: nonce,
    nettsOrderId: energyOrder.orderId,
    nettsDelegationHash: energyOrder.hash,
    nettsPaidTrx: energyOrder.paidTRX,
    nettsEnergyDelivered: energyOrder.energy,
    nettsCached: energyOrder.cached,
    energyOrder: energyOrder.data,
  };
}

module.exports = {
  USDT_TRC20_CONTRACT,
  USDT_TRC20_ABI,
  ENERGY_ORDER_AMOUNT,
  USDT_FEE_LIMIT_SUN,
  getDelegationSettleMs,
  getNettsFetchTimeoutMs,
  parseAmountToSun,
  normalizePrivateKey,
  makeIdempotencyKey,
  buildNettsRequestHeaders,
  isNettsEnergyOrderSuccessful,
  isNettsOrder1hSuccessful,
  classifyNettsFailure,
  parseNettsOrder1hResponse,
  rentEnergyFromNetts,
  resolveTransferAmountSun,
  sweepUsdtWithNettsEnergy,
};
