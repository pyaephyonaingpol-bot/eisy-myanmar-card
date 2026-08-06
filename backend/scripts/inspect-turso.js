require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { initDb, getDb, closeDb } = require('../src/db');
const fs = require('fs');
const path = require('path');

(async () => {
  await initDb();
  const db = getDb();
  const applied = await db.all('SELECT name FROM schema_migrations ORDER BY name');
  console.log('Applied migrations:', applied.length);
  applied.forEach((r) => console.log(' -', r.name));

  const files = fs
    .readdirSync(path.join(__dirname, '..', 'migrations'))
    .filter((f) => /^\d{3}_.+\.sql$/.test(f) && !f.startsWith('000_'))
    .sort();

  const appliedSet = new Set(applied.map((r) => r.name));
  const pending = files.filter((f) => !appliedSet.has(f));
  console.log('\nPending migrations:', pending.length);
  pending.forEach((f) => console.log(' -', f));

  await closeDb();
})().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
