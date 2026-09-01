const { getDb } = require('../db');
const { parseRecordMetadata } = require('../services/settingsService');
const { resolveReloadNetProfit } = require('../constants/cardReloadFees');
const { syncCardReload } = require('../services/supabaseSyncService');

const CardReloadRequest = {
  TABLE: 'card_reload_requests',

  async findById(id) {
    const db = getDb();
    return db.get(`SELECT * FROM ${this.TABLE} WHERE id = ?`, id);
  },

  async create({
    userId,
    cardId,
    walletType,
    amountMmk,
    amountUsdt,
    netUsdToCard,
    reloadFeeUsd,
    grossUsd,
    pricing,
    depositId,
    userNote,
  }) {
    const normalizedWallet = String(walletType || '').toLowerCase();
    if (normalizedWallet !== 'usdt') {
      const err = new Error('Card reload requests accept USDT wallet only.');
      err.code = 'USDT_ONLY_CARD_RELOAD';
      throw err;
    }
    if (amountMmk != null && Number(amountMmk) > 0) {
      const err = new Error('MMK amounts are not accepted for card reloads.');
      err.code = 'USDT_ONLY_CARD_RELOAD';
      throw err;
    }
    if (!Number.isFinite(Number(amountUsdt)) || Number(amountUsdt) <= 0) {
      const err = new Error('Positive amount_usdt is required for card reload requests.');
      err.code = 'USDT_ONLY_CARD_RELOAD';
      throw err;
    }

    const db = getDb();
    const result = await db.run(`
      INSERT INTO ${this.TABLE} (
        user_id, card_id, wallet_type, amount_mmk, amount_usdt,
        net_usd_to_card, reload_fee_usd, gross_usd, pricing_json,
        status, deposit_id, user_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `,
      userId,
      cardId,
      walletType,
      amountMmk ?? null,
      amountUsdt ?? null,
      netUsdToCard,
      reloadFeeUsd ?? null,
      grossUsd ?? null,
      pricing ? JSON.stringify(pricing) : null,
      depositId ?? null,
      userNote ?? null
    );

    const row = await this.findById(result.lastID);
    syncCardReload(row).catch((err) => console.warn('[supabase] reload sync:', err.message));
    return row;
  },

  async listPending() {
    const db = getDb();
    return db.all(`
      SELECT r.*,
             u.name AS user_name,
             u.email AS user_email,
             c.card_number,
             c.card_holder_name,
             c.status AS card_status
      FROM ${this.TABLE} r
      JOIN users u ON u.id = r.user_id
      JOIN cards_v2 c ON c.id = r.card_id
      WHERE r.status = 'pending'
      ORDER BY r.created_at ASC
    `);
  },

  async findByUserId(userId) {
    const db = getDb();
    return db.all(`
      SELECT r.*,
             c.card_number,
             c.card_holder_name
      FROM ${this.TABLE} r
      JOIN cards_v2 c ON c.id = r.card_id
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
    `, userId);
  },

  async findPendingByDepositId(depositId) {
    const db = getDb();
    return db.get(`
      SELECT * FROM ${this.TABLE}
      WHERE deposit_id = ? AND status = 'pending'
      LIMIT 1
    `, depositId);
  },

  async updateStatus(id, status, {
    adminNote,
    rejectionReason,
    reviewedBy = 'admin',
  } = {}) {
    const db = getDb();
    await db.run(`
      UPDATE ${this.TABLE}
      SET status = ?,
          admin_note = COALESCE(?, admin_note),
          rejection_reason = COALESCE(?, rejection_reason),
          reviewed_at = datetime('now'),
          reviewed_by = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `, status, adminNote ?? null, rejectionReason ?? null, reviewedBy, id);

    const row = await this.findById(id);
    syncCardReload(row).catch((err) => console.warn('[supabase] reload sync:', err.message));
    return row;
  },

  mapForClient(row) {
    if (!row) return null;
    const pricing = parseRecordMetadata(row.pricing_json);
    const cardNumber = String(row.card_number || '').replace(/\s/g, '');
    const last4 = cardNumber.length >= 4 ? cardNumber.slice(-4) : '????';

    return {
      id: row.id,
      user_id: row.user_id,
      card_id: row.card_id,
      wallet_type: row.wallet_type,
      amount_mmk: row.amount_mmk,
      amount_usdt: row.amount_usdt,
      net_usd_to_card: row.net_usd_to_card,
      reload_fee_usd: row.reload_fee_usd,
      gross_usd: row.gross_usd,
      pricing,
      status: row.status,
      display_status: row.status === 'approved' ? 'COMPLETED' : row.status.toUpperCase(),
      deposit_id: row.deposit_id,
      user_note: row.user_note,
      admin_note: row.admin_note,
      rejection_reason: row.rejection_reason,
      reviewed_at: row.reviewed_at,
      reviewed_by: row.reviewed_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
      user_name: row.user_name,
      user_email: row.user_email,
      card_holder_name: row.card_holder_name,
      card_last4: last4,
      card_label: `**** **** **** ${last4}`,
      top_up_amount_usd: row.net_usd_to_card,
      wallet_deducted_mmk: row.wallet_type === 'mmk' ? row.amount_mmk : null,
      wallet_deducted_usdt: row.wallet_type === 'usdt' ? row.amount_usdt : null,
      wallet_deducted_display: row.wallet_type === 'usdt'
        ? `$${Number(row.amount_usdt || 0).toFixed(2)} USDT`
        : `${Number(row.amount_mmk || 0).toLocaleString()} MMK`,
      fee_profit_usd: resolveReloadNetProfit({
        pricing,
        reload_fee_usd: row.reload_fee_usd,
      }),
      user_service_fee_usd: row.reload_fee_usd,
      provider_cost_usd: pricing?.provider_cost_usd ?? null,
      net_profit_usd: resolveReloadNetProfit({
        pricing,
        reload_fee_usd: row.reload_fee_usd,
      }),
    };
  },
};

module.exports = CardReloadRequest;
