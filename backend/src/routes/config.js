const express = require('express');
const { getPublicSupabaseConfig } = require('../lib/supabase');

const router = express.Router();

router.get('/supabase', (_req, res) => {
  res.json(getPublicSupabaseConfig());
});

module.exports = router;
