'use strict';

/**
 * Netts energy rental + USDT TRC-20 sweep from child address → central wallet.
 * Used by Express (production) and optionally Next App Router.
 */
const { TronWeb } = require('tronweb');

const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const ENERGY_ORDER_AMOUNT = 65_000;
const DELEGATION_SETTLE_MS = 2_000;
const USDT_FEE_LIMIT_SUN = 100_000_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function rentEnergyFromNetts(childAddress, { fetchImpl = fetch } = {}) {
  const apiUrl = requireEnv('TRON_ENERGY_API_URL');
  const apiKey = requireEnv('TRON_ENERGY_API_KEY');

  const response = await fetchImpl(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify({
      address: childAddress,
      energy: ENERGY_ORDER_AMOUNT,
    }),
  });

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
    const detail =
      data && typeof data === 'object' ? JSON.stringify(data) : text || `HTTP ${response.status}`;
    const err = new Error(`Netts energy rental failed: ${detail}`);
    err.code = 'SWEEP_NETTS_FAILED';
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
} = {}) {
  const from = String(childAddress || '').trim();
  const pk = String(childPrivateKey || '').trim();
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

  const energyOrder = await rentEnergyFromNetts(from, { fetchImpl });
  await sleep(DELEGATION_SETTLE_MS);

  const contract = await tronWeb.contract().at(USDT_TRC20_CONTRACT);
  const sendResult = await contract.transfer(centralWallet, amountInSun).send({
    feeLimit: USDT_FEE_LIMIT_SUN,
  });

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
  DELEGATION_SETTLE_MS,
  USDT_FEE_LIMIT_SUN,
  parseAmountToSun,
  isNettsEnergyOrderSuccessful,
  rentEnergyFromNetts,
  sweepUsdtWithNettsEnergy,
};
