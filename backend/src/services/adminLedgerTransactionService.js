const { getDb } = require('../db');
const { parseRecordMetadata } = require('./settingsService');
const { resolveReloadNetProfit } = require('../constants/cardReloadFees');

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

async function listP2pAdminTransactions({ userId, limit = 200 } = {}) {
  const db = getDb();
  const params = [];
  let userFilter = '';

  if (userId) {
    userFilter = ' AND (o.user_id = ? OR o.maker_user_id = ?)';
    params.push(userId, userId);
  }

  const buyRows = await db.all(`
    SELECT
      o.id,
      o.ref_code,
      'buy' AS side,
      o.status,
      o.amount_usdt AS escrow_usdt,
      o.amount_mmk,
      o.platform_fee_usdt,
      o.net_usdt_to_buyer,
      o.payment_method,
      o.released_at,
      o.created_at,
      o.user_id AS buyer_user_id,
      o.maker_user_id AS seller_user_id,
      buyer.name AS buyer_name,
      buyer.email AS buyer_email,
      seller.name AS seller_name,
      seller.email AS seller_email
    FROM p2p_buy_orders o
    LEFT JOIN users buyer ON buyer.id = o.user_id
    LEFT JOIN users seller ON seller.id = o.maker_user_id
    WHERE o.status IN ('released', 'pending_seller_release', 'completed_by_admin')
    ${userFilter}
    ORDER BY COALESCE(o.released_at, o.created_at) DESC
    LIMIT ?
  `, ...params, limit);

  const sellRows = await db.all(`
    SELECT
      o.id,
      o.ref_code,
      'sell' AS side,
      o.status,
      o.amount_usdt AS escrow_usdt,
      o.amount_mmk,
      o.platform_fee_usdt,
      o.net_usdt_to_merchant,
      o.payment_method,
      o.released_at,
      o.created_at,
      o.user_id AS seller_user_id,
      o.maker_user_id AS buyer_user_id,
      seller.name AS seller_name,
      seller.email AS seller_email,
      buyer.name AS buyer_name,
      buyer.email AS buyer_email
    FROM p2p_sell_orders o
    LEFT JOIN users seller ON seller.id = o.user_id
    LEFT JOIN users buyer ON buyer.id = o.maker_user_id
    WHERE o.status IN ('released', 'pending_merchant_mmk', 'completed_by_admin')
    ${userFilter}
    ORDER BY COALESCE(o.released_at, o.created_at) DESC
    LIMIT ?
  `, ...params, limit);

  const combined = [...buyRows, ...sellRows]
    .sort((a, b) => new Date(b.released_at || b.created_at || 0) - new Date(a.released_at || a.created_at || 0))
    .slice(0, limit);

  return combined.map((row) => ({
    id: row.id,
    ref_code: row.ref_code,
    side: row.side,
    category: 'p2p',
    status: row.status,
    escrow_usdt: round2(row.escrow_usdt),
    amount_mmk: row.amount_mmk != null ? round2(row.amount_mmk) : null,
    platform_fee_usdt: round2(row.platform_fee_usdt),
    net_usdt: row.net_usdt_to_buyer != null ? round2(row.net_usdt_to_buyer)
      : (row.net_usdt_to_merchant != null ? round2(row.net_usdt_to_merchant) : null),
    payment_method: row.payment_method,
    buyer: {
      user_id: row.side === 'buy' ? row.buyer_user_id : row.buyer_user_id,
      name: row.buyer_name,
      email: row.buyer_email,
    },
    seller: {
      user_id: row.side === 'buy' ? row.seller_user_id : row.seller_user_id,
      name: row.seller_name,
      email: row.seller_email,
    },
    released_at: row.released_at,
    created_at: row.created_at,
  }));
}

async function listCardReloadAdminTransactions({ userId, limit = 200 } = {}) {
  const db = getDb();
  const params = [];
  let userFilter = '';

  if (userId) {
    userFilter = ' AND r.user_id = ?';
    params.push(userId);
  }

  const rows = await db.all(`
    SELECT
      r.id,
      r.user_id,
      r.card_id,
      r.wallet_type,
      r.amount_mmk,
      r.amount_usdt,
      r.net_usd_to_card,
      r.reload_fee_usd,
      r.gross_usd,
      r.pricing_json,
      r.status,
      r.admin_note,
      r.reviewed_at,
      r.created_at,
      u.name AS user_name,
      u.email AS user_email,
      c.card_number,
      substr(replace(c.card_number, ' ', ''), -4) AS card_last_four
    FROM card_reload_requests r
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN cards_v2 c ON c.id = r.card_id
    WHERE 1=1
    ${userFilter}
    ORDER BY COALESCE(r.reviewed_at, r.created_at) DESC
    LIMIT ?
  `, ...params, limit);

  return rows.map((row) => {
    const pricing = parseRecordMetadata(row.pricing_json);
    return {
    id: row.id,
    ref_code: `RELOAD-${row.id}`,
    category: 'card_reload',
    user_id: row.user_id,
    user_name: row.user_name,
    user_email: row.user_email,
    card_id: row.card_id,
    card_last_four: row.card_last_four,
    wallet_type: row.wallet_type,
    reload_amount_usd: round2(row.net_usd_to_card),
    gross_usd: row.gross_usd != null ? round2(row.gross_usd) : null,
    user_service_fee_usd: row.reload_fee_usd != null ? round2(row.reload_fee_usd) : null,
    fee_profit_usd: round2(resolveReloadNetProfit({
      pricing,
      reload_fee_usd: row.reload_fee_usd,
    })),
    amount_mmk: row.amount_mmk != null ? round2(row.amount_mmk) : null,
    amount_usdt: row.amount_usdt != null ? round2(row.amount_usdt) : null,
    status: row.status,
    provider_status: row.status,
    admin_note: row.admin_note,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    pricing,
  };
  });
}

async function listCardIssuanceAdminTransactions({ userId, limit = 200 } = {}) {
  const db = getDb();
  const params = [];
  let userFilter = '';

  if (userId) {
    userFilter = ' AND t.user_id = ?';
    params.push(userId);
  }

  const rows = await db.all(`
    SELECT
      t.id,
      t.user_id,
      t.amount_usd,
      t.reference_type,
      t.reference_id,
      t.description,
      t.metadata,
      t.created_at,
      u.name AS user_name,
      u.email AS user_email,
      c.card_number,
      substr(replace(c.card_number, ' ', ''), -4) AS card_last_four,
      c.status AS card_status
    FROM transaction_logs t
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN cards_v2 c ON c.id = t.reference_id AND t.reference_type = 'cards_v2'
    WHERE t.type = 'card_issued'
    ${userFilter}
    ORDER BY t.created_at DESC
    LIMIT ?
  `, ...params, limit);

  return rows.map((row) => {
    const metadata = parseRecordMetadata(row.metadata);
    const pricing = metadata.pricing || {};
    return {
      id: row.id,
      ref_code: row.reference_id ? `CARD-${row.reference_id}` : `ISSUE-${row.id}`,
      category: 'card_issuance',
      user_id: row.user_id,
      user_name: row.user_name,
      user_email: row.user_email,
      card_id: row.reference_id,
      card_last_four: row.card_last_four,
      kripicard_cost_usd: round2(
        pricing.kripicard_cost_usd ?? pricing.initial_load_usd ?? metadata.kripicard_cost_usd
      ),
      platform_markup_usd: round2(
        pricing.platform_markup_usd ?? pricing.issuance_fee_usd ?? metadata.platform_markup_usd
      ),
      total_charge_usdt: round2(
        pricing.total_charge_usdt ?? pricing.total_usdt ?? row.amount_usd
      ),
      wallet_type: metadata.wallet || metadata.wallet_type || 'usdt',
      provider: metadata.provider || 'kripicard',
      provider_card_id: metadata.provider_card_id || null,
      status: metadata.pending || row.card_status === 'pending' ? 'pending' : 'issued',
      created_at: row.created_at,
      pricing,
    };
  });
}

async function listMmkWithdrawalAdminTransactions({ userId, limit = 200 } = {}) {
  const db = getDb();
  const params = [];
  let userFilter = '';

  if (userId) {
    userFilter = ' AND w.user_id = ?';
    params.push(userId);
  }

  const rows = await db.all(`
    SELECT
      w.id,
      w.user_id,
      w.ref_code,
      w.amount_mmk,
      w.fee_mmk,
      w.net_mmk,
      w.fee_percent,
      w.bank_name,
      w.account_name,
      w.account_number,
      w.status,
      w.admin_note,
      w.processed_at,
      w.created_at,
      u.name AS user_name,
      u.email AS user_email
    FROM mmk_withdrawal_requests w
    LEFT JOIN users u ON u.id = w.user_id
    WHERE 1=1
    ${userFilter}
    ORDER BY COALESCE(w.processed_at, w.created_at) DESC
    LIMIT ?
  `, ...params, limit);

  return rows.map((row) => ({
    id: row.id,
    ref_code: row.ref_code,
    category: 'mmk_withdrawal',
    user_id: row.user_id,
    user_name: row.user_name,
    user_email: row.user_email,
    amount_mmk: round2(row.amount_mmk),
    fee_mmk: round2(row.fee_mmk),
    net_mmk: round2(row.net_mmk),
    fee_percent: row.fee_percent != null ? round2(row.fee_percent) : null,
    bank_name: row.bank_name,
    account_name: row.account_name,
    account_number: row.account_number,
    status: row.status,
    admin_note: row.admin_note,
    processed_at: row.processed_at,
    created_at: row.created_at,
  }));
}

/**
 * On-chain / crypto USDT deposits (deposit_requests_v2).
 * Surfaces deposit address, network, and Tx hash for admin forensics.
 */
async function listUsdtDepositAdminTransactions({ userId, limit = 200 } = {}) {
  const db = getDb();
  const params = [];
  let userFilter = '';

  if (userId) {
    userFilter = ' AND d.user_id = ?';
    params.push(userId);
  }

  const rows = await db.all(`
    SELECT
      d.id,
      d.user_id,
      d.ref_code,
      d.amount_usd,
      d.amount_mmk,
      d.deposit_currency,
      d.usdt_network,
      d.payment_method,
      d.tx_hash,
      d.txn_id,
      d.kpay_transaction_id,
      d.status,
      d.purpose,
      d.platform_profit_usd,
      d.admin_note,
      d.user_note,
      d.metadata,
      d.submitted_at,
      d.reviewed_at,
      d.created_at,
      u.name AS user_name,
      u.email AS user_email,
      u.phone AS user_phone,
      a.address AS custodial_deposit_address,
      a.derivation_path AS custodial_derivation_path,
      a.derivation_index AS custodial_derivation_index
    FROM deposit_requests_v2 d
    LEFT JOIN users u ON u.id = d.user_id
    LEFT JOIN user_usdt_wallet_addresses a
      ON a.user_id = d.user_id
     AND a.network = 'TRC20'
     AND a.address_type = 'custodial'
    WHERE UPPER(COALESCE(d.deposit_currency, 'USDT')) = 'USDT'
    ${userFilter}
    ORDER BY COALESCE(d.reviewed_at, d.submitted_at, d.created_at) DESC
    LIMIT ?
  `, ...params, limit);

  return rows.map((row) => {
    const metadata = parseRecordMetadata(row.metadata);
    const txHash = row.tx_hash || row.txn_id || row.kpay_transaction_id || metadata.tx_hash || null;
    const depositAddress = metadata.deposit_address
      || metadata.tron_deposit_address
      || row.custodial_deposit_address
      || null;
    return {
      id: row.id,
      ref_code: row.ref_code,
      category: 'usdt_deposit',
      user_id: row.user_id,
      user_name: row.user_name,
      user_email: row.user_email,
      user_phone: row.user_phone,
      amount_usdt: round2(row.amount_usd),
      network: row.usdt_network || metadata.network || metadata.usdt_network || 'TRC20',
      payment_method: row.payment_method,
      deposit_address: depositAddress,
      derivation_path: row.custodial_derivation_path || metadata.derivation_path || null,
      derivation_index: row.custodial_derivation_index != null
        ? Number(row.custodial_derivation_index)
        : (metadata.derivation_index != null ? Number(metadata.derivation_index) : null),
      tx_hash: txHash,
      tron_order_id: metadata.tron_order_id || null,
      purpose: row.purpose,
      platform_profit_usd: row.platform_profit_usd != null ? round2(row.platform_profit_usd) : null,
      status: row.status,
      admin_note: row.admin_note,
      user_note: row.user_note,
      submitted_at: row.submitted_at,
      reviewed_at: row.reviewed_at,
      created_at: row.created_at,
      metadata,
    };
  });
}

/**
 * USDT crypto + bank withdrawals (usdt_withdrawal_requests).
 * Surfaces destination address / bank details and on-chain Tx hash.
 */
async function listUsdtWithdrawalAdminTransactions({ userId, limit = 200 } = {}) {
  const db = getDb();
  const params = [];
  let userFilter = '';

  if (userId) {
    userFilter = ' AND w.user_id = ?';
    params.push(userId);
  }

  const rows = await db.all(`
    SELECT
      w.id,
      w.user_id,
      w.ref_code,
      w.payout_method,
      w.payout_provider,
      w.network,
      w.wallet_address,
      w.amount_usdt,
      w.fee_usdt,
      w.net_usdt,
      w.fee_type,
      w.exchange_rate,
      w.amount_mmk,
      w.bank_name,
      w.account_name,
      w.account_number,
      w.status,
      w.admin_note,
      w.tx_hash,
      w.nowpayments_payout_id,
      w.nowpayments_withdrawal_id,
      w.processed_by,
      w.processed_at,
      w.created_at,
      u.name AS user_name,
      u.email AS user_email,
      u.phone AS user_phone,
      admin_u.name AS processed_by_name,
      admin_u.email AS processed_by_email
    FROM usdt_withdrawal_requests w
    LEFT JOIN users u ON u.id = w.user_id
    LEFT JOIN users admin_u ON admin_u.id = w.processed_by
    WHERE 1=1
    ${userFilter}
    ORDER BY COALESCE(w.processed_at, w.created_at) DESC
    LIMIT ?
  `, ...params, limit);

  return rows.map((row) => ({
    id: row.id,
    ref_code: row.ref_code,
    category: 'usdt_withdrawal',
    user_id: row.user_id,
    user_name: row.user_name,
    user_email: row.user_email,
    user_phone: row.user_phone,
    payout_method: row.payout_method || (row.network === 'BANK' || row.bank_name ? 'bank' : 'crypto'),
    payout_provider: row.payout_provider || null,
    network: row.network,
    wallet_address: row.wallet_address,
    amount_usdt: round2(row.amount_usdt),
    fee_usdt: round2(row.fee_usdt),
    net_usdt: round2(row.net_usdt),
    fee_type: row.fee_type,
    exchange_rate: row.exchange_rate != null ? Number(row.exchange_rate) : null,
    amount_mmk: row.amount_mmk != null ? round2(row.amount_mmk) : null,
    bank_name: row.bank_name,
    account_name: row.account_name,
    account_number: row.account_number,
    status: row.status,
    admin_note: row.admin_note,
    tx_hash: row.tx_hash,
    nowpayments_payout_id: row.nowpayments_payout_id || null,
    nowpayments_withdrawal_id: row.nowpayments_withdrawal_id || null,
    processed_by: row.processed_by,
    processed_by_name: row.processed_by_name,
    processed_by_email: row.processed_by_email,
    processed_at: row.processed_at,
    created_at: row.created_at,
  }));
}

module.exports = {
  listP2pAdminTransactions,
  listCardReloadAdminTransactions,
  listCardIssuanceAdminTransactions,
  listMmkWithdrawalAdminTransactions,
  listUsdtDepositAdminTransactions,
  listUsdtWithdrawalAdminTransactions,
};
