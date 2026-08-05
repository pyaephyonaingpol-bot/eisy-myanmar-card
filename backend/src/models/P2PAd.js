const { getDb } = require('../db');

const P2PAd = {
  TABLE: 'p2p_ads',

  async findById(id) {
    const db = getDb();
    return db.get(`SELECT * FROM ${this.TABLE} WHERE id = ?`, id);
  },

  async findByUserId(userId, { limit = 50 } = {}) {
    const db = getDb();
    return db.all(
      `SELECT * FROM ${this.TABLE} WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      userId, limit
    );
  },

  async listActive({ side, network } = {}) {
    const db = getDb();
    const clauses = ["status = 'active'", 'available_volume_usdt > 0'];
    const params = [];

    if (side) {
      clauses.push('side = ?');
      params.push(side === 'buy' ? 'buy' : 'sell');
    }
    if (network) {
      clauses.push('network = ?');
      params.push(String(network).toUpperCase());
    }

    return db.all(`
      SELECT * FROM ${this.TABLE}
      WHERE ${clauses.join(' AND ')}
      ORDER BY price_mmk_per_usdt ASC
    `, ...params);
  },

  async create({
    userId,
    side,
    network = 'TRC20',
    priceMmkPerUsdt,
    totalVolumeUsdt,
    availableVolumeUsdt,
    minOrderUsdt = 5,
    maxOrderUsdt = 1000,
    paymentMethods,
    paymentAccounts,
    escrowLockedUsdt = 0,
  }) {
    const db = getDb();
    const methodsJson = Array.isArray(paymentMethods)
      ? JSON.stringify(paymentMethods)
      : (paymentMethods || '["KPay","WavePay"]');
    const accountsJson = paymentAccounts
      ? (typeof paymentAccounts === 'string' ? paymentAccounts : JSON.stringify(paymentAccounts))
      : null;

    const result = await db.run(`
      INSERT INTO ${this.TABLE} (
        user_id, side, network, price_mmk_per_usdt,
        total_volume_usdt, available_volume_usdt,
        min_order_usdt, max_order_usdt,
        payment_methods, payment_accounts, escrow_locked_usdt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      userId,
      side === 'buy' ? 'buy' : 'sell',
      String(network || 'TRC20').toUpperCase(),
      priceMmkPerUsdt,
      totalVolumeUsdt,
      availableVolumeUsdt,
      minOrderUsdt,
      maxOrderUsdt,
      methodsJson,
      accountsJson,
      escrowLockedUsdt
    );
    return this.findById(result.lastID);
  },

  async updateStatus(id, status) {
    const db = getDb();
    await db.run(`
      UPDATE ${this.TABLE}
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `, status, id);
    return this.findById(id);
  },

  async reserveVolume(id, amountUsdt) {
    const db = getDb();
    const amount = Number(amountUsdt);
    const result = await db.run(`
      UPDATE ${this.TABLE}
      SET available_volume_usdt = available_volume_usdt - ?,
          updated_at = datetime('now')
      WHERE id = ?
        AND status = 'active'
        AND available_volume_usdt >= ?
    `, amount, id, amount);
    if (!result.changes) {
      throw new Error('Insufficient ad volume available');
    }
    return this.findById(id);
  },

  async restoreVolume(id, amountUsdt) {
    const db = getDb();
    const amount = Number(amountUsdt);
    await db.run(`
      UPDATE ${this.TABLE}
      SET available_volume_usdt = MIN(total_volume_usdt, available_volume_usdt + ?),
          updated_at = datetime('now')
      WHERE id = ?
    `, amount, id);
    return this.findById(id);
  },

  async consumeEscrow(id, amountUsdt) {
    const db = getDb();
    const amount = Number(amountUsdt);
    await db.run(`
      UPDATE ${this.TABLE}
      SET escrow_locked_usdt = MAX(0, escrow_locked_usdt - ?),
          updated_at = datetime('now')
      WHERE id = ?
    `, amount, id);
    const ad = await this.findById(id);
    if (ad && Number(ad.escrow_locked_usdt) <= 0.001 && Number(ad.available_volume_usdt) <= 0.001) {
      await this.updateStatus(id, 'closed');
    }
    return ad;
  },

  async clearEscrow(id) {
    const db = getDb();
    await db.run(`
      UPDATE ${this.TABLE}
      SET escrow_locked_usdt = 0,
          updated_at = datetime('now')
      WHERE id = ?
    `, id);
    return this.findById(id);
  },

  async countPendingBuyOrders(adId) {
    const db = getDb();
    const row = await db.get(`
      SELECT COUNT(*) AS cnt FROM p2p_buy_orders
      WHERE ad_id = ? AND status IN ('pending_payment', 'pending_seller_release')
    `, adId);
    return Number(row?.cnt || 0);
  },

  async countPendingSellOrders(adId) {
    const db = getDb();
    const row = await db.get(`
      SELECT COUNT(*) AS cnt FROM p2p_sell_orders
      WHERE ad_id = ? AND status = 'pending_merchant_mmk'
    `, adId);
    return Number(row?.cnt || 0);
  },

  mapForClient(row, { user } = {}) {
    if (!row) return null;
    let paymentMethods = [];
    let paymentAccounts = {};
    try {
      paymentMethods = row.payment_methods ? JSON.parse(row.payment_methods) : [];
    } catch (_) { /* ignore */ }
    try {
      paymentAccounts = row.payment_accounts ? JSON.parse(row.payment_accounts) : {};
    } catch (_) { /* ignore */ }

    const priceMmk = Number(row.price_mmk_per_usdt);
    const available = Number(row.available_volume_usdt || 0);

    return {
      id: row.id,
      user_id: row.user_id,
      user_name: user?.name || null,
      is_kyc_verified: (user?.kyc_status || '').toUpperCase() === 'VERIFIED',
      side: row.side,
      network: row.network,
      price_mmk_per_usdt: priceMmk,
      price_mmk_formatted: `${Math.round(priceMmk).toLocaleString()} MMK`,
      total_volume_usdt: Number(row.total_volume_usdt),
      available_volume_usdt: available,
      min_order_usdt: Number(row.min_order_usdt),
      max_order_usdt: Number(row.max_order_usdt),
      min_deposit: Number(row.min_order_usdt),
      max_deposit: Number(row.max_order_usdt),
      limits_formatted: `$${Number(row.min_order_usdt).toFixed(2)} – $${Number(row.max_order_usdt).toFixed(2)} USDT`,
      payment_methods: paymentMethods,
      payment_accounts: paymentAccounts,
      status: row.status,
      escrow_locked_usdt: Number(row.escrow_locked_usdt || 0),
      liquidity_formatted: `${available.toFixed(2)} USDT available`,
      source: 'user_ad',
      name: user?.name || `User #${row.user_id}`,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  },
};

module.exports = P2PAd;
