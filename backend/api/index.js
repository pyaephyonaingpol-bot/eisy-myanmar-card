/**
 * Vercel Serverless entry (Express app).
 * Root vercel.json rewrites all traffic here when the Git project root is the monorepo.
 *
 * Compatible with:
 * - GET /api/tron/wallet/address (per-user TRON HD deposit address)
 * - POST /api/deposit/create and /api/tron/orders return 410 (use the HD address)
 * - Retired card-provider webhooks return 410
 *
 * Note: This is NOT an HTTP proxy to the DigitalOcean Droplet. The Express app
 * runs in-process on Vercel. Set DATABASE_URL or TURSO_DATABASE_URL (libsql://)
 * plus TURSO_AUTH_TOKEN (or DATABASE_AUTH_TOKEN) for persistent Turso data.
 * Without those, an ephemeral /tmp file DB is used. Light paths stay up when
 * bootstrap fails so SPA /api/client-errors does not cascade.
 */
require('../src/lib/loadEnv');
const { initDb, getDb } = require('../src/db');
const { app } = require('../src/index');
const { hashPin } = require('../src/services/cryptoService');
const { scheduleDeferredServerTasks } = require('../src/serverBootstrap');
const {
  normalizePath,
  isBootstrapLightPath,
  logBootstrapFailure,
} = require('../src/lib/vercelBootstrap');

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
    scheduleDeferredServerTasks('vercel-bootstrap');

    let dbInfo = null;
    try {
      dbInfo = require('../src/lib/databaseConfig').getDatabaseInfo();
    } catch (_) { /* ignore */ }
    console.log('[vercel] Express serverless handler ready (core)', {
      env: process.env.VERCEL_ENV || process.env.NODE_ENV,
      hasBinanceKey: Boolean(process.env.BINANCE_API_KEY || process.env.BINANCE_PAY_API_KEY),
      hasBinanceSecret: Boolean(process.env.BINANCE_SECRET_KEY || process.env.BINANCE_PAY_API_SECRET),
      hasMerchantId: Boolean(process.env.BINANCE_MERCHANT_ID || process.env.BINANCE_PAY_MERCHANT_ID),
      hasAdminEmail: Boolean(String(process.env.ADMIN_EMAIL || '').trim()),
      hasAdminPassword: Boolean(String(process.env.ADMIN_PASSWORD || '').trim()),
      hasDatabaseUrl: Boolean(
        process.env.DATABASE_URL
        || process.env.TURSO_DATABASE_URL
        || process.env.LIBSQL_URL
      ),
      hasDatabaseAuthToken: Boolean(
        process.env.DATABASE_AUTH_TOKEN
        || process.env.TURSO_AUTH_TOKEN
        || process.env.LIBSQL_AUTH_TOKEN
      ),
      turso: Boolean(dbInfo?.turso),
      db_mode: dbInfo?.mode || null,
      db_persistent: dbInfo?.persistent ?? null,
      db_file: dbInfo?.filePath || null,
    });
  })().catch((err) => {
    ready = null;
    throw err;
  });

  return ready;
}

function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(Object.assign(new Error('Invalid JSON in request body'), {
          statusCode: 400,
          code: 'INVALID_JSON',
        }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Serve monitoring / client-error ingest without a ready DB so bootstrap
 * failures do not cascade into infinite SPA error reports.
 */
async function handleLightRequest(req, res) {
  const path = normalizePath(req.url || '');
  const method = String(req.method || '').toUpperCase();

  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.end();
    return true;
  }

  if (path === '/api/config/monitoring' && method === 'GET') {
    try {
      const { getPublicClientConfig } = require('../src/services/errorMonitor');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      res.end(JSON.stringify(getPublicClientConfig()));
      return true;
    } catch (err) {
      console.error('[vercel] light monitoring handler failed:', err.message);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ enabled: false, dsn: null, degraded: true }));
      return true;
    }
  }

  if (path === '/api/client-errors' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const message = String(body.message || '').trim().slice(0, 400);
      // Ack even when empty — never 5xx here during degraded bootstrap.
      if (message) {
        try {
          const { captureError } = require('../src/services/errorMonitor');
          const err = new Error(message);
          err.code = String(body.code || 'CLIENT_ERROR').slice(0, 80);
          err.status = Number(body.status) || undefined;
          // Avoid recursive "bootstrap failed while reporting bootstrap failed".
          const reportPath = String(body.path || '');
          if (
            !/bootstrap/i.test(message)
            && body.code !== 'BOOTSTRAP_FAILED'
            && !reportPath.includes('/api/client-errors')
            && !reportPath.includes('/api/config/monitoring')
          ) {
            captureError(err, {
              source: `client:${String(body.source || 'client').slice(0, 60)}`,
              title: 'Client-side error (degraded bootstrap)',
              path: reportPath.slice(0, 200) || null,
              method: body.method || null,
              status: Number(body.status) || null,
              severity: 'medium',
              tags: { kind: 'client_error_degraded' },
            });
          } else {
            console.warn('[vercel] skipped cascading client-error ingest', {
              code: body.code || null,
              path: reportPath.slice(0, 200) || null,
            });
          }
        } catch (err) {
          console.warn('[vercel] degraded client-error capture skipped:', err.message);
        }
      }
      res.statusCode = 204;
      res.end();
      return true;
    } catch (err) {
      const status = Number(err.statusCode) || 400;
      res.statusCode = status >= 400 && status < 500 ? status : 204;
      if (res.statusCode === 204) {
        res.end();
        return true;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: err.message || 'Invalid payload',
        code: err.code || 'INVALID_PAYLOAD',
      }));
      return true;
    }
  }

  if ((path === '/api/health' || path === '/health') && method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, degraded: true, service: 'vercel-bootstrap' }));
    return true;
  }

  return false;
}

function sendBootstrapFailure(res, err, diagnostics, req) {
  const path = normalizePath(req?.url || '');
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    error: 'Server bootstrap failed',
    message: diagnostics.error_message || err.message || String(err),
    code: 'BOOTSTRAP_FAILED',
    path,
    // Safe, non-secret diagnostics for operators / Vercel logs correlation
    diagnostics: {
      turso: Boolean(diagnostics.turso),
      has_database_url: diagnostics.has_database_url,
      has_database_auth_token: diagnostics.has_database_auth_token,
      db_mode: diagnostics.db_mode,
      db_persistent: diagnostics.db_persistent,
      db_file: diagnostics.db_file || null,
      db_warning: diagnostics.db_warning,
      error_code: diagnostics.error_code,
      vercel_env: diagnostics.vercel_env,
    },
  }));
}

module.exports = async (req, res) => {
  try {
    await bootstrap();
  } catch (err) {
    const diagnostics = logBootstrapFailure(err, req);
    const light = isBootstrapLightPath(req.url);

    // Alert only for real API traffic — SPA polling /monitoring + client-errors
    // during an outage must not Telegram-storm.
    if (!light) {
      try {
        const { captureError } = require('../src/services/errorMonitor');
        captureError(err, {
          source: 'vercel',
          title: 'Vercel bootstrap failed',
          severity: 'critical',
          path: normalizePath(req.url || '/api'),
          tags: { kind: 'vercel_bootstrap' },
          extra: {
            turso: Boolean(diagnostics.turso),
            has_database_url: diagnostics.has_database_url,
            has_database_auth_token: diagnostics.has_database_auth_token,
            db_mode: diagnostics.db_mode,
            db_persistent: diagnostics.db_persistent,
            error_code: diagnostics.error_code,
          },
        });
      } catch (_) { /* ignore */ }
    }

    if (light && await handleLightRequest(req, res)) {
      return;
    }

    sendBootstrapFailure(res, err, diagnostics, req);
    return;
  }

  return app(req, res);
};

module.exports._test = {
  isBootstrapLightPath,
  handleLightRequest,
  bootstrap,
};
