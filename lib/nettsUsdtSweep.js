'use strict';

/**
 * Netts energy rental + USDT TRC-20 sweep from child address → central wallet.
 * Used by Express (production) and optionally Next App Router.
 */
const { TronWeb } = require('tronweb');

const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const ENERGY_ORDER_AMOUNT = 65_000;
const USDT_FEE_LIMIT_SUN = 100_000_000;

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

function isNettsEnergyOrderSuccessful(status, payload) {
  if (status < 200 || status >= 300) return false;
  if (!payload || typeof payload !== 'object') return true;
  if (payload.success === false) return false;
  if (payload.ok === false) return false;
  if (typeof payload.error === 'string' && payload.error.trim()) return false;
  if (typeof payload.message === 'string' && /fail|error/i.test(payload.message)) return false;
  const code = payload.code;
  if (typeof code === 'number' && code !== 0 && code !== 200) return false;
  return true;
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
  if (status === 401 || status === 403 || /invalid api key|unauthorized|forbidden/.test(blob)) {
    return {
      code: 'SWEEP_NETTS_AUTH',
      message: 'Netts energy rental failed: invalid or unauthorized API key',
    };
  }
  const detail =
    payload && typeof payload === 'object' ? JSON.stringify(payload) : text || `HTTP ${status}`;
  return {
    code: 'SWEEP_NETTS_FAILED',
    message: `Netts energy rental failed: ${detail}`,
  };
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

async function rentEnergyFromNetts(childAddress, { fetchImpl = fetch, timeoutMs = getNettsFetchTimeoutMs() } = {}) {
  const apiUrl = requireEnv('TRON_ENERGY_API_URL');
  const apiKey = requireEnv('TRON_ENERGY_API_KEY');

  const response = await fetchWithTimeout(
    fetchImpl,
    apiUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify({
        address: childAddress,
        energy: ENERGY_ORDER_AMOUNT,
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

  if (!isNettsEnergyOrderSuccessful(response.status, data)) {
    const classified = classifyNettsFailure(response.status, data, text);
    const err = new Error(classified.message);
    err.code = classified.code;
    err.nettsStatus = response.status;
    err.nettsBody = data;
    throw err;
  }

  return { ok: true, data };
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
    privateKey: privateKey.trim(),
  });
}

/**
 * @param {{ childAddress: string, childPrivateKey: string, amountToSweep: number|string, fetchImpl?: typeof fetch, tronWebFactory?: Function }} params
 */
async function sweepUsdtWithNettsEnergy({
  childAddress,
  childPrivateKey,
  amountToSweep,
  fetchImpl = fetch,
  tronWebFactory = createChildTronWeb,
  sleepFn = sleep,
  nettsTimeoutMs = getNettsFetchTimeoutMs(),
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
  const amountInSun = parseAmountToSun(amountToSweep);

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

  const energyOrder = await rentEnergyFromNetts(from, { fetchImpl, timeoutMs: nettsTimeoutMs });
  await sleepFn(getDelegationSettleMs());

  let sendResult;
  try {
    const contract = await tronWeb.contract().at(USDT_TRC20_CONTRACT);
    sendResult = await contract.transfer(centralWallet, amountInSun).send({
      feeLimit: USDT_FEE_LIMIT_SUN,
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
    energy: ENERGY_ORDER_AMOUNT,
    energyOrder: energyOrder.data,
  };
}

module.exports = {
  USDT_TRC20_CONTRACT,
  ENERGY_ORDER_AMOUNT,
  USDT_FEE_LIMIT_SUN,
  getDelegationSettleMs,
  getNettsFetchTimeoutMs,
  parseAmountToSun,
  normalizePrivateKey,
  isNettsEnergyOrderSuccessful,
  classifyNettsFailure,
  rentEnergyFromNetts,
  sweepUsdtWithNettsEnergy,
};
