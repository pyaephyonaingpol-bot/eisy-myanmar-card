const express = require('express');
const { getPublicSupabaseConfig } = require('../lib/supabase');

const router = express.Router();

router.get('/supabase', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  res.json(getPublicSupabaseConfig());
});

module.exports = router;
