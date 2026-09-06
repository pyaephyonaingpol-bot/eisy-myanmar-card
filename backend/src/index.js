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
        || req.originalUrl.startsWith('/api/nowpayments/')
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

app.get('/health', (_req, res) => {
  const { getDatabaseInfo } = require('./db');
  const { getSecurityStatus } = require('./services/securityFlags');
  res.json({
    status: 'ok',
    service: 'Eisy Myanmar Backend',
    timestamp: new Date().toISOString(),
    database: getDatabaseInfo(),
    security: getSecurityStatus(),
  });
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

    const ok = Boolean(out.wallet && out.trongrid?.ok && out.balance && out.balance.usdt != null);
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
 */
app.get('/health/user-mirror', async (_req, res) => {
  const out = {
    status: 'error',
    timestamp: new Date().toISOString(),
    turso_users: null,
    supabase_wallets: null,
    missing_count: null,
    in_sync: false,
    supabase_enabled: false,
  };
  try {
    const { getUserWalletsMirrorStatus } = require('./services/supabaseSyncService');
    const mirror = await getUserWalletsMirrorStatus();
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
const nowPaymentsRoutes = require('../../server/routes/nowpayments');
app.use('/api/nowpayments', nowPaymentsRoutes);
app.post('/api/create-payment', requireAuth, requireSensitive, nowPaymentsRoutes.createPaymentHandler);
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
    const { logNowPaymentsPayoutConfigAtBoot } = require('./services/nowPaymentsPayoutService');
    logNowPaymentsPayoutConfigAtBoot();
  } catch (err) {
    console.warn('[nowpayments-payout] boot config log skipped:', err.message);
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
