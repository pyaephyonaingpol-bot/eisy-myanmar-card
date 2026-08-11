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

const USDT_TRC20_ABI = [
  {
    constant: true,
    inputs: [{ name: 'who', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    type: 'function',
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

/**
 * Transfer USDT (TRC20) from the master wallet to a destination address.
 *
 * @param {object} opts
 * @param {string} opts.toAddress - TRON Base58 destination
 * @param {number|string} opts.amountUsdt - USDT amount to send (net payout)
 * @returns {Promise<{ txId: string, fromAddress: string, toAddress: string, amountUsdt: number }>}
 */
async function transferUsdtTrc20({ toAddress, amountUsdt }) {
  const privateKey = getMasterPrivateKey();
  const tronWeb = createTronWeb(privateKey);
  const fromAddress = getMasterAddress(tronWeb, privateKey);
  const to = String(toAddress || '').trim();

  if (!tronWeb.isAddress(to)) {
    const err = new Error(`Invalid TRON destination address: ${to}`);
    err.code = 'INVALID_DESTINATION';
    throw err;
  }

  if (to === fromAddress) {
    const err = new Error('Destination address cannot be the master wallet');
    err.code = 'INVALID_DESTINATION';
    throw err;
  }

  const amountSun = usdtToSun(amountUsdt);
  await assertMasterHasFunds(tronWeb, { ownerAddress: fromAddress, amountUsdt });

  const contract = await tronWeb.contract(USDT_TRC20_ABI, USDT_TRC20_CONTRACT);

  let txId;
  try {
    txId = await contract.methods.transfer(to, amountSun).send({
      feeLimit: DEFAULT_FEE_LIMIT,
      callValue: 0,
      shouldPollResponse: false,
      keepTxID: true,
    });
  } catch (err) {
    const wrapped = new Error(
      `USDT TRC20 transfer failed: ${err.message || String(err)}`
    );
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
    return configured;
  }
  const privateKey = getMasterPrivateKey();
  const tronWeb = createTronWeb(privateKey);
  return getMasterAddress(tronWeb, privateKey);
}

/** Read-only helper for health / diagnostics (never returns the private key). */
async function getMasterWalletInfo() {
  const address = getMasterWalletAddress();
  let tronWeb;
  try {
    tronWeb = createTronWeb(getMasterPrivateKey());
  } catch (_) {
    const headers = {};
    const apiKey = process.env.TRONGRID_API_KEY || process.env.TRON_PRO_API_KEY;
    if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;
    tronWeb = new TronWeb({ fullHost: TRON_FULL_HOST, headers });
    tronWeb.setAddress(address);
  }
  const usdt = await getUsdtBalance(tronWeb, address);
  const trxSun = await getTrxBalanceSun(tronWeb, address);
  return {
    address,
    usdtBalance: usdt.usdt,
    trxBalance: Number(trxSun) / 1e6,
    contract: USDT_TRC20_CONTRACT,
  };
}

module.exports = {
  USDT_TRC20_CONTRACT,
  getMasterPrivateKey,
  getMasterWalletAddress,
  usdtToSun,
  sunToUsdt,
  transferUsdtTrc20,
  assertMasterHasFunds,
  getMasterWalletInfo,
};
