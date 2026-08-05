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

module.exports = {
  listP2pAdminTransactions,
  listCardReloadAdminTransactions,
};
