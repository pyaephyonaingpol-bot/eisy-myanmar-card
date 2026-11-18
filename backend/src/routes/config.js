const express = require('express');
const { getPublicSupabaseConfig } = require('../lib/supabase');
const { getPublicClientConfig } = require('../services/errorMonitor');

const router = express.Router();

router.get('/supabase', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  // Pass req so preview / Host-based origins resolve to same-origin /supabase proxy.
  res.json(getPublicSupabaseConfig(req));
});

/** Public Sentry / monitoring bootstrap for the SPA (DSN is browser-safe when set). */
router.get('/monitoring', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json(getPublicClientConfig());
});

module.exports = router;
