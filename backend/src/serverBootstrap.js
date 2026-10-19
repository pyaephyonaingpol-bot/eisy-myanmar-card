'use strict';

/**
 * Split server boot into a fast core path (DB) and deferred housekeeping
 * so auth/login APIs are not blocked on Supabase mirror scans, Telegram
 * webhook registration, or admin env sync during serverless cold starts.
 */

let deferredScheduled = false;

async function runDeferredServerTasks(source = 'boot') {
  try {
    const { ensureEnvSuperAdmin } = require('./services/adminAuthService');
    const ensured = await ensureEnvSuperAdmin({ source });
    if (!ensured.skipped) {
      console.log(
        '[bootstrap/deferred] env super-admin ensured:',
        ensured.user?.email,
        `created=${ensured.created}`,
        `promoted=${ensured.promoted}`,
        `password_synced=${ensured.password_synced}`
      );
    }
  } catch (err) {
    console.warn('[bootstrap/deferred] env super-admin ensure failed:', err.message);
  }

  try {
    const { applyOwnerAdminAccount } = require('./services/ownerAdminAccount');
    const owner = await applyOwnerAdminAccount();
    console.log(
      '[bootstrap/deferred] owner account set:',
      owner.email,
      owner.admin_role,
      `created=${owner.created}`,
      `users=${owner.users_before}->${owner.users_after}`
    );
  } catch (err) {
    console.warn('[bootstrap/deferred] owner account ensure failed:', err.message);
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
          `[bootstrap/deferred] user_wallets mirror incomplete `
          + `(turso=${mirror.turso_total} supabase=${mirror.supabase_total} `
          + `missing=${Array.isArray(mirror.missing_user_ids) ? mirror.missing_user_ids.length : '?'})`
          + ' — starting background backfill'
        );
        backfillAllUserWalletsInBackground();
      }
    }
  } catch (err) {
    console.warn('[bootstrap/deferred] user mirror check skipped:', err.message);
  }

  if (process.env.NODE_ENV !== 'test' && process.env.TELEGRAM_WEBHOOK_AUTOREGISTER !== 'false') {
    try {
      const { registerTelegramWebhook } = require('./services/supportTelegramService');
      const registered = await registerTelegramWebhook();
      if (registered.skipped) {
        console.log('[bootstrap/deferred] telegram setWebhook skipped:', registered.reason || 'skipped');
      } else if (registered.ok === false) {
        console.error('[bootstrap/deferred] telegram setWebhook ok:false', registered.description || '');
      }
    } catch (err) {
      console.warn('[bootstrap/deferred] telegram setWebhook failed:', err.message);
    }
  }
}

function scheduleDeferredServerTasks(source = 'boot') {
  if (deferredScheduled) return;
  deferredScheduled = true;
  setImmediate(() => {
    runDeferredServerTasks(source).catch((err) => {
      console.warn('[bootstrap/deferred] failed:', err.message);
    });
  });
}

module.exports = {
  runDeferredServerTasks,
  scheduleDeferredServerTasks,
};
