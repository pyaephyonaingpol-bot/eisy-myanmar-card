/**
 * Instant Card (Non-KYC) routes — Kripicard + Master Wallet only.
 * Mounted under /api/user. Instant / Kripicard issuance only.
 * Bitnob / Standard Card providers are rejected (retired).
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
const {
  cardIssuanceAvailability,
  assertCardIssuanceNotPaused,
} = require('../../../lib/kripicardCardMaintenance');
const { assertKripicardOnlyProvider } = require('../services/kripicardOnlyGateways');

const router = express.Router();

function providerErrorFromBinOptions(options) {
  if (!options?.error) return null;
  const err = new Error(options.error.message || 'BIN fetch failed');
  err.code = options.error.code || 'KRIPICARD_BINS_FETCH_FAILED';
  err.status = options.error.status || options.error.provider_status || null;
  err.providerCode = options.error.provider_code || options.error.providerCode || null;
  return err;
}

function attachHelpers({ respondCardPurchaseError, buildCardPurchaseSuccessPayload }) {
  router.get('/card/bins', requireAuth, async (req, res) => {
    try {
      const settings = await getCardPricingSettings();
      const options = await getKripicardBinOptions({ pricingSettings: settings });
      const issuance = cardIssuanceAvailability({
        providerError: providerErrorFromBinOptions(options),
      });
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
        issuance,
        available: issuance.available,
        maintenance: issuance.maintenance,
        retryable: issuance.retryable,
        retry_after_seconds: issuance.retry_after_seconds,
        message: issuance.message,
        code: issuance.code,
      });
    } catch (err) {
      console.error('[user/card/bins]', err);
      const issuance = cardIssuanceAvailability({ providerError: err });
      if (issuance.maintenance) {
        return res.status(503).json({
          error: issuance.message,
          ...issuance,
          provider: 'kripicard',
          card_flow: 'instant',
          bins: [],
          details: [],
        });
      }
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
      const kripicardConfigured = Boolean(String(process.env.KRIPICARD_API_KEY || '').trim());
      const issuance = cardIssuanceAvailability();
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
        issuance,
        available: issuance.available,
        maintenance: issuance.maintenance,
        retryable: issuance.retryable,
        retry_after_seconds: issuance.retry_after_seconds,
        message: issuance.message,
        code: issuance.code,
      });
    } catch (err) {
      console.error('[user/card/pricing-kripicard]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  async function handleInstantRequest(req, res, logTag) {
    try {
      try {
        assertKripicardOnlyProvider(req.body || {});
      } catch (providerErr) {
        return res.status(400).json({
          error: providerErr.message,
          code: providerErr.code || 'BITNOB_RETIRED',
          provider: 'kripicard',
        });
      }

      assertCardIssuanceNotPaused();

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
