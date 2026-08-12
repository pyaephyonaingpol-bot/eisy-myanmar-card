/**
 * Wrap @libsql/client with the subset of the sqlite package API used by this app.
 *
 * IMPORTANT: Remote Turso / LibSQL does NOT keep `BEGIN` open across separate
 * `client.execute()` HTTP calls. Use `withTransaction()` (interactive) or
 * `batchWrite()` for multi-statement atomic work — never rely on `db.run('BEGIN')`.
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

function isNoActiveTransactionError(err) {
  const msg = String(err?.message || err || '');
  return /no transaction is active/i.test(msg)
    || /cannot rollback/i.test(msg)
    || /cannot commit/i.test(msg);
}

function createQueryApi(executor) {
  return {
    async get(sql, ...params) {
      const result = await executor.execute({ sql, args: params });
      if (!result.rows?.length) return undefined;
      return normalizeRow(result.rows[0], result.columns);
    },

    async all(sql, ...params) {
      const result = await executor.execute({ sql, args: params });
      return (result.rows || []).map((row) => normalizeRow(row, result.columns));
    },

    async run(sql, ...params) {
      const result = await executor.execute({ sql, args: params });
      return {
        lastID: Number(result.lastInsertRowid ?? 0),
        changes: Number(result.rowsAffected ?? 0),
      };
    },

    async exec(sql) {
      const trimmed = String(sql || '').trim();
      if (!trimmed) return;

      if (typeof executor.executeMultiple === 'function'
        && trimmed.includes(';')
        && trimmed.split(';').filter((part) => part.trim()).length > 1) {
        await executor.executeMultiple(sql);
        return;
      }

      await executor.execute(sql);
    },
  };
}

function createLibsqlDb(client) {
  const adapter = {
    isLibsql: true,
    _client: client,
    ...createQueryApi(client),

    /**
     * Atomic multi-statement write via LibSQL HTTP batch (preferred on Turso/Vercel).
     * @param {Array<{ sql: string, args?: any[] }>} statements
     */
    async batchWrite(statements) {
      if (typeof client.batch !== 'function') {
        for (const stmt of statements) {
          await client.execute({
            sql: stmt.sql,
            args: stmt.args || [],
          });
        }
        return;
      }
      await client.batch(
        statements.map((stmt) => ({
          sql: stmt.sql,
          args: stmt.args || [],
        })),
        'write'
      );
    },

    /**
     * Run `fn(txDb)` inside a LibSQL interactive write transaction.
     * Rollback is only attempted when a transaction was started and not committed.
     */
    async withTransaction(fn) {
      if (typeof client.transaction !== 'function') {
        return runBeginCommitTransaction(adapter, fn);
      }

      let tx = null;
      let committed = false;
      try {
        tx = await client.transaction('write');
        const txDb = {
          isLibsql: true,
          isTransaction: true,
          ...createQueryApi(tx),
        };
        const result = await fn(txDb);
        await tx.commit();
        committed = true;
        return result;
      } catch (err) {
        if (tx && !committed) {
          try {
            await tx.rollback();
          } catch (rollbackErr) {
            if (!isNoActiveTransactionError(rollbackErr)) {
              console.warn('[db] transaction rollback failed:', rollbackErr.message);
            }
          }
        }
        throw err;
      }
    },
  };

  return adapter;
}

async function runBeginCommitTransaction(db, fn) {
  let started = false;
  try {
    await db.run('BEGIN');
    started = true;
    const result = await fn(db);
    await db.run('COMMIT');
    started = false;
    return result;
  } catch (err) {
    if (started) {
      try {
        await db.run('ROLLBACK');
      } catch (rollbackErr) {
        if (!isNoActiveTransactionError(rollbackErr)) {
          console.warn('[db] ROLLBACK failed:', rollbackErr.message);
        }
      }
    }
    throw err;
  }
}

async function withDbTransaction(db, fn) {
  if (db && typeof db.withTransaction === 'function') {
    return db.withTransaction(fn);
  }
  return runBeginCommitTransaction(db, fn);
}

module.exports = {
  createLibsqlDb,
  withDbTransaction,
  isNoActiveTransactionError,
  runBeginCommitTransaction,
};
