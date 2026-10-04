/**
 * Instant Card (Non-KYC) routes — Kripicard + Master Wallet only.
 * Mounted under /api/user. Instant / Kripicard issuance only.
 */
const express = require('express');
const { requireAuth, requireSensitive } = require('../middleware/auth');
const User = require('../models/User');
const {
  getCardPricingSettings,
  calculateKripicardRequestPricingUsdt,
} = require('../services/settingsService');
const {
  purchaseKripicardFromUsdtWallet,
  getKripicardBinOptions,
} = require('../services/kripicardCardWalletService');

const router = express.Router();

function attachHelpers({ respondCardPurchaseError, buildCardPurchaseSuccessPayload }) {
  router.get('/card/bins', requireAuth, async (req, res) => {
    try {
      const settings = await getCardPricingSettings();
      const options = await getKripicardBinOptions({ pricingSettings: settings });
      res.json({
        provider: 'kripicard',
        card_flow: 'instant',
        ledger: 'master_wallet',
        requires_kyc: false,
        default_bin: options.default_bin,
        bins: options.bins,
        details: options.details || options.catalog || [],
        source: options.source,
        error: options.error || null,
      });
    } catch (err) {
      console.error('[user/card/bins]', err);
      res.status(500).json({ error: err.message || 'Failed to load BINs', code: err.code });
    }
  });

  router.get('/card/pricing-kripicard', requireAuth, async (req, res) => {
    try {
      const settings = await getCardPricingSettings();
      const sampleLoad = Number(settings.minimum_initial_deposit_usd) || 10;
      let sample = null;
      try {
        sample = calculateKripicardRequestPricingUsdt(sampleLoad, settings);
      } catch (_) { /* ignore */ }
      const kripicardConfigured = Boolean(
        String(process.env.CARD_API_KEY || process.env.KRIPICARD_API_KEY || '').trim()
      );
      res.json({
        provider: 'kripicard',
        card_flow: 'instant',
        requires_kyc: false,
        kripicard_configured: kripicardConfigured,
        card_issuance_fee_usd: settings.card_issuance_fee_usd,
        card_funding_fee_percent: settings.card_funding_fee_percent,
        card_processing_fee_usd: settings.card_processing_fee_usd,
        minimum_initial_deposit_usd: settings.minimum_initial_deposit_usd,
        payment_currency: 'USDT',
        payment_wallet: 'usdt',
        ledger: 'master_wallet',
        card_issuance_rate: '1 USDT ≈ 1 USD',
        deposit_path: 'master_wallet_trc20',
        deposit_hint: 'Top up Master Wallet via TRC20 crypto deposit before issuing Instant Card.',
        sample_pricing: sample,
        auto_issue: true,
      });
    } catch (err) {
      console.error('[user/card/pricing-kripicard]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  async function handleInstantRequest(req, res, logTag) {
    try {
      const user = await User.findById(req.user.id);
      const walletType = String(req.body.wallet_type || 'usdt').toLowerCase();
      if (walletType && walletType !== 'usdt' && walletType !== 'master_usdt') {
        return res.status(400).json({
          error: 'Instant Card accepts Master Wallet USDT only.',
          code: 'USDT_ONLY_CARD_ISSUANCE',
          ledger: 'master_wallet',
        });
      }

      const result = await purchaseKripicardFromUsdtWallet(req.user.id, {
        initialLoadUsd: parseFloat(req.body.initial_load_usd),
        cardHolderName: req.body.name_on_card || req.body.card_holder_name || user.name,
        note: req.body.note,
        bin: req.body.bin || req.body.card_bin || null,
        paymentRef: req.body.payment_ref || req.body.idempotency_key || null,
      });

      return res.json(buildCardPurchaseSuccessPayload(result));
    } catch (err) {
      return respondCardPurchaseError(res, err, logTag);
    }
  }

  router.post('/card/request-kripicard', requireAuth, requireSensitive, (req, res) =>
    handleInstantRequest(req, res, 'user/card/request-kripicard'));
  router.post('/card/request-instant', requireAuth, requireSensitive, (req, res) =>
    handleInstantRequest(req, res, 'user/card/request-instant'));

  return router;
}

module.exports = { attachHelpers, router };
