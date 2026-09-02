/**
 * TRON master-wallet service — TRC20 USDT transfers for approved withdrawals.
 *
 * Private key is read only from process.env.MASTER_PRIVATE_KEY (never hardcoded).
 */

const { TronWeb } = require('tronweb');

const USDT_TRC20_CONTRACT =
  process.env.USDT_TRC20_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TRON_FULL_HOST =
  process.env.TRON_FULL_HOST || process.env.TRONGRID_FULL_HOST || 'https://api.trongrid.io';
const TRC20_DECIMALS = 6;
/** Fee limit for USDT transfer (sun). Default 100 TRX. */
const DEFAULT_FEE_LIMIT = Number(process.env.TRON_USDT_FEE_LIMIT_SUN) || 100_000_000;
/** Warn Super Admins when master TRX (gas) falls below this level. */
const TRX_LOW_THRESHOLD = Number(process.env.MASTER_TRX_LOW_THRESHOLD) || 30;
/** Max wait for a single balance provider (TronGrid / Tronscan / TronWeb). */
const BALANCE_FETCH_TIMEOUT_MS = Math.max(
  3000,
  parseInt(process.env.MASTER_WALLET_BALANCE_TIMEOUT_MS || '12000', 10) || 12000
);

function getTrxLowThreshold() {
  return Number.isFinite(TRX_LOW_THRESHOLD) && TRX_LOW_THRESHOLD > 0
    ? TRX_LOW_THRESHOLD
    : 30;
}

// TronWeb Method._send calls stateMutability.toLowerCase() — omitting it
// throws "Cannot read properties of undefined (reading 'toLowerCase')".
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

function getMasterPrivateKey() {
  const raw = process.env.MASTER_PRIVATE_KEY;
  if (raw == null || String(raw).trim() === '') {
    const err = new Error(
      'MASTER_PRIVATE_KEY is not configured. Set it in the environment (never hardcode).'
    );
    err.code = 'MASTER_KEY_MISSING';
    throw err;
  }
  let key = String(raw).trim();
  if (key.startsWith('0x') || key.startsWith('0X')) {
    key = key.slice(2);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    const err = new Error('MASTER_PRIVATE_KEY must be a 64-character hex private key');
    err.code = 'MASTER_KEY_INVALID';
    throw err;
  }
  return key;
}

function createTronWeb(privateKey) {
  const headers = {};
  const apiKey = process.env.TRONGRID_API_KEY || process.env.TRON_PRO_API_KEY;
  if (apiKey) {
    headers['TRON-PRO-API-KEY'] = apiKey;
  }

  return new TronWeb({
    fullHost: TRON_FULL_HOST,
    headers,
    privateKey,
  });
}

/** Convert USDT amount to TRC20 base units (6 decimals) as a decimal string. */
function usdtToSun(amountUsdt) {
  const n = Number(amountUsdt);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('Transfer amount must be a positive number');
  }
  const fixed = n.toFixed(TRC20_DECIMALS);
  const [whole, frac = ''] = fixed.split('.');
  const padded = (frac + '000000').slice(0, TRC20_DECIMALS);
  const sun = BigInt(whole) * (10n ** BigInt(TRC20_DECIMALS)) + BigInt(padded);
  if (sun <= 0n) {
    throw new Error('Transfer amount too small');
  }
  return sun.toString();
}

function sunToUsdt(sunValue) {
  const raw = BigInt(sunValue?.toString?.() ?? sunValue ?? 0);
  const whole = raw / 10n ** BigInt(TRC20_DECIMALS);
  const frac = (raw % 10n ** BigInt(TRC20_DECIMALS)).toString().padStart(TRC20_DECIMALS, '0');
  return Number(`${whole}.${frac}`);
}

function getMasterAddress(tronWeb, privateKey) {
  return tronWeb.address.fromPrivateKey(privateKey);
}

async function getUsdtBalance(tronWeb, ownerAddress) {
  const contract = await tronWeb.contract(USDT_TRC20_ABI, USDT_TRC20_CONTRACT);
  const raw = await contract.methods.balanceOf(ownerAddress).call();
  return {
    sun: (raw?.toString?.() ?? String(raw)),
    usdt: sunToUsdt(raw),
  };
}

async function getTrxBalanceSun(tronWeb, address) {
  return tronWeb.trx.getBalance(address);
}

/**
 * Ensure master wallet holds enough USDT (and some TRX for bandwidth/energy fees).
 */
async function assertMasterHasFunds(tronWeb, { ownerAddress, amountUsdt }) {
  const neededSun = BigInt(usdtToSun(amountUsdt));
  const { sun, usdt } = await getUsdtBalance(tronWeb, ownerAddress);
  const available = BigInt(sun);

  if (available < neededSun) {
    const err = new Error(
      `Insufficient master wallet USDT balance: need ${Number(amountUsdt)} USDT, `
      + `have ${usdt} USDT (wallet ${ownerAddress})`
    );
    err.code = 'INSUFFICIENT_USDT';
    err.details = {
      requiredUsdt: Number(amountUsdt),
      availableUsdt: usdt,
      masterAddress: ownerAddress,
    };
    throw err;
  }

  const trxSun = await getTrxBalanceSun(tronWeb, ownerAddress);
  if (!trxSun || Number(trxSun) <= 0) {
    const err = new Error(
      `Master wallet has no TRX for network fees (wallet ${ownerAddress}). `
      + 'Fund the wallet with TRX before sending USDT.'
    );
    err.code = 'INSUFFICIENT_TRX';
    err.details = { masterAddress: ownerAddress, trxSun: Number(trxSun) || 0 };
    throw err;
  }

  return { availableUsdt: usdt, trxSun: Number(trxSun) };
}

function assertValidTronAddress(tronWeb, address, label) {
  const s = String(address || '').trim();
  if (!s || !tronWeb.isAddress(s)) {
    const err = new Error(`Invalid TRON ${label}: ${s || '(empty)'}`);
    err.code = label === 'destination address' ? 'INVALID_DESTINATION' : 'INVALID_TRON_ADDRESS';
    throw err;
  }
  return s;
}

/**
 * Transfer USDT (TRC20) from the master wallet to a destination address.
 *
 * Manual energy mode: no external energy rental APIs. The master wallet must
 * already hold enough energy/bandwidth (or TRX to burn) for the contract call.
 *
 * @param {object} opts
 * @param {string} opts.toAddress - TRON Base58 destination
 * @param {number|string} opts.amountUsdt - USDT amount to send (net payout)
 * @returns {Promise<{ txId: string, fromAddress: string, toAddress: string, amountUsdt: number }>}
 */
async function transferUsdtTrc20({ toAddress, amountUsdt }) {
  const { assertMasterWalletTransfersAllowed } = require('./securityFlags');
  assertMasterWalletTransfersAllowed('USDT TRC20 transfer');

  const privateKey = getMasterPrivateKey();
  const tronWeb = createTronWeb(privateKey);
  const fromAddressRaw = getMasterAddress(tronWeb, privateKey);
  if (!fromAddressRaw || fromAddressRaw === false) {
    const err = new Error(
      'Could not derive master wallet address from MASTER_PRIVATE_KEY'
    );
    err.code = 'MASTER_ADDRESS_INVALID';
    throw err;
  }
  const fromAddress = assertValidTronAddress(tronWeb, fromAddressRaw, 'master wallet address');
  const contractAddress = assertValidTronAddress(
    tronWeb,
    String(USDT_TRC20_CONTRACT || '').trim(),
    'USDT TRC20 contract address'
  );
  const to = assertValidTronAddress(tronWeb, toAddress, 'destination address');

  if (to === fromAddress) {
    const err = new Error('Destination address cannot be the master wallet');
    err.code = 'INVALID_DESTINATION';
    throw err;
  }

  const amountSun = usdtToSun(amountUsdt);
  await assertMasterHasFunds(tronWeb, { ownerAddress: fromAddress, amountUsdt });

  const contract = await tronWeb.contract(USDT_TRC20_ABI, contractAddress);

  let txId;
  try {
    txId = await contract.methods.transfer(to, amountSun).send({
      feeLimit: DEFAULT_FEE_LIMIT,
      callValue: 0,
      shouldPollResponse: false,
      keepTxID: true,
    });
  } catch (err) {
    const msg = err?.message || String(err);
    // Surface the known TronWeb ABI footgun clearly if it regresses.
    const hint = /toLowerCase/.test(msg)
      ? ' (TronWeb ABI likely missing stateMutability on transfer)'
      : '';
    const wrapped = new Error(`USDT TRC20 transfer failed: ${msg}${hint}`);
    wrapped.code = 'TRANSFER_FAILED';
    wrapped.cause = err;
    throw wrapped;
  }

  const hash = typeof txId === 'string'
    ? txId
    : (txId?.txid || txId?.transaction?.txID || null);

  if (!hash) {
    const err = new Error('USDT transfer submitted but no transaction id was returned');
    err.code = 'TRANSFER_NO_TXID';
    throw err;
  }

  console.log(
    `[tron] USDT TRC20 transfer submitted: ${Number(amountUsdt)} USDT `
    + `${fromAddress} → ${to} tx=${hash}`
  );

  return {
    txId: hash,
    fromAddress,
    toAddress: to,
    amountUsdt: Number(amountUsdt),
  };
}

/** Prefer explicit MASTER_WALLET_ADDRESS; otherwise derive from MASTER_PRIVATE_KEY. */
function getMasterWalletAddress() {
  const configured = String(process.env.MASTER_WALLET_ADDRESS || '').trim();
  if (configured) {
    if (!isLikelyTronAddress(configured)) {
      const err = new Error(
        `MASTER_WALLET_ADDRESS is not a valid TRON address: ${configured}`
      );
      err.code = 'MASTER_ADDRESS_INVALID';
      throw err;
    }
    return configured;
  }
  const privateKey = getMasterPrivateKey();
  const tronWeb = createTronWeb(privateKey);
  return getMasterAddress(tronWeb, privateKey);
}

function isLikelyTronAddress(addr) {
  const s = String(addr || '').trim();
  // Mainnet Base58Check addresses are 34 chars starting with T.
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s)) return false;
  try {
    const tw = new TronWeb({ fullHost: TRON_FULL_HOST });
    return Boolean(tw.isAddress(s));
  } catch (_) {
    return true;
  }
}

function withTimeout(promise, ms, label = 'TRON request') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms}ms`);
      err.code = 'TRON_TIMEOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchJsonTimed(url, options = {}, timeoutMs = BALANCE_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }
    if (res.status === 429) {
      const err = new Error('TronGrid / Tronscan rate limit exceeded — retry shortly or set TRONGRID_API_KEY');
      err.code = 'TRON_RATE_LIMITED';
      err.status = 429;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`TRON HTTP ${res.status}${data?.Error || data?.error ? `: ${data.Error || data.error}` : ''}`);
      err.code = 'TRON_HTTP_ERROR';
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
      const timed = new Error(`TRON request timed out after ${timeoutMs}ms`);
      timed.code = 'TRON_TIMEOUT';
      throw timed;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function tronApiHeaders() {
  const headers = { Accept: 'application/json' };
  const apiKey = process.env.TRONGRID_API_KEY || process.env.TRON_PRO_API_KEY;
  if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;
  return headers;
}

function parseUsdtFromTrc20Map(trc20List) {
  if (!Array.isArray(trc20List)) return 0;
  for (const entry of trc20List) {
    if (!entry || typeof entry !== 'object') continue;
    // TronGrid v1: [{ "TContract…": "1000000" }]
    if (Object.prototype.hasOwnProperty.call(entry, USDT_TRC20_CONTRACT)) {
      return sunToUsdt(entry[USDT_TRC20_CONTRACT]);
    }
    const key = Object.keys(entry).find(
      (k) => k.toUpperCase() === USDT_TRC20_CONTRACT.toUpperCase()
    );
    if (key) return sunToUsdt(entry[key]);
  }
  return 0;
}

/** Timed TronGrid REST account lookup (preferred — does not hang like TronWeb RPC). */
async function fetchBalancesViaTronGrid(address) {
  const base = TRON_FULL_HOST.replace(/\/$/, '');
  const data = await fetchJsonTimed(
    `${base}/v1/accounts/${encodeURIComponent(address)}`,
    { headers: tronApiHeaders() }
  );
  const row = Array.isArray(data?.data) ? data.data[0] : null;
  if (!row) {
    // Brand-new wallets may not exist on-chain yet — treat as zero balances.
    return { usdt: 0, trx: 0, source: 'trongrid' };
  }
  const trxSun = Number(row.balance || 0);
  const usdt = parseUsdtFromTrc20Map(row.trc20);
  return {
    usdt,
    trx: trxSun / 1e6,
    source: 'trongrid',
  };
}

/** Timed Tronscan fallback. */
async function fetchBalancesViaTronscan(address) {
  const api = (process.env.TRONSCAN_API_URL || 'https://apilist.tronscan.org').replace(/\/$/, '');
  const data = await fetchJsonTimed(
    `${api}/api/account?address=${encodeURIComponent(address)}`,
    { headers: { Accept: 'application/json' } }
  );
  if (!data || (data.message && !data.address && data.balance == null)) {
    const err = new Error(data?.message || 'Tronscan account lookup failed');
    err.code = 'TRONSCAN_ERROR';
    throw err;
  }
  const trxSun = Number(data.balance || 0);
  const tokens = data.trc20token_balances || data.tokens || [];
  const usdtTok = tokens.find((t) => {
    const id = String(t.tokenId || t.token_id || t.contract_address || '').toUpperCase();
    return id === USDT_TRC20_CONTRACT.toUpperCase()
      || String(t.tokenAbbr || t.symbol || '').toUpperCase() === 'USDT';
  });
  let usdt = 0;
  if (usdtTok) {
    const raw = usdtTok.balance ?? usdtTok.amount ?? 0;
    const decimals = Number(usdtTok.tokenDecimal ?? usdtTok.decimals ?? TRC20_DECIMALS);
    // Tronscan sometimes returns already-decimalized amounts; prefer raw integer / decimals.
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && String(raw).includes('.')) {
      usdt = asNum;
    } else {
      usdt = asNum / (10 ** decimals);
    }
  }
  return { usdt, trx: trxSun / 1e6, source: 'tronscan' };
}

/** Last-resort TronWeb call — always raced against a timeout. */
async function fetchBalancesViaTronWeb(address) {
  let tronWeb;
  try {
    tronWeb = createTronWeb(getMasterPrivateKey());
  } catch (_) {
    const headers = tronApiHeaders();
    tronWeb = new TronWeb({ fullHost: TRON_FULL_HOST, headers });
    tronWeb.setAddress(address);
  }
  const [usdtInfo, trxSun] = await withTimeout(
    Promise.all([
      getUsdtBalance(tronWeb, address),
      getTrxBalanceSun(tronWeb, address),
    ]),
    BALANCE_FETCH_TIMEOUT_MS,
    'TronWeb balance query'
  );
  return {
    usdt: Number(usdtInfo.usdt) || 0,
    trx: Number(trxSun) / 1e6,
    source: 'tronweb',
  };
}

/**
 * Read-only helper for health / diagnostics (never returns the private key).
 * Uses timed HTTP APIs first so TronGrid rate-limits / RPC hangs cannot stall the admin UI.
 */
async function getMasterWalletInfo() {
  let address;
  try {
    address = getMasterWalletAddress();
  } catch (err) {
    throw err;
  }

  if (!isLikelyTronAddress(address)) {
    const err = new Error(`Master wallet address is invalid: ${address}`);
    err.code = 'MASTER_ADDRESS_INVALID';
    throw err;
  }

  const errors = [];
  const providers = [
    fetchBalancesViaTronGrid,
    fetchBalancesViaTronscan,
    fetchBalancesViaTronWeb,
  ];

  for (const provider of providers) {
    try {
      const bal = await provider(address);
      const trxBalance = Number(bal.trx) || 0;
      const usdtBalance = Number(bal.usdt) || 0;
      const trxLowThreshold = getTrxLowThreshold();
      return {
        address,
        usdtBalance,
        trxBalance,
        trxLowThreshold,
        trxLow: trxBalance < trxLowThreshold,
        contract: USDT_TRC20_CONTRACT,
        source: bal.source,
      };
    } catch (err) {
      console.warn(`[tron] balance via ${provider.name} failed:`, err.code || '', err.message);
      errors.push({ provider: provider.name, code: err.code, message: err.message });
      // Keep trying other providers unless the address itself is invalid.
      if (err.code === 'MASTER_ADDRESS_INVALID') throw err;
    }
  }

  const last = errors[errors.length - 1] || {};
  const err = new Error(
    last.message
      || 'Failed to query master wallet balance from TronGrid / Tronscan'
  );
  err.code = last.code || 'TRON_BALANCE_UNAVAILABLE';
  err.details = { address, errors };
  throw err;
}

module.exports = {
  USDT_TRC20_CONTRACT,
  USDT_TRC20_ABI,
  getMasterPrivateKey,
  getMasterWalletAddress,
  getTrxLowThreshold,
  usdtToSun,
  sunToUsdt,
  transferUsdtTrc20,
  assertMasterHasFunds,
  getMasterWalletInfo,
  isLikelyTronAddress,
  BALANCE_FETCH_TIMEOUT_MS,
};
