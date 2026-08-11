/**
 * GET /api/qr?data=... — PNG QR code for deposit addresses / payment links.
 * Served from our own API so Vercel does not depend on third-party QR hosts.
 */
const express = require('express');
const QRCode = require('qrcode');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const data = String(req.query.data || req.query.text || req.query.q || '').trim();
    if (!data) {
      return res.status(400).json({ error: 'Query parameter "data" is required' });
    }
    if (data.length > 2048) {
      return res.status(400).json({ error: 'QR data too long' });
    }

    const size = Math.min(512, Math.max(80, parseInt(req.query.size, 10) || 180));
    const png = await QRCode.toBuffer(data, {
      type: 'png',
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });

    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=300',
      'Content-Length': png.length,
    });
    return res.send(png);
  } catch (err) {
    console.error('[qr]', err.message);
    return res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

module.exports = router;
