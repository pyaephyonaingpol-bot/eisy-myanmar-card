const { initDb, getDb } = require('../src/db');
const { app } = require('../src/index');
const { hashPin } = require('../src/services/cryptoService');

let ready;

async function ensureDemoUser() {
  const db = getDb();
  const countRow = await db.get('SELECT COUNT(*) AS c FROM users');
  if (Number(countRow?.c) > 0) return;

  const demoEmail = 'demo@eisy.myanmar';
  const pinHash = hashPin('123456');
  const result = await db.run(`
    INSERT INTO users (name, phone, email, email_verified, pin_hash, pin_set_at, balance, updated_at)
    VALUES (?, ?, ?, 1, ?, datetime('now'), 25.00, datetime('now'))
  `, 'Demo User', '+959123456789', demoEmail, pinHash);

  await db.run(`
    INSERT INTO cards (user_id, card_number, exp_date, cvv, card_holder_name)
    VALUES (?, ?, ?, ?, ?)
  `, result.lastID, '4532 8765 4321 0987', '12/28', '456', 'DEMO USER');

  console.log('[vercel] Seeded demo user for empty serverless database');
}

async function bootstrap() {
  if (ready) return ready;

  ready = (async () => {
    await initDb();
    await ensureDemoUser();
  })();

  return ready;
}

module.exports = async (req, res) => {
  await bootstrap();
  return app(req, res);
};
