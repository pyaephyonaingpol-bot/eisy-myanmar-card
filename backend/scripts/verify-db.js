const { initDb, getDb } = require('../src/db');

initDb()
  .then(async () => {
    const db = getDb();
    const otp = await db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='otp_codes'"
    );
    const migrations = await db.all('SELECT name FROM schema_migrations ORDER BY name');
    console.log('otp_codes:', otp ? 'OK' : 'MISSING');
    console.log('migrations:', migrations.map((m) => m.name).join(', ') || '(none)');
    process.exit(otp ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
