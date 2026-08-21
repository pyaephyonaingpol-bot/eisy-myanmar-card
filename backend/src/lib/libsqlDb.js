/**
 * Wrap @libsql/client with the subset of the sqlite package API used by this app.
 */
function normalizeRow(row, columns) {
  if (!row || typeof row !== 'object') return row;
  if (!Array.isArray(row) && !columns?.length) return row;

  const out = {};
  if (Array.isArray(row) && columns?.length) {
    columns.forEach((col, idx) => {
      out[col] = row[idx];
    });
    return out;
  }

  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === 'bigint' ? Number(value) : value;
  }
  return out;
}

function resultSetToRun(result) {
  return {
    lastID: Number(result.lastInsertRowid ?? 0),
    changes: Number(result.rowsAffected ?? 0),
  };
}

function trackTransactionCommand(txDepthRef, sql, { failed = false } = {}) {
  const cmd = String(sql || '').trim().split(/\s+/)[0]?.toUpperCase();
  if (cmd === 'BEGIN') {
    if (!failed) txDepthRef.depth += 1;
  } else if (cmd === 'COMMIT' || cmd === 'ROLLBACK') {
    // Always clear local depth for txn control — LibSQL may already have
    // aborted the transaction, so ROLLBACK can fail with "no transaction is active".
    txDepthRef.depth = Math.max(0, txDepthRef.depth - 1);
  }
}

function createLibsqlDb(client) {
  const txDepthRef = { depth: 0 };

  const adapter = {
    isLibsql: true,
    client,

    isInTransaction() {
      return txDepthRef.depth > 0;
    },

    async safeRollback() {
      if (txDepthRef.depth <= 0) return;
      try {
        await client.execute('ROLLBACK');
      } catch (err) {
        const msg = String(err?.message || err || '');
        if (!/no transaction is active/i.test(msg) && !/cannot rollback/i.test(msg)) {
          throw err;
        }
      } finally {
        txDepthRef.depth = 0;
      }
    },

    async get(sql, ...params) {
      const result = await client.execute({ sql, args: params });
      if (!result.rows?.length) return undefined;
      return normalizeRow(result.rows[0], result.columns);
    },

    async all(sql, ...params) {
      const result = await client.execute({ sql, args: params });
      return (result.rows || []).map((row) => normalizeRow(row, result.columns));
    },

    async run(sql, ...params) {
      try {
        const result = await client.execute({ sql, args: params });
        trackTransactionCommand(txDepthRef, sql);
        return resultSetToRun(result);
      } catch (err) {
        trackTransactionCommand(txDepthRef, sql, { failed: true });
        throw err;
      }
    },

    async exec(sql) {
      const trimmed = String(sql || '').trim();
      if (!trimmed) return;

      if (trimmed.includes(';') && trimmed.split(';').filter((part) => part.trim()).length > 1) {
        await client.executeMultiple(sql);
        return;
      }

      try {
        await client.execute(sql);
        trackTransactionCommand(txDepthRef, trimmed);
      } catch (err) {
        trackTransactionCommand(txDepthRef, trimmed, { failed: true });
        throw err;
      }
    },
  };

  return adapter;
}

module.exports = { createLibsqlDb };
