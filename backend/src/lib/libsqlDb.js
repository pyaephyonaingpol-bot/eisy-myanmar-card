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

function createLibsqlDb(client) {
  const adapter = {
    isLibsql: true,
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
      const result = await client.execute({ sql, args: params });
      return {
        lastID: Number(result.lastInsertRowid ?? 0),
        changes: Number(result.rowsAffected ?? 0),
      };
    },

    async exec(sql) {
      const trimmed = String(sql || '').trim();
      if (!trimmed) return;

      if (trimmed.includes(';') && trimmed.split(';').filter((part) => part.trim()).length > 1) {
        await client.executeMultiple(sql);
        return;
      }

      await client.execute(sql);
    },
  };

  return adapter;
}

module.exports = { createLibsqlDb };
