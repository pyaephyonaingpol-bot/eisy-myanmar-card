require('dotenv').config();
const { initDb, getDb } = require('./db');
const { hashPin, normalizeEmail } = require('./services/cryptoService');

async function seed() {
  await initDb();
  const db = getDb();

  const demoEmail = 'demo@eisy.myanmar';
  let demoUser = await db.get('SELECT id FROM users WHERE email = ?', demoEmail);

  if (!demoUser) {
    demoUser = await db.get('SELECT id FROM users WHERE phone = ?', '+959123456789');
  }

  const pinHash = hashPin('123456');

  if (!demoUser) {
    const result = await db.run(`
      INSERT INTO users (name, phone, email, email_verified, pin_hash, pin_set_at, balance, updated_at)
      VALUES (?, ?, ?, 1, ?, datetime('now'), 25.00, datetime('now'))
    `, 'Demo User', '+959123456789', demoEmail, pinHash);

    const userId = result.lastID;

    await db.run(`
      INSERT INTO cards (user_id, card_number, exp_date, cvv, card_holder_name)
      VALUES (?, ?, ?, ?, ?)
    `, userId, '4532 8765 4321 0987', '12/28', '456', 'DEMO USER');

    console.log(`Created demo user id=${userId}`);
    console.log(`  Email: ${demoEmail}`);
    console.log(`  PIN:   123456`);
  } else {
    await db.run(`
      UPDATE users SET email = ?, email_verified = 1, pin_hash = ?, pin_set_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `, demoEmail, pinHash, demoUser.id);
    console.log(`Demo user updated id=${demoUser.id}`);
    console.log(`  Email: ${demoEmail}`);
    console.log(`  PIN:   123456`);
  }

  console.log('Eisy Myanmar — Seed complete.');
}

async function runSeed() {
  await seed();
}

if (require.main === module) {
  runSeed().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}

module.exports = { seed, runSeed };
