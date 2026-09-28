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
      date_of_birth: req.body.date_of_birth || req.body.dob || null,
      address_line1: req.body.address_line1 || req.body.line1 || null,
      address_line2: req.body.address_line2 || req.body.line2 || null,
      address_city: req.body.address_city || req.body.city || null,
      address_state: req.body.address_state || req.body.state || null,
      address_postal: req.body.address_postal || req.body.postal_code || null,
      address_country: req.body.address_country || req.body.country || 'MMR',
      occupation: req.body.occupation || null,
      employment_status: req.body.employment_status || null,
      account_purpose: req.body.account_purpose || null,
      annual_salary: req.body.annual_salary || null,
      expected_monthly_volume: req.body.expected_monthly_volume || null,
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
