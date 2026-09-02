const crypto = require('crypto');
const User = require('../models/User');
const TransactionLog = require('../models/TransactionLog');
const { UserUsdtWalletAddress, SUPPORTED_NETWORKS } = require('../models/UserUsdtWalletAddress');
const UsdtWalletTransaction = require('../models/UsdtWalletTransaction');
const { getUsdtDepositSettings } = require('./settingsService');
const { formatUsdt } = require('./walletService');

const NETWORK_LABELS = {
  TRC20: 'TRC20 (Tron)',
  BEP20: 'BEP20 (BSC)',
  ERC20: 'ERC20 (Ethereum)',
};

/** Users whose USDT ledger has already been backfilled (or confirmed present). */
const _ledgerSyncedUsers = new Set();

function normalizeNetwork(network) {
  const n = String(network || '').trim().toUpperCase();
  if (n === 'TRC20' || n === 'TRON') return 'TRC20';
  if (n === 'BEP20' || n === 'BSC') return 'BEP20';
  if (n === 'ERC20' || n === 'ETH' || n === 'ETHEREUM') return 'ERC20';
  return null;
}

function validateWalletAddress(network, address) {
  const net = normalizeNetwork(network);
  const addr = String(address || '').trim();
  if (!addr) throw new Error('Enter a USDT wallet address');
  if (!net) throw new Error('Select a supported network: TRC20, BEP20, or ERC20');

  if (net === 'TRC20') {
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) {
      throw new Error('Invalid TRC20 address — must start with T and be 34 characters');
    }
    return { network: net, address: addr };
  }

  if (net === 'BEP20' || net === 'ERC20') {
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      throw new Error(`Invalid ${net} address — must be a 42-character hex address starting with 0x`);
    }
    return { network: net, address: addr };
  }

  throw new Error('Unsupported network');
}

function platformAddressForNetwork(settings, network) {
  if (network === 'TRC20') {
    try {
      const { getMasterWalletAddress } = require('./tronMasterWalletService');
      return getMasterWalletAddress() || settings.usdt_trc20_address || null;
    } catch (_) {
      return settings.usdt_trc20_address || null;
    }
  }
  if (network === 'BEP20') return settings.usdt_bep20_address || null;
  if (network === 'ERC20') return settings.usdt_erc20_address || null;
  return null;
}

function generateDepositReference(userId, network) {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `EISY-U${userId}-${network}-${suffix}`;
}

function mapAddressRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    network: row.network,
    network_label: NETWORK_LABELS[row.network] || row.network,
    address: row.address,
    address_type: row.address_type,
    deposit_reference: row.deposit_reference || null,
    label: row.label || null,
    is_primary: Boolean(row.is_primary),
    derivation_index: row.derivation_index != null ? Number(row.derivation_index) : null,
    derivation_path: row.derivation_path || null,
    created_at: row.created_at,
  };
}

function mapTransactionRow(row) {
  let metadata = null;
  try {
    metadata = row.metadata ? JSON.parse(row.metadata) : null;
  } catch (_) {}

  return {
    id: row.id,
    network: row.network,
    tx_type: row.tx_type,
    direction: row.direction,
    amount_usdt: Number(row.amount_usdt ?? 0),
    balance_before: row.balance_before != null ? Number(row.balance_before) : null,
    balance_after: row.balance_after != null ? Number(row.balance_after) : null,
    locked_balance_after: row.locked_balance_after != null ? Number(row.locked_balance_after) : null,
    journal_id: row.journal_id || null,
    counterparty_user_id: row.counterparty_user_id ?? null,
    tx_hash: row.tx_hash || null,
    counterparty_address: row.counterparty_address || null,
    status: row.status,
    reference_type: row.reference_type || null,
    reference_id: row.reference_id ?? null,
    description: row.description || '',
    metadata,
    created_at: row.created_at,
  };
}

async function provisionCustodialAddress(userId, network, settings) {
  if (network === 'TRC20') {
    try {
      const { ensureUserTronDepositAddress } = require('./tronDepositAddressService');
      const { isHdEnabled } = require('./tronHdWalletService');
      if (isHdEnabled()) {
        const assigned = await ensureUserTronDepositAddress(userId);
        if (assigned?.row) return assigned.row;
      }
    } catch (err) {
      console.warn('[usdt-wallet] HD TRC20 provision failed, using shared address:', err.message);
    }
  }

  const existing = await UserUsdtWalletAddress.findCustodial(userId, network);
  if (existing) return existing;

  const platformAddress = platformAddressForNetwork(settings, network);
  if (!platformAddress) {
    return null;
  }

  return UserUsdtWalletAddress.create({
    userId,
    network,
    address: platformAddress,
    addressType: 'custodial',
    depositReference: generateDepositReference(userId, network),
    label: `${NETWORK_LABELS[network]} deposit`,
    isPrimary: 1,
  });
}

async function provisionCustodialAddresses(userId) {
  const settings = await getUsdtDepositSettings();
  const addresses = [];

  for (const network of SUPPORTED_NETWORKS) {
    const row = await provisionCustodialAddress(userId, network, settings);
    if (row) addresses.push(row);
  }

  return addresses;
}

async function linkExternalAddress(userId, { network, address, label }) {
  const { network: net, address: addr } = validateWalletAddress(network, address);

  const duplicate = await UserUsdtWalletAddress.findLinkedByAddress(userId, net, addr);
  if (duplicate) {
    const err = new Error('This address is already linked to your account');
    err.code = 'ADDRESS_ALREADY_LINKED';
    throw err;
  }

  const trimmedLabel = String(label || '').trim().slice(0, 64) || `${NETWORK_LABELS[net]} wallet`;

  return UserUsdtWalletAddress.create({
    userId,
    network: net,
    address: addr,
    addressType: 'linked',
    label: trimmedLabel,
    isPrimary: 0,
  });
}

async function unlinkExternalAddress(userId, addressId) {
  const removed = await UserUsdtWalletAddress.deleteLinked(addressId, userId);
  if (!removed) {
    const err = new Error('Linked address not found');
    err.code = 'ADDRESS_NOT_FOUND';
    throw err;
  }
  return removed;
}

async function recordWalletEntry({
  userId,
  txType,
  direction = 'neutral',
  amountUsdt = 0,
  balanceAfter = null,
  network = null,
  txHash = null,
  counterpartyAddress = null,
  status = 'completed',
  referenceType = null,
  referenceId = null,
  description = null,
  metadata = null,
}) {
  if (referenceType != null && referenceId != null) {
    const dup = await UsdtWalletTransaction.findDuplicateReference(
      userId,
      referenceType,
      referenceId,
      txType
    );
    if (dup) return UsdtWalletTransaction.findById(dup.id);
  }

  return UsdtWalletTransaction.create({
    userId,
    network,
    txType,
    direction,
    amountUsdt,
    balanceAfter,
    txHash,
    counterpartyAddress,
    status,
    referenceType,
    referenceId,
    description,
    metadata,
  });
}

async function syncLedgerFromTransactionLogs(userId, { limit = 200 } = {}) {
  if (_ledgerSyncedUsers.has(userId)) {
    return { synced: 0, skipped: true };
  }

  const existingCount = await UsdtWalletTransaction.countByUserId(userId);
  if (existingCount > 0) {
    _ledgerSyncedUsers.add(userId);
    return { synced: 0, skipped: true };
  }

  const logs = await TransactionLog.findByUserId(userId, { limit });
  let synced = 0;

  for (const log of logs) {
    let metadata = {};
    try {
      metadata = log.metadata ? JSON.parse(log.metadata) : {};
    } catch (_) {}

    if (metadata.wallet !== 'usdt') continue;

    const amount = Number(log.amount_usd ?? metadata.amount_usdt ?? 0);
    if (!amount && log.type !== 'deposit_verified') continue;

    await recordWalletEntry({
      userId,
      txType: log.type,
      direction: log.direction || 'neutral',
      amountUsdt: amount,
      balanceAfter: log.balance_after != null ? Number(log.balance_after) : null,
      network: metadata.network || metadata.usdt_network || null,
      txHash: metadata.txn_id || metadata.tx_hash || null,
      counterpartyAddress: metadata.wallet_address || metadata.deposit_address || null,
      referenceType: log.reference_type || null,
      referenceId: log.reference_id ?? null,
      description: log.description,
      metadata,
    });
    synced += 1;
  }

  _ledgerSyncedUsers.add(userId);
  return { synced, skipped: false };
}

async function fetchLinkedOnChainBalance(network, address) {
  try {
    const { fetchUsdtOnChainBalance } = require('./usdtBlockchainService');
    return await fetchUsdtOnChainBalance(network, address);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function resolveUsdtBalancesForDisplay(userId, user = null) {
  const { getUsdtBalances } = require('./usdtLedgerService');
  const { overlayWalletPayloadFromSupabase } = require('./supabaseWalletReadService');
  let balances = await getUsdtBalances(userId);
  try {
    const fromSb = await overlayWalletPayloadFromSupabase(userId, {
      balance_usdt: balances.available_usdt,
      balance_usdt_locked: balances.locked_usdt,
      email: user?.email,
      updated_at: user?.updated_at || null,
    });
    if (fromSb.source === 'supabase') {
      balances = {
        ...balances,
        available_usdt: fromSb.balance_usdt,
        locked_usdt: fromSb.balance_usdt_locked,
        total_usdt: fromSb.balance_usdt_total,
        available_formatted: fromSb.usdt_formatted,
        locked_formatted: fromSb.usdt_locked_formatted,
        total_formatted: fromSb.usdt_total_formatted,
        source: 'supabase',
      };
    } else if (fromSb.source === 'turso') {
      balances = {
        ...balances,
        source: 'turso',
      };
    }
  } catch (err) {
    console.warn('[usdt-wallet] supabase overlay skipped:', err.message);
  }
  return balances;
}

async function getWalletOverview(userId, { includeOnChain = false } = {}) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  try {
    const { ensureSupabaseUserWallet } = require('./supabaseSyncService');
    await ensureSupabaseUserWallet(userId);
  } catch (err) {
    console.warn('[usdt-wallet/overview] Supabase wallet ensure skipped:', err.message);
  }

  // Always resolve balances first so Available / Locked / Total can render
  // even when deposit-address provisioning or escrow queries fail.
  const balances = await resolveUsdtBalancesForDisplay(userId, user);

  let settings = {
    minimum_usdt_deposit: 10,
    usdt_trc20_address: null,
    usdt_bep20_address: null,
    usdt_erc20_address: null,
  };
  let custodial = [];
  let linked = [];
  let escrow_holds = [];
  let recent_transactions = [];
  let rows = [];

  try {
    rows = await UserUsdtWalletAddress.findByUserId(userId);
  } catch (err) {
    console.warn('[usdt-wallet/overview] addresses load skipped:', err.message);
  }

  const custodialNetworks = new Set(
    rows.filter((r) => r.address_type === 'custodial').map((r) => r.network)
  );
  const needsProvision = SUPPORTED_NETWORKS.some((net) => !custodialNetworks.has(net));
  const trc20Custodial = rows.find((r) => r.address_type === 'custodial' && r.network === 'TRC20');
  const needsHdUpgrade = Boolean(trc20Custodial && trc20Custodial.derivation_index == null);

  // Provision missing networks and/or upgrade shared TRC20 → per-user HD address.
  if (needsProvision || needsHdUpgrade) {
    try {
      if (needsHdUpgrade) {
        const { ensureUserTronDepositAddress } = require('./tronDepositAddressService');
        const { isHdEnabled } = require('./tronHdWalletService');
        if (isHdEnabled()) {
          await ensureUserTronDepositAddress(userId);
        }
      }
      if (needsProvision) {
        await provisionCustodialAddresses(userId);
      }
      rows = await UserUsdtWalletAddress.findByUserId(userId);
    } catch (err) {
      console.warn('[usdt-wallet/overview] provision skipped:', err.message);
    }
  }

  // One-shot ledger backfill — skipped after first successful check per process.
  try {
    await syncLedgerFromTransactionLogs(userId);
  } catch (err) {
    console.warn('[usdt-wallet/overview] ledger sync skipped:', err.message);
  }

  try {
    settings = await getUsdtDepositSettings();
  } catch (err) {
    console.warn('[usdt-wallet/overview] settings skipped:', err.message);
  }

  try {
    for (const row of rows) {
      const mapped = mapAddressRow(row);
      if (row.address_type === 'linked') {
        if (includeOnChain) {
          mapped.on_chain_balance = await fetchLinkedOnChainBalance(row.network, row.address);
        }
        linked.push(mapped);
      } else {
        custodial.push(mapped);
      }
    }
  } catch (err) {
    console.warn('[usdt-wallet/overview] addresses map skipped:', err.message);
  }

  try {
    const txRows = await UsdtWalletTransaction.findByUserId(userId, { limit: 10 });
    recent_transactions = txRows.map(mapTransactionRow);
  } catch (err) {
    console.warn('[usdt-wallet/overview] transactions skipped:', err.message);
  }

  try {
    const UsdtEscrowHold = require('../models/UsdtEscrowHold');
    const escrowRows = await UsdtEscrowHold.findByUserId(userId, { status: 'active' });
    escrow_holds = escrowRows.map((row) => ({
      id: row.id,
      hold_type: row.hold_type,
      amount_usdt: Number(row.amount_usdt ?? 0),
      remaining_usdt: Number(row.remaining_usdt ?? 0),
      reference_type: row.reference_type,
      reference_id: row.reference_id,
      status: row.status,
      created_at: row.created_at,
      label: row.hold_type === 'p2p_ad'
        ? 'P2P sell ad escrow'
        : row.hold_type === 'p2p_sell_order'
          ? 'P2P sell order escrow'
          : row.hold_type,
    }));
  } catch (err) {
    console.warn('[usdt-wallet/overview] escrow skipped:', err.message);
  }

  return {
    balance_usdt: balances.available_usdt,
    balance_usdt_locked: balances.locked_usdt,
    balance_usdt_total: balances.total_usdt,
    balance_formatted: balances.available_formatted,
    locked_formatted: balances.locked_formatted,
    total_formatted: balances.total_formatted,
    source: balances.source || 'turso',
    minimum_usdt_deposit: settings.minimum_usdt_deposit,
    networks: SUPPORTED_NETWORKS.map((id) => ({
      id,
      label: NETWORK_LABELS[id],
      platform_configured: Boolean(platformAddressForNetwork(settings, id)),
    })),
    deposit_addresses: custodial,
    linked_addresses: linked,
    escrow_holds,
    recent_transactions,
  };
}

async function getWalletTransactions(userId, { limit = 100, offset = 0, network = null } = {}) {
  const rows = await UsdtWalletTransaction.findByUserId(userId, { limit, offset, network });
  return rows.map(mapTransactionRow);
}

async function getWalletBalance(userId) {
  const user = await User.findById(userId);
  const balances = await resolveUsdtBalancesForDisplay(userId, user);
  return {
    ...balances,
    source: balances.source || 'turso',
  };
}

module.exports = {
  SUPPORTED_NETWORKS,
  NETWORK_LABELS,
  normalizeNetwork,
  validateWalletAddress,
  provisionCustodialAddresses,
  linkExternalAddress,
  unlinkExternalAddress,
  recordWalletEntry,
  syncLedgerFromTransactionLogs,
  getWalletOverview,
  getWalletTransactions,
  getWalletBalance,
  mapAddressRow,
  mapTransactionRow,
};
