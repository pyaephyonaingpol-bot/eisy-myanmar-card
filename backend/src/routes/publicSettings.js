const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getPublicRatesAndFees } = require('../services/settingsService');

const router = express.Router();

router.get('/', requireAuth, async (_req, res) => {
  try {
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    const payload = await getPublicRatesAndFees();
    res.json({ success: true, ...payload });
  } catch (err) {
    console.error('[settings GET]', err.message);
    res.status(500).json({ error: 'Could not load rates and fees', code: 'RATES_FEES_FAILED' });
  }
});

module.exports = router;
