const express = require('express');
const { getPublicSupabaseConfig } = require('../lib/supabase');

const router = express.Router();

router.get('/supabase', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  // Pass req so preview / Host-based origins resolve to same-origin /supabase proxy.
  res.json(getPublicSupabaseConfig(req));
});

module.exports = router;
