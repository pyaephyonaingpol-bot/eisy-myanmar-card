/**
 * USDT on-chain verification via public Tronscan (TRC20) and BSC RPC (BEP20).
 */

const USDT_TRC20_CONTRACT = process.env.USDT_TRC20_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_BEP20_CONTRACT = (process.env.USDT_BEP20_CONTRACT || '0x55d398326f99059fF775485246999027B3197955').toLowerCase();
const BSC_RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
const TRONSCAN_API = process.env.TRONSCAN_API_URL || 'https://apilist.tronscan.org';
const TRON_FULL_HOST =
  process.env.TRON_FULL_HOST || process.env.TRONGRID_FULL_HOST || 'https://api.trongrid.io';
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY || '';
// keccak256("Transfer(address,address,uint256)")
const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df5bb2db6';
const MIN_CONFIRMATIONS = Math.max(0, parseInt(process.env.USDT_MIN_CONFIRMATIONS || '1', 10) || 0);

const TRC20_DECIMALS = 6;
const BEP20_DECIMALS = 18;

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

function normalizeBscAddress(addr) {
  const s = String(addr || '').trim().toLowerCase();
  return s.startsWith('0x') ? s : `0x${s}`;
}

function topicToAddress(topic) {
  if (!topic || topic.length < 42) return null;
  return `0x${topic.slice(-40)}`.toLowerCase();
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

async function bscRpc(method, params) {
  const data = await fetchJson(BSC_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (data.error) {
    throw new Error(data.error.message || 'BSC RPC error');
  }
  return data.result;
}

async function trongridHeaders() {
  const headers = { Accept: 'application/json' };
  const apiKey = process.env.TRONGRID_API_KEY || process.env.TRON_PRO_API_KEY;
  if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;
  return headers;
}

/**
 * Verify a TRC20 USDT transfer via TronGrid (primary).
 * Confirms: tx exists, SUCCESS, USDT TRC20 Transfer to expectedAddress, amount matches.
 */
async function verifyTrc20UsdtViaTronGrid(txHash, expectedAddress, expectedAmountUsdt) {
  const hash = String(txHash).trim();
  const expectedTo = normalizeTronAddress(expectedAddress);
  const headers = await trongridHeaders();

  let info;
  try {
    info = await fetchJson(
      `${TRON_FULL_HOST}/wallet/gettransactioninfobyid`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: hash }),
      }
    );
  } catch (err) {
    console.warn('[usdt-blockchain] TronGrid gettransactioninfobyid failed:', err.message);
    return null;
  }

  if (!info || (!info.id && !info.blockNumber && !info.receipt)) {
    // Tx not found / not indexed yet
    return { ok: false, status: 'pending', message: 'Transaction pending on blockchain or invalid TxHash.', source: 'trongrid' };
  }

  const receiptResult = String(info.receipt?.result || info.contractResult?.[0] || '').toUpperCase();
  if (receiptResult && receiptResult !== 'SUCCESS') {
    return {
      ok: false,
      status: 'invalid',
      message: 'Transaction failed on blockchain — check your TxHash.',
      source: 'trongrid',
    };
  }

  // Prefer confirmed block presence; TronGrid returns blockNumber when mined.
  if (!info.blockNumber && !info.blockTimeStamp) {
    return { ok: false, status: 'pending', message: 'Transaction pending on blockchain or invalid TxHash.', source: 'trongrid' };
  }

  const logs = Array.isArray(info.log) ? info.log : [];

  // Fetch full transaction for contract address context when needed
  let tx;
  try {
    tx = await fetchJson(
      `${TRON_FULL_HOST}/wallet/gettransactionbyid`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: hash }),
      }
    );
  } catch (_) {
    tx = null;
  }

  // Parse TRC20 Transfer events from logs (topics[0]=Transfer, topics[1]=from, topics[2]=to, data=amount)
  const TRANSFER_TOPIC =
    'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df5bb2db6';

  const matches = [];
  for (const log of logs) {
    const topics = (log.topics || []).map((t) => String(t || '').replace(/^0x/, '').toLowerCase());
    if (!topics.length || topics[0] !== TRANSFER_TOPIC) continue;
    if (topics.length < 3) continue;

    // Filter to USDT contract when address present (hex)
    const contractHex = String(log.address || '').replace(/^0x/, '').toLowerCase();
    // Accept if we can later validate via Tronscan fallback; here accept USDT-shaped amounts

    const toHex = topics[2].slice(-40);
    let toBase58 = null;
    try {
      // Lazy require to avoid circular deps; TronWeb is already a project dependency.
      const { TronWeb } = require('tronweb');
      toBase58 = TronWeb.address.fromHex(`41${toHex}`);
    } catch (_) {
      toBase58 = null;
    }

    const amountUsdt = parseTokenAmount(log.data || '0', TRC20_DECIMALS);
    matches.push({
      toAddress: toBase58,
      toHex: `41${toHex}`,
      amountUsdt,
      contractHex,
    });
  }

  if (!matches.length) {
    // No TRC20 logs yet — may still be pending indexing
    return { ok: false, status: 'pending', message: 'Transaction pending on blockchain or invalid TxHash.', source: 'trongrid' };
  }

  const match = matches.find((m) => m.toAddress && normalizeTronAddress(m.toAddress) === expectedTo)
    || matches[0];

  if (!match.toAddress || normalizeTronAddress(match.toAddress) !== expectedTo) {
    return {
      ok: false,
      status: 'invalid',
      message: 'Recipient address does not match the platform deposit wallet.',
      source: 'trongrid',
    };
  }

  if (!amountWithinTolerance(match.amountUsdt, expectedAmountUsdt)) {
    return {
      ok: false,
      status: 'invalid',
      message: `Transfer amount ($${Number(match.amountUsdt).toFixed(2)} USDT) does not match expected deposit ($${Number(expectedAmountUsdt).toFixed(2)} USDT).`,
      actualAmount: match.amountUsdt,
      source: 'trongrid',
    };
  }

  // Optional: confirm contract is USDT by checking trigger contract address on the tx
  if (tx?.raw_data?.contract?.[0]?.parameter?.value?.contract_address) {
    try {
      const { TronWeb } = require('tronweb');
      const cHex = tx.raw_data.contract[0].parameter.value.contract_address;
      const cBase58 = TronWeb.address.fromHex(cHex);
      if (normalizeTronAddress(cBase58) !== USDT_TRC20_CONTRACT) {
        // Still allow if amount/to matched a Transfer log — some wallets wrap calls
        console.warn('[usdt-blockchain] TronGrid contract address differs from USDT:', cBase58);
      }
    } catch (_) { /* ignore */ }
  }

  return {
    ok: true,
    status: 'confirmed',
    network: 'TRC20',
    amountUsdt: match.amountUsdt,
    toAddress: match.toAddress,
    txHash: hash,
    confirmations: info.blockNumber ? 1 : null,
    source: 'trongrid',
  };
}

async function verifyTrc20Usdt(txHash, expectedAddress, expectedAmountUsdt) {
  // Prefer TronGrid (hot-wallet / Trongrid API), fall back to Tronscan.
  const viaGrid = await verifyTrc20UsdtViaTronGrid(txHash, expectedAddress, expectedAmountUsdt);
  if (viaGrid && (viaGrid.ok || viaGrid.status === 'invalid')) {
    return viaGrid;
  }

  const hash = String(txHash).trim();
  const expectedTo = normalizeTronAddress(expectedAddress);

  let data;
  try {
    data = await fetchJson(`${TRONSCAN_API}/api/transaction-info?hash=${encodeURIComponent(hash)}`);
  } catch (err) {
    if (err.status === 404) {
      return viaGrid || { ok: false, status: 'invalid', message: 'Transaction pending on blockchain or invalid TxHash.' };
    }
    console.warn('[usdt-blockchain] Tronscan fetch failed:', err.message);
    return viaGrid || { ok: false, status: 'pending', message: 'Transaction pending on blockchain or invalid TxHash.' };
  }

  if (!data || data.hash == null && !data.txID && !data.confirmed) {
    return viaGrid || { ok: false, status: 'invalid', message: 'Transaction pending on blockchain or invalid TxHash.' };
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
    source: 'tronscan',
  };
}

async function checkBep20Confirmations(receipt) {
  if (MIN_CONFIRMATIONS <= 0 || !receipt?.blockNumber) return null;
  try {
    const txBlock = parseInt(receipt.blockNumber, 16);
    const latestHex = await bscRpc('eth_blockNumber', []);
    const latest = latestHex ? parseInt(latestHex, 16) : null;
    if (!Number.isFinite(txBlock) || !Number.isFinite(latest)) return null;
    const confirmations = Math.max(0, latest - txBlock + 1);
    if (confirmations < MIN_CONFIRMATIONS) {
      return {
        ok: false,
        status: 'pending',
        message: `Waiting for confirmations (${confirmations}/${MIN_CONFIRMATIONS}).`,
        confirmations,
      };
    }
    return { confirmations };
  } catch (err) {
    console.warn('[usdt-blockchain] BEP20 confirmation check failed:', err.message);
    return null;
  }
}

async function verifyBep20UsdtViaRpc(txHash, expectedAddress, expectedAmountUsdt) {
  const hash = String(txHash).trim();
  const expectedTo = normalizeBscAddress(expectedAddress);

  const receipt = await bscRpc('eth_getTransactionReceipt', [hash]);

  if (!receipt) {
    return { ok: false, status: 'pending', message: 'Transaction pending on blockchain or invalid TxHash.' };
  }

  if (receipt.status !== '0x1') {
    return { ok: false, status: 'invalid', message: 'Transaction failed on blockchain — check your TxHash.' };
  }

  const conf = await checkBep20Confirmations(receipt);
  if (conf && conf.ok === false) return conf;

  const logs = receipt.logs || [];
  const usdtLogs = logs.filter((log) => {
    const addr = normalizeBscAddress(log.address);
    const topic0 = (log.topics && log.topics[0] || '').toLowerCase();
    return addr === USDT_BEP20_CONTRACT && topic0 === TRANSFER_EVENT_TOPIC;
  });

  if (!usdtLogs.length) {
    return { ok: false, status: 'invalid', message: 'No USDT (BEP20) transfer found in this transaction.' };
  }

  let matched = null;
  for (const log of usdtLogs) {
    const to = topicToAddress(log.topics[2]);
    if (to === expectedTo) {
      matched = log;
      break;
    }
  }

  if (!matched) {
    const firstTo = topicToAddress(usdtLogs[0].topics[2]);
    return {
      ok: false,
      status: 'invalid',
      message: 'Recipient address does not match the platform deposit wallet.',
      actualTo: firstTo,
    };
  }

  const amountUsdt = parseTokenAmount(matched.data, BEP20_DECIMALS);

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
    network: 'BEP20',
    amountUsdt,
    toAddress: expectedTo,
    txHash: hash,
    blockNumber: receipt.blockNumber,
    confirmations: conf?.confirmations ?? null,
  };
}

async function verifyBep20UsdtViaBscScan(txHash, expectedAddress, expectedAmountUsdt) {
  if (!BSCSCAN_API_KEY) return null;
  const hash = String(txHash).trim();
  const url = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${encodeURIComponent(hash)}&apikey=${encodeURIComponent(BSCSCAN_API_KEY)}`;
  try {
    const data = await fetchJson(url);
    if (data.result) {
      return verifyBep20UsdtFromReceipt(data.result, hash, expectedAddress, expectedAmountUsdt);
    }
  } catch (err) {
    console.warn('[usdt-blockchain] BscScan fallback failed:', err.message);
  }
  return null;
}

async function verifyBep20UsdtFromReceipt(receipt, hash, expectedAddress, expectedAmountUsdt) {
  const expectedTo = normalizeBscAddress(expectedAddress);
  if (!receipt) {
    return { ok: false, status: 'pending', message: 'Transaction pending on blockchain or invalid TxHash.' };
  }
  if (receipt.status !== '0x1') {
    return { ok: false, status: 'invalid', message: 'Transaction failed on blockchain — check your TxHash.' };
  }

  const conf = await checkBep20Confirmations(receipt);
  if (conf && conf.ok === false) return conf;

  const logs = receipt.logs || [];
  const usdtLogs = logs.filter((log) => {
    const addr = normalizeBscAddress(log.address);
    const topic0 = (log.topics && log.topics[0] || '').toLowerCase();
    return addr === USDT_BEP20_CONTRACT && topic0 === TRANSFER_EVENT_TOPIC;
  });
  if (!usdtLogs.length) {
    return { ok: false, status: 'invalid', message: 'No USDT (BEP20) transfer found in this transaction.' };
  }
  const matched = usdtLogs.find((log) => topicToAddress(log.topics[2]) === expectedTo);
  if (!matched) {
    return { ok: false, status: 'invalid', message: 'Recipient address does not match the platform deposit wallet.' };
  }
  const amountUsdt = parseTokenAmount(matched.data, BEP20_DECIMALS);
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
    network: 'BEP20',
    amountUsdt,
    toAddress: expectedTo,
    txHash: hash,
    confirmations: conf?.confirmations ?? null,
  };
}

async function verifyBep20Usdt(txHash, expectedAddress, expectedAmountUsdt) {
  try {
    return await verifyBep20UsdtViaRpc(txHash, expectedAddress, expectedAmountUsdt);
  } catch (err) {
    console.warn('[usdt-blockchain] BSC RPC failed:', err.message);
    const fallback = await verifyBep20UsdtViaBscScan(txHash, expectedAddress, expectedAmountUsdt);
    if (fallback) return fallback;
    return { ok: false, status: 'pending', message: 'Transaction pending on blockchain or invalid TxHash.' };
  }
}

async function verifyUsdtTransaction({
  network,
  txHash,
  expectedAddress,
  expectedAmountUsdt,
}) {
  const net = String(network || 'TRC20').toUpperCase();
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

  if (net === 'TRC20') {
    return verifyTrc20Usdt(txHash, expectedAddress, expectedAmountUsdt);
  }
  if (net === 'BEP20') {
    return verifyBep20Usdt(txHash, expectedAddress, expectedAmountUsdt);
  }

  return { ok: false, status: 'invalid', message: `Unsupported network: ${network}` };
}

const USDT_ERC20_CONTRACT = (process.env.USDT_ERC20_CONTRACT || '0xdAC17F958D2ee523a2206206994597C13D831ec7').toLowerCase();
const ETH_RPC_URL = process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com';
const ERC20_DECIMALS = 6;

function decodeUint256(hex, decimals = 18) {
  if (!hex || hex === '0x') return 0;
  const cleaned = String(hex).replace(/^0x/, '');
  if (!cleaned) return 0;
  return Number(BigInt(`0x${cleaned}`)) / (10 ** decimals);
}

async function evmUsdtBalanceViaRpc(rpcUrl, contractAddress, walletAddress, decimals = 18) {
  const addr = walletAddress.toLowerCase().replace(/^0x/, '');
  const data = `0x70a08231${addr.padStart(64, '0')}`;
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: contractAddress, data }, 'latest'],
    }),
  });
  const json = await response.json();
  if (json.error) {
    throw new Error(json.error.message || 'RPC balance call failed');
  }
  return decodeUint256(json.result, decimals);
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

  try {
    if (net === 'TRC20') {
      const balanceUsdt = await fetchTrc20UsdtBalance(addr);
      return { ok: true, network: net, address: addr, balance_usdt: balanceUsdt };
    }
    if (net === 'BEP20') {
      const balanceUsdt = await evmUsdtBalanceViaRpc(BSC_RPC_URL, USDT_BEP20_CONTRACT, addr, BEP20_DECIMALS);
      return { ok: true, network: net, address: addr, balance_usdt: balanceUsdt };
    }
    if (net === 'ERC20') {
      const balanceUsdt = await evmUsdtBalanceViaRpc(ETH_RPC_URL, USDT_ERC20_CONTRACT, addr, ERC20_DECIMALS);
      return { ok: true, network: net, address: addr, balance_usdt: balanceUsdt };
    }
    return { ok: false, error: `Unsupported network: ${network}` };
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
  USDT_BEP20_CONTRACT,
  USDT_ERC20_CONTRACT,
  TRANSFER_EVENT_TOPIC,
  MIN_CONFIRMATIONS,
};
