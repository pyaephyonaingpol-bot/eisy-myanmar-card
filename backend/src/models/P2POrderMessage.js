const { getDb } = require('../db');

const P2POrderMessage = {
  TABLE: 'p2p_order_messages',

  async listForOrder(orderType, orderId, { limit = 100 } = {}) {
    const db = getDb();
    return db.all(
      `SELECT * FROM ${this.TABLE}
       WHERE order_type = ? AND order_id = ?
       ORDER BY created_at ASC
       LIMIT ?`,
      orderType,
      orderId,
      limit
    );
  },

  async create({
    orderType,
    orderId,
    senderRole,
    senderUserId,
    message,
    attachmentPath,
    txRef,
  }) {
    const db = getDb();
    const result = await db.run(
      `INSERT INTO ${this.TABLE} (
        order_type, order_id, sender_role, sender_user_id,
        message, attachment_path, tx_ref
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      orderType,
      orderId,
      senderRole,
      senderUserId ?? null,
      message || null,
      attachmentPath || null,
      txRef || null
    );
    return db.get(`SELECT * FROM ${this.TABLE} WHERE id = ?`, result.lastID);
  },

  mapForClient(row, { userName } = {}) {
    if (!row) return null;
    return {
      id: row.id,
      order_type: row.order_type,
      order_id: row.order_id,
      sender_role: row.sender_role,
      sender_user_id: row.sender_user_id,
      sender_name: userName || (row.sender_role === 'admin' ? 'Admin' : row.sender_role === 'system' ? 'System' : 'You'),
      message: row.message,
      attachment_path: row.attachment_path,
      tx_ref: row.tx_ref,
      created_at: row.created_at,
    };
  },
};

module.exports = P2POrderMessage;
