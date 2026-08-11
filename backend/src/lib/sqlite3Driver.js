/**
 * Optional legacy native sqlite3 driver (local only).
 *
 * Not used on Vercel. Kept behind a dynamic load so serverless bundlers
 * do not try to package the native `sqlite3` addon.
 *
 * Enable with: SQLITE_DRIVER=sqlite3
 * Requires: npm install sqlite3 sqlite --prefix backend
 */

async function openSqliteFile(filePath) {
  let sqlite3;
  let open;
  try {
    // Dynamic names — avoid static analysis pulling native addon into Vercel bundles.
    const nativeId = ['sql', 'ite', '3'].join('');
    const wrapperId = 'sql' + 'ite';
    sqlite3 = require(nativeId);
    ({ open } = require(wrapperId));
  } catch (err) {
    const wrapped = new Error(
      "Native sqlite3 is not installed. For Vercel/serverless use LibSQL "
      + '(default) or set DATABASE_URL to a Turso libsql:// URL. '
      + 'For local sqlite3: npm install sqlite3 sqlite --prefix backend && SQLITE_DRIVER=sqlite3. '
      + `Original: ${err.message}`
    );
    wrapped.code = 'SQLITE3_MISSING';
    wrapped.cause = err;
    throw wrapped;
  }

  return open({
    filename: filePath,
    driver: sqlite3.Database,
  });
}

module.exports = { openSqliteFile };
