/**
 * Vercel Serverless entry (Express app).
 * Root vercel.json rewrites all traffic here when the Git project root is the monorepo.
 *
 * Compatible with:
 * - POST /api/deposit/create (Binance Pay + fee Math.max(amount*0.02, 1))
 * - POST /api/webhook/binance (PAY_SUCCESS → credit net USDT)
 */
const { initDb, getDb } = require('../src/db');
const { app } = require('../src/index');
const { hashPin } = require('../src/services/cryptoService');

let ready;

async function ensureDemoUser() {
  // Only seed empty DBs in non-production / ephemeral local testing
  if (process.env.VERCEL_ENV === 'production' && process.env.SEED_DEMO_USER !== 'true') {
    return;
  }

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
    console.log('[vercel] Express serverless handler ready', {
      env: process.env.VERCEL_ENV || process.env.NODE_ENV,
      hasBinanceKey: Boolean(process.env.BINANCE_API_KEY || process.env.BINANCE_PAY_API_KEY),
      hasBinanceSecret: Boolean(process.env.BINANCE_SECRET_KEY || process.env.BINANCE_PAY_API_SECRET),
      hasMerchantId: Boolean(process.env.BINANCE_MERCHANT_ID || process.env.BINANCE_PAY_MERCHANT_ID),
    });
  })().catch((err) => {
    ready = null;
    throw err;
  });

  return ready;
}

module.exports = async (req, res) => {
  try {
    await bootstrap();
  } catch (err) {
    console.error('[vercel] bootstrap failed:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'Server bootstrap failed',
      message: err.message || String(err),
    }));
    return;
  }

  return app(req, res);
};
