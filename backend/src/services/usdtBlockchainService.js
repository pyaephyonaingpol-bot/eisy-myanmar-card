/**
 * USDT on-chain verification via public Tronscan (TRC20 only).
 */

const USDT_TRC20_CONTRACT = process.env.USDT_TRC20_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TRONSCAN_API = process.env.TRONSCAN_API_URL || 'https://apilist.tronscan.org';
const MIN_CONFIRMATIONS = Math.max(0, parseInt(process.env.USDT_MIN_CONFIRMATIONS || '1', 10) || 0);

const TRC20_DECIMALS = 6;

/** Known dummy TxHashes — accepted only when NODE_ENV === 'development'. */
const MOCK_TX_HASHES = new Set([
  '11111',
  'test_tx_hash',
  'test-tx-hash',
  'mock_tx_hash',
]);

function isDevelopmentMode() {
  return process.env.NODE_ENV === 'development';
}

function isMockTxHash(txHash) {
  const normalized = String(txHash || '').trim().toLowerCase();
  return MOCK_TX_HASHES.has(normalized);
}

function verifyMockUsdtTransaction({ network, txHash, expectedAddress, expectedAmountUsdt }) {
  const net = String(network || 'TRC20').toUpperCase();
  const hash = String(txHash).trim();
  const amountUsdt = Number(expectedAmountUsdt);

  console.log('[DEV MODE] Accepting mock USDT transaction hash');

  return {
    ok: true,
    status: 'confirmed',
    network: net,
    amountUsdt: Number.isFinite(amountUsdt) ? amountUsdt : 0,
    toAddress: expectedAddress,
    txHash: hash,
    mock: true,
  };
}

function amountWithinTolerance(actual, expected, tolerance = null) {
  const exp = Number(expected);
  const act = Number(actual);
  if (!Number.isFinite(exp) || !Number.isFinite(act)) return false;
  const tol = tolerance != null
    ? Number(tolerance)
    : Math.max(0.01, exp * 0.005);
  return Math.abs(act - exp) <= tol;
}

function normalizeTronAddress(addr) {
  return String(addr || '').trim();
}

function parseTokenAmount(raw, decimals) {
  if (raw == null) return NaN;
  const str = String(raw).trim();
  if (!str) return NaN;
  if (str.includes('.')) return parseFloat(str);
  const big = BigInt(str);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = Number(big / divisor);
  const frac = Number(big % divisor) / Number(divisor);
  return Math.round((whole + frac) * 1e6) / 1e6;
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function verifyTrc20Usdt(txHash, expectedAddress, expectedAmountUsdt) {
  const hash = String(txHash).trim();
  const expectedTo = normalizeTronAddress(expectedAddress);

  let data;
  try {
    data = await fetchJson(`${TRONSCAN_API}/api/transaction-info?hash=${encodeURIComponent(hash)}`);
  } catch (err) {
    if (err.status === 404) {
      return { ok: false, status: 'invalid', message: 'Transaction pending on blockchain or invalid TxHash.' };
    }
    console.warn('[usdt-blockchain] Tronscan fetch failed:', err.message);
    return { ok: false, status: 'pending', message: 'Transaction pending on blockchain or invalid TxHash.' };
  }

  if (!data || data.hash == null && !data.txID && !data.confirmed) {
    return { ok: false, status: 'invalid', message: 'Transaction pending on blockchain or invalid TxHash.' };
  }

  if (data.confirmed === false) {
    return { ok: false, status: 'pending', message: 'Transaction pending on blockchain or invalid TxHash.' };
  }

  const confirmations = data.confirmations != null ? Number(data.confirmations) : null;
  if (MIN_CONFIRMATIONS > 0 && Number.isFinite(confirmations) && confirmations < MIN_CONFIRMATIONS) {
    return {
      ok: false,
      status: 'pending',
      message: `Waiting for confirmations (${confirmations}/${MIN_CONFIRMATIONS}).`,
      confirmations,
    };
  }

  if (data.contractRet && data.contractRet !== 'SUCCESS') {
    return { ok: false, status: 'invalid', message: 'Transaction failed on blockchain — check your TxHash.' };
  }

  const transfers = []
    .concat(data.trc20TransferInfo || [])
    .concat(data.tokenTransferInfo ? [data.tokenTransferInfo] : [])
    .filter(Boolean);

  const usdtTransfers = transfers.filter((t) => {
    const sym = String(t.symbol || t.tokenName || '').toUpperCase();
    const contract = normalizeTronAddress(t.contract_address || t.tokenId || '');
    return sym === 'USDT' || contract === USDT_TRC20_CONTRACT;
  });

  if (!usdtTransfers.length) {
    return { ok: false, status: 'invalid', message: 'No USDT transfer found in this transaction.' };
  }

  const match = usdtTransfers.find((t) => normalizeTronAddress(t.to_address) === expectedTo)
    || usdtTransfers[0];

  const toAddress = normalizeTronAddress(match.to_address);
  if (toAddress !== expectedTo) {
    return {
      ok: false,
      status: 'invalid',
      message: 'Recipient address does not match the platform deposit wallet.',
    };
  }

  const decimals = Number(match.decimals ?? TRC20_DECIMALS);
  const amountUsdt = parseTokenAmount(match.amount_str ?? match.amount ?? match.quant, decimals);

  if (!amountWithinTolerance(amountUsdt, expectedAmountUsdt)) {
    return {
      ok: false,
      status: 'invalid',
      message: `Transfer amount ($${amountUsdt.toFixed(2)} USDT) does not match expected deposit ($${Number(expectedAmountUsdt).toFixed(2)} USDT).`,
      actualAmount: amountUsdt,
    };
  }

  return {
    ok: true,
    status: 'confirmed',
    network: 'TRC20',
    amountUsdt,
    toAddress,
    txHash: hash,
    confirmations: data.confirmations ?? null,
  };
}

async function verifyUsdtTransaction({
  network,
  txHash,
  expectedAddress,
  expectedAmountUsdt,
}) {
  const net = String(network || 'TRC20').toUpperCase();
  if (net !== 'TRC20' && net !== 'TRON') {
    return {
      ok: false,
      status: 'invalid',
      message: 'USDT deposits use TRC20 (Tron) only.',
    };
  }
  if (!txHash || !String(txHash).trim()) {
    return { ok: false, status: 'invalid', message: 'TxHash is required.' };
  }
  if (!expectedAddress) {
    return { ok: false, status: 'invalid', message: 'Platform deposit address not configured.' };
  }

  const hash = String(txHash).trim();

  if (process.env.NODE_ENV === 'production' && isMockTxHash(hash)) {
    return {
      ok: false,
      status: 'invalid',
      message: 'Transaction pending on blockchain or invalid TxHash.',
    };
  }

  if (isDevelopmentMode() && isMockTxHash(hash)) {
    return verifyMockUsdtTransaction({
      network: net,
      txHash: hash,
      expectedAddress,
      expectedAmountUsdt,
    });
  }

  return verifyTrc20Usdt(txHash, expectedAddress, expectedAmountUsdt);
}

async function fetchTrc20UsdtBalance(address) {
  const url = `${TRONSCAN_API}/api/account?address=${encodeURIComponent(address)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Tronscan request failed');
  const json = await response.json();
  const tokens = json?.trc20token_balances || json?.tokens || [];
  const usdt = tokens.find((t) => {
    const id = String(t.tokenId || t.token_id || t.contract_address || '').toUpperCase();
    return id === USDT_TRC20_CONTRACT.toUpperCase() || String(t.tokenAbbr || t.symbol || '').toUpperCase() === 'USDT';
  });
  if (!usdt) return 0;
  const raw = Number(usdt.balance ?? usdt.amount ?? 0);
  const decimals = Number(usdt.tokenDecimal ?? usdt.decimals ?? TRC20_DECIMALS);
  return raw / (10 ** decimals);
}

async function fetchUsdtOnChainBalance(network, address) {
  const net = String(network || 'TRC20').toUpperCase();
  const addr = String(address || '').trim();
  if (!addr) return { ok: false, error: 'Address required' };

  if (net !== 'TRC20' && net !== 'TRON') {
    return { ok: false, error: 'USDT balances use TRC20 (Tron) only.' };
  }

  try {
    const balanceUsdt = await fetchTrc20UsdtBalance(addr);
    return { ok: true, network: 'TRC20', address: addr, balance_usdt: balanceUsdt };
  } catch (err) {
    return { ok: false, network: net, address: addr, error: err.message };
  }
}

module.exports = {
  verifyUsdtTransaction,
  fetchUsdtOnChainBalance,
  amountWithinTolerance,
  isDevelopmentMode,
  isMockTxHash,
  USDT_TRC20_CONTRACT,
  MIN_CONFIRMATIONS,
};
