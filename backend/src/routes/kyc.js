const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { uploadKycFields, persistKycUpload } = require('../middleware/upload');
const {
  getKycStatusForUser,
  submitKyc,
} = require('../services/kycService');

const router = express.Router();

router.get('/status', requireAuth, async (req, res) => {
  try {
    const status = await getKycStatusForUser(req.user.id);
    res.json({ success: true, ...status });
  } catch (err) {
    console.error('[kyc/status]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/submit', requireAuth, uploadKycFields, async (req, res) => {
  try {
    const front = req.files?.front_photo?.[0];
    const back = req.files?.back_photo?.[0];
    const selfie = req.files?.selfie_photo?.[0];

    const result = await submitKyc(req.user.id, {
      full_name: req.body.full_name,
      id_type: req.body.id_type,
      id_number: req.body.id_number,
      front_photo_path: front ? await persistKycUpload(front) : null,
      back_photo_path: back ? await persistKycUpload(back) : null,
      selfie_photo_path: selfie ? await persistKycUpload(selfie) : null,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[kyc/submit]', err);
    res.status(400).json({ error: err.message || 'Failed to submit KYC' });
  }
});

module.exports = router;
