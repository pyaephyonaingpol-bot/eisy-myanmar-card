require('./lib/loadEnv');
const path = require('path');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { getUploadRoot } = require('./paths');
const { createCorsOptions } = require('./corsOptions');
const { initDb, closeDb } = require('./db');

const depositRoutes = require('./routes/deposit');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');
const authRoutes = require('./routes/auth');
const supportRoutes = require('./routes/support');
const { requireAuth, requireSensitive } = require('./middleware/auth');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UPLOAD_DIR = getUploadRoot();
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');

app.use(cors(createCorsOptions()));
app.options('*', cors(createCorsOptions()));
app.use(express.json({
  limit: '55mb',
  verify: (req, res, buf) => {
    // Preserve raw body for webhook signature verification
    if (
      req.originalUrl
      && (
        req.originalUrl.startsWith('/api/webhook/')
      )
    ) {
      req.rawBody = buf.toString('utf8');
    }
  },
}));
app.use(express.urlencoded({ extended: true, limit: '55mb' }));

app.get('/', (_req, res) => {
  if (!fs.existsSync(INDEX_HTML)) {
    return res.status(500).send(`Dashboard missing. Expected: ${INDEX_HTML}`);
  }
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(INDEX_HTML);
});

app.get('/dashboard', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(INDEX_HTML);
});

app.get('/admin', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.use(express.static(PUBLIC_DIR, {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (/\.(html)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    } else if (/\.(webmanifest|json)$/i.test(filePath) && /manifest/i.test(filePath)) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (/\.(js|css)$/i.test(filePath)) {
      // Versioned via ?v= query in HTML — always revalidate so deploys apply quickly
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));
app.use('/uploads', express.static(UPLOAD_DIR));

app.get('/health', async (_req, res) => {
  const { getDatabaseInfo, getDb } = require('./db');
  const { getSecurityStatus } = require('./services/securityFlags');
  const payload = {
    status: 'ok',
    service: 'Eisy Myanmar Backend',
    timestamp: new Date().toISOString(),
    database: getDatabaseInfo(),
    security: getSecurityStatus(),
  };
  // Best-effort Turso user count so ops can verify the admin list source-of-truth
  // size after deploy without a local DATABASE_AUTH_TOKEN.
  try {
    const db = getDb();
    const row = await db.get('SELECT COUNT(*) AS c FROM users');
    payload.users = { turso: Number(row?.c || 0) };
  } catch (err) {
    payload.users = { turso: null, error: err.message || 'count_failed' };
  }
  res.json(payload);
});

/**
 * Safe TRON master-wallet readiness probe (no private key, truncated address only).
 * Used to verify Vercel env wiring after key rotation.
 */
app.get('/health/tron', async (_req, res) => {
  const { envIsSet, firstEnv } = require('./lib/envAliases');
  const {
    getMasterWalletAddress,
    getMasterWalletInfo,
    checkMasterWalletAddressConsistency,
  } = require('./services/tronMasterWalletService');

  const env = {
    MASTER_PRIVATE_KEY: envIsSet(
      'MASTER_PRIVATE_KEY',
      'MASTER_WALLET_PRIVATE_KEY',
      'TRON_MASTER_PRIVATE_KEY'
    ),
    TRON_MASTER_WALLET: envIsSet(
      'TRON_MASTER_WALLET',
      'MASTER_WALLET_ADDRESS',
      'MASTER_TRON_ADDRESS',
      'TRON_MASTER_ADDRESS'
    ),
    TRON_API_KEY: envIsSet('TRON_API_KEY', 'TRONGRID_API_KEY', 'TRON_PRO_API_KEY'),
  };

  const out = {
    status: 'error',
    timestamp: new Date().toISOString(),
    env,
    wallet: null,
    address_consistency: null,
    trongrid: null,
    balance: null,
  };

  try {
    if (!env.MASTER_PRIVATE_KEY && !env.TRON_MASTER_WALLET) {
      out.error = 'MASTER_PRIVATE_KEY (or TRON_MASTER_WALLET) is not configured';
      return res.status(503).json(out);
    }

    const address = getMasterWalletAddress();
    out.wallet = {
      address_masked: address.length > 10
        ? `${address.slice(0, 4)}…${address.slice(-4)}`
        : address,
      explicit_address_env: env.TRON_MASTER_WALLET,
    };

    if (env.MASTER_PRIVATE_KEY && env.TRON_MASTER_WALLET) {
      out.address_consistency = checkMasterWalletAddressConsistency();
      if (!out.address_consistency.match) {
        out.status = 'error';
        out.error =
          'TRON_MASTER_WALLET does not match the address derived from MASTER_PRIVATE_KEY';
        out.code = 'MASTER_ADDRESS_MISMATCH';
      }
    }

    const host = firstEnv('TRON_FULL_HOST', 'TRONGRID_FULL_HOST') || 'https://api.trongrid.io';
    const apiKey = firstEnv('TRON_API_KEY', 'TRONGRID_API_KEY', 'TRON_PRO_API_KEY');
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;
    const tgRes = await fetch(`${host.replace(/\/$/, '')}/wallet/getnowblock`, {
      method: 'POST',
      headers,
      body: '{}',
      signal: AbortSignal.timeout(12000),
    });
    let block = null;
    if (tgRes.ok) {
      const body = await tgRes.json().catch(() => ({}));
      block = body?.block_header?.raw_data?.number ?? null;
    }
    out.trongrid = {
      ok: tgRes.ok,
      http_status: tgRes.status,
      host,
      api_key_configured: Boolean(apiKey),
      block,
    };

    try {
      const info = await getMasterWalletInfo();
      out.balance = {
        usdt: info.usdtBalance,
        trx: info.trxBalance,
        source: info.source,
        trx_low: info.trxLow,
      };
    } catch (balErr) {
      out.balance = { error: balErr.code || balErr.message };
    }

    const addressOk = !out.address_consistency || out.address_consistency.match;
    const ok = Boolean(
      addressOk
      && out.wallet
      && out.trongrid?.ok
      && out.balance
      && out.balance.usdt != null
    );
    if (!addressOk) {
      out.status = 'error';
      return res.status(503).json(out);
    }
    out.status = ok ? 'ok' : 'degraded';
    return res.status(ok ? 200 : 503).json(out);
  } catch (err) {
    out.error = err.message || 'TRON health check failed';
    out.code = err.code || undefined;
    return res.status(503).json(out);
  }
});

/**
 * Public Turso ↔ Supabase user_wallets mirror probe (counts only, no PII).
 * Lets ops verify the admin users list source-of-truth is fully mirrored
 * without needing a local DATABASE_AUTH_TOKEN — the server already has one.
 *
 * When the mirror is incomplete, this probe also runs an idempotent Turso→Supabase
 * user_wallets backfill (server-side only) so production can self-heal after deploy
 * without an admin session. Query ?repair=0 to skip the heal and only report counts.
 */
app.get('/health/user-mirror', async (req, res) => {
  const out = {
    status: 'error',
    timestamp: new Date().toISOString(),
    turso_users: null,
    supabase_wallets: null,
    missing_count: null,
    in_sync: false,
    supabase_enabled: false,
    repair: null,
  };
  try {
    const {
      getUserWalletsMirrorStatus,
      backfillAllUserWallets,
    } = require('./services/supabaseSyncService');
    let mirror = await getUserWalletsMirrorStatus();
    const repairParam = String(req.query?.repair ?? '1').trim().toLowerCase();
    const allowRepair = repairParam !== '0' && repairParam !== 'false' && repairParam !== 'no';

    if (allowRepair && mirror.enabled && !mirror.in_sync) {
      const beforeMissing = Array.isArray(mirror.missing_user_ids)
        ? mirror.missing_user_ids.length
        : null;
      try {
        const result = await backfillAllUserWallets();
        mirror = await getUserWalletsMirrorStatus();
        out.repair = {
          attempted: true,
          before_missing: beforeMissing,
          after_missing: Array.isArray(mirror.missing_user_ids)
            ? mirror.missing_user_ids.length
            : null,
          synced: result?.synced ?? null,
          created: result?.created ?? null,
          failed: result?.failed ?? null,
          total: result?.total ?? null,
          ok: Boolean(result?.ok),
        };
      } catch (repairErr) {
        out.repair = {
          attempted: true,
          error: repairErr.message || 'repair_failed',
        };
      }
    } else if (!allowRepair) {
      out.repair = { attempted: false, skipped: true, reason: 'repair_disabled' };
    }

    out.supabase_enabled = Boolean(mirror.enabled);
    out.turso_users = mirror.turso_total;
    out.supabase_wallets = mirror.supabase_total;
    out.missing_count = Array.isArray(mirror.missing_user_ids)
      ? mirror.missing_user_ids.length
      : null;
    out.in_sync = Boolean(mirror.in_sync);
    if (mirror.reason) out.reason = mirror.reason;
    out.status = mirror.in_sync ? 'ok' : (mirror.enabled ? 'degraded' : 'error');
    return res.status(mirror.in_sync ? 200 : 503).json(out);
  } catch (err) {
    out.error = err.message || 'user-mirror health check failed';
    return res.status(503).json(out);
  }
});

app.use('/api/config', require('./routes/config'));
app.use('/api/qr', require('./routes/qr'));
app.use('/api/auth', authRoutes);
app.use('/api/deposit', depositRoutes);
app.use('/api/tron/orders', require('./routes/tronOrders'));
app.use('/api/tron/wallet', require('./routes/tronWallet'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/kyc', require('./routes/kyc'));
app.use('/api/p2p', require('./routes/p2p'));
app.use('/api/withdrawal', require('./routes/withdrawal'));
app.use('/api/withdraw', require('./routes/withdraw'));

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).send('Page not found');
});

let server = null;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  await new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });

  await closeDb().catch(() => {});

  if (signal) {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function start() {
  if (!fs.existsSync(INDEX_HTML)) {
    console.error('WARNING: public/index.html not found at:', INDEX_HTML);
  } else {
    console.log('Dashboard file OK:', INDEX_HTML);
  }

  const { isSupabaseEnabled } = require('./lib/supabase');
  if (isSupabaseEnabled()) {
    console.log('Supabase sync: enabled (dual-write to cloud tables)');
  } else {
    console.log('Supabase sync: disabled — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_*)');
  }

  await initDb();

  try {
    const { ensureEnvSuperAdmin } = require('./services/adminAuthService');
    const ensured = await ensureEnvSuperAdmin({ source: 'boot' });
    if (ensured.skipped) {
      console.log('[admin] env super-admin ensure skipped:', ensured.reason);
    } else {
      console.log(
        '[admin] env super-admin ensured:',
        ensured.user?.email,
        `created=${ensured.created}`,
        `promoted=${ensured.promoted}`,
        `password_synced=${ensured.password_synced}`
      );
    }
  } catch (err) {
    console.warn('[admin] env super-admin ensure failed:', err.message);
  }

  try {
    const { isSupabaseEnabled } = require('./lib/supabase');
    if (isSupabaseEnabled()) {
      const {
        getUserWalletsMirrorStatus,
        backfillAllUserWalletsInBackground,
      } = require('./services/supabaseSyncService');
      const mirror = await getUserWalletsMirrorStatus();
      if (mirror.enabled && !mirror.in_sync) {
        console.warn(
          `[supabase] user_wallets mirror incomplete `
          + `(turso=${mirror.turso_total} supabase=${mirror.supabase_total} `
          + `missing=${Array.isArray(mirror.missing_user_ids) ? mirror.missing_user_ids.length : '?'})`
          + ' — starting background backfill'
        );
        backfillAllUserWalletsInBackground();
      }
    }
  } catch (err) {
    console.warn('[supabase] user mirror boot check skipped:', err.message);
  }

  const { processExpiredP2pOrders } = require('./services/p2pOrderExpiryService');
  const expiryInterval = setInterval(() => {
    processExpiredP2pOrders().catch((err) => {
      console.error('[p2p/expiry-cron]', err);
    });
  }, 60 * 1000);
  expiryInterval.unref?.();

  const { startTronOrderPoller } = require('./services/tronOrderService');
  startTronOrderPoller();

  await new Promise((resolve, reject) => {
    server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`Eisy Myanmar server: http://localhost:${PORT}/`);
      console.log(`Public:  ${PUBLIC_DIR}`);
      console.log(`Health:  http://localhost:${PORT}/health`);
      resolve();
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\nPort ${PORT} is already in use.`);
        console.error('Stop the other process:');
        console.error(`  Get-NetTCPConnection -LocalPort ${PORT} | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`);
        console.error('Or run: npm run dev  (predev script frees the port automatically)\n');
      }
      reject(err);
    });
  });
}

if (require.main === module && !process.env.VERCEL) {
  start().catch(async (err) => {
    console.error('Failed to start server:', err.message || err);
    await shutdown();
    process.exit(1);
  });
} else {
  module.exports = { app, start, shutdown };
}
