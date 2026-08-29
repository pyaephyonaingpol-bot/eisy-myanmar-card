const { getDb } = require('../db');

const SUPPORTED_NETWORKS = ['TRC20', 'BEP20', 'ERC20'];

const UserUsdtWalletAddress = {
  TABLE: 'user_usdt_wallet_addresses',

  async findByUserId(userId) {
    const db = getDb();
    return db.all(
      `SELECT * FROM ${this.TABLE} WHERE user_id = ? ORDER BY network ASC, address_type ASC, created_at ASC`,
      userId
    );
  },

  async findById(id) {
    const db = getDb();
    return db.get(`SELECT * FROM ${this.TABLE} WHERE id = ?`, id);
  },

  async findCustodial(userId, network) {
    const db = getDb();
    return db.get(
      `SELECT * FROM ${this.TABLE} WHERE user_id = ? AND network = ? AND address_type = 'custodial' LIMIT 1`,
      userId,
      network
    );
  },

  async findCustodialByAddress(address) {
    const db = getDb();
    const addr = String(address || '').trim();
    if (!addr) return null;
    return db.get(
      `SELECT * FROM ${this.TABLE}
       WHERE address = ? AND network = 'TRC20' AND address_type = 'custodial'
       LIMIT 1`,
      addr
    );
  },

  async findLinkedByAddress(userId, network, address) {
    const db = getDb();
    return db.get(
      `SELECT * FROM ${this.TABLE}
       WHERE user_id = ? AND network = ? AND address_type = 'linked' AND address = ? LIMIT 1`,
      userId,
      network,
      address
    );
  },

  async create({
    userId,
    network,
    address,
    addressType = 'custodial',
    depositReference = null,
    label = null,
    isPrimary = 1,
    derivationIndex = null,
    derivationPath = null,
  }) {
    const db = getDb();
    const result = await db.run(`
      INSERT INTO ${this.TABLE} (
        user_id, network, address, address_type, deposit_reference, label, is_primary,
        derivation_index, derivation_path, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
    userId,
    network,
    address,
    addressType,
    depositReference,
    label,
    isPrimary ? 1 : 0,
    derivationIndex,
    derivationPath);
    return this.findById(result.lastID);
  },

  async updateCustodialTrc20(userId, {
    address,
    derivationIndex = null,
    derivationPath = null,
    depositReference = null,
    label = null,
  }) {
    const db = getDb();
    await db.run(`
      UPDATE ${this.TABLE}
      SET address = ?,
          derivation_index = ?,
          derivation_path = ?,
          deposit_reference = COALESCE(?, deposit_reference),
          label = COALESCE(?, label),
          updated_at = datetime('now')
      WHERE user_id = ? AND network = 'TRC20' AND address_type = 'custodial'
    `,
    address,
    derivationIndex,
    derivationPath,
    depositReference,
    label,
    userId);
    return this.findCustodial(userId, 'TRC20');
  },

  async deleteLinked(id, userId) {
    const db = getDb();
    const row = await db.get(
      `SELECT * FROM ${this.TABLE} WHERE id = ? AND user_id = ? AND address_type = 'linked'`,
      id,
      userId
    );
    if (!row) return null;
    await db.run(`DELETE FROM ${this.TABLE} WHERE id = ?`, id);
    return row;
  },
};

module.exports = { UserUsdtWalletAddress, SUPPORTED_NETWORKS };
