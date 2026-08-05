const { getDb } = require('../db');

const P2PSeller = {
  TABLE: 'p2p_sellers',

  async findById(id) {
    const db = getDb();
    return db.get(`SELECT * FROM ${this.TABLE} WHERE id = ?`, id);
  },

  async listActive({ network, side } = {}) {
    const db = getDb();
    const clauses = ["status = 'active'", 'is_online = 1'];
    const params = [];

    if (network) {
      clauses.push('network = ?');
      params.push(String(network).toUpperCase());
    }
    if (side) {
      clauses.push('side = ?');
      params.push(side === 'buy' ? 'buy' : 'sell');
    }

    return db.all(`
      SELECT * FROM ${this.TABLE}
      WHERE ${clauses.join(' AND ')}
      ORDER BY name ASC
    `, ...params);
  },

  async listAll() {
    const db = getDb();
    return db.all(`SELECT * FROM ${this.TABLE} ORDER BY status DESC, name ASC`);
  },

  async create({
    name,
    network,
    walletAddress,
    status = 'active',
    qrCodeUrl,
    minDeposit = 5,
    maxDeposit = 10000,
    priceMmkPerUsdt,
    paymentMethods,
    side = 'sell',
    paymentAccounts,
  }) {
    const db = getDb();
    const net = String(network || 'TRC20').toUpperCase();
    const methodsJson = paymentMethods
      ? (Array.isArray(paymentMethods) ? JSON.stringify(paymentMethods) : paymentMethods)
      : '["KPay","WavePay","Bank Transfer"]';
    const accountsJson = paymentAccounts
      ? (typeof paymentAccounts === 'string' ? paymentAccounts : JSON.stringify(paymentAccounts))
      : null;

    const result = await db.run(`
      INSERT INTO ${this.TABLE} (
        name, network, wallet_address, status, qr_code_url,
        min_deposit, max_deposit, price_mmk_per_usdt, payment_methods, side, payment_accounts,
        is_online, escrow_balance_usdt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      name,
      net,
      walletAddress,
      status,
      qrCodeUrl || null,
      minDeposit,
      maxDeposit,
      priceMmkPerUsdt ?? null,
      methodsJson,
      side === 'buy' ? 'buy' : 'sell',
      accountsJson,
      1,
      0
    );
    return this.findById(result.lastID);
  },

  async update(id, fields) {
    const db = getDb();
    const existing = await this.findById(id);
    if (!existing) return null;

    const name = fields.name ?? existing.name;
    const network = String(fields.network ?? existing.network).toUpperCase();
    const walletAddress = fields.wallet_address ?? fields.walletAddress ?? existing.wallet_address;
    const status = fields.status ?? existing.status;
    const qrCodeUrl = fields.qr_code_url ?? fields.qrCodeUrl ?? existing.qr_code_url;
    const minDeposit = fields.min_deposit ?? fields.minDeposit ?? existing.min_deposit;
    const maxDeposit = fields.max_deposit ?? fields.maxDeposit ?? existing.max_deposit;
    const priceMmk = fields.price_mmk_per_usdt ?? fields.priceMmkPerUsdt ?? existing.price_mmk_per_usdt;
    const side = fields.side ?? existing.side ?? 'sell';
    const isOnline = fields.is_online != null
      ? (fields.is_online === true || fields.is_online === 1 || fields.is_online === '1' ? 1 : 0)
      : (existing.is_online != null ? existing.is_online : 1);
    const escrowBalance = fields.escrow_balance_usdt != null
      ? Number(fields.escrow_balance_usdt)
      : (existing.escrow_balance_usdt ?? 0);
    let paymentMethods = existing.payment_methods;
    if (fields.payment_methods != null) {
      paymentMethods = Array.isArray(fields.payment_methods)
        ? JSON.stringify(fields.payment_methods)
        : fields.payment_methods;
    } else if (fields.paymentMethods != null) {
      paymentMethods = Array.isArray(fields.paymentMethods)
        ? JSON.stringify(fields.paymentMethods)
        : fields.paymentMethods;
    }
    let paymentAccounts = existing.payment_accounts;
    if (fields.payment_accounts != null) {
      paymentAccounts = typeof fields.payment_accounts === 'string'
        ? fields.payment_accounts
        : JSON.stringify(fields.payment_accounts);
    } else if (fields.paymentAccounts != null) {
      paymentAccounts = typeof fields.paymentAccounts === 'string'
        ? fields.paymentAccounts
        : JSON.stringify(fields.paymentAccounts);
    }

    await db.run(`
      UPDATE ${this.TABLE}
      SET name = ?, network = ?, wallet_address = ?, status = ?,
          qr_code_url = ?, min_deposit = ?, max_deposit = ?,
          price_mmk_per_usdt = ?, payment_methods = ?, side = ?,
          payment_accounts = ?, is_online = ?, escrow_balance_usdt = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `, name, network, walletAddress, status, qrCodeUrl, minDeposit, maxDeposit,
      priceMmk, paymentMethods, side === 'buy' ? 'buy' : 'sell', paymentAccounts,
      isOnline, escrowBalance, id);

    return this.findById(id);
  },

  async adjustEscrowBalance(id, delta) {
    const db = getDb();
    const d = Number(delta);
    await db.run(`
      UPDATE ${this.TABLE}
      SET escrow_balance_usdt = CASE
            WHEN COALESCE(escrow_balance_usdt, 0) + ? < 0 THEN 0
            ELSE COALESCE(escrow_balance_usdt, 0) + ?
          END,
          updated_at = datetime('now')
      WHERE id = ?
    `, d, d, id);
    return this.findById(id);
  },

  async setEscrowBalance(id, amount) {
    const db = getDb();
    await db.run(`
      UPDATE ${this.TABLE}
      SET escrow_balance_usdt = ?, updated_at = datetime('now')
      WHERE id = ?
    `, Math.max(0, Number(amount)), id);
    return this.findById(id);
  },

  mapForClient(row, { escrow } = {}) {
    if (!row) return null;
    let paymentMethods = [];
    try {
      paymentMethods = JSON.parse(row.payment_methods || '[]');
    } catch (_) {
      paymentMethods = ['KPay', 'WavePay'];
    }
    let paymentAccounts = {};
    try {
      paymentAccounts = row.payment_accounts ? JSON.parse(row.payment_accounts) : {};
    } catch (_) {
      paymentAccounts = {};
    }
    const balance = Number(row.escrow_balance_usdt || 0);
    const reserved = escrow?.reserved ?? null;
    const available = escrow?.available ?? balance;
    return {
      id: row.id,
      name: row.name,
      network: row.network,
      wallet_address: row.wallet_address,
      status: row.status,
      qr_code_url: row.qr_code_url,
      min_deposit: Number(row.min_deposit),
      max_deposit: Number(row.max_deposit),
      price_mmk_per_usdt: row.price_mmk_per_usdt != null ? Number(row.price_mmk_per_usdt) : null,
      payment_methods: paymentMethods,
      payment_accounts: paymentAccounts,
      side: row.side || 'sell',
      is_online: row.is_online == null ? true : Boolean(row.is_online),
      escrow_balance_usdt: balance,
      escrow_reserved_usdt: reserved,
      escrow_available_usdt: available,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  },
};

module.exports = P2PSeller;
