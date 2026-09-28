/**
 * Standard Card (KYC) routes — Bitnob wallet + Bitnob cards only.
 * Mounted under /api/user. Do not import Kripicard issuance here.
 */
const express = require('express');
const { requireAuth, requireSensitive } = require('../middleware/auth');
const User = require('../models/User');
const {
  getCardPricingSettings,
  getWithdrawalFeeSettings,
  getDepositFeeSettings,
  getCurrentRateSummary,
} = require('../services/settingsService');
const { purchaseCardFromUsdtWallet } = require('../services/cardWalletService');
const { resolveBitnobCustomerId } = require('../services/cardIssueService');
const {
  BITNOB_CARD_CREATE_FEE_USD,
  getBitnobFeeSchedule,
} = require('../constants/bitnobFees');
const { isKycVerified, normalizeKycStatus } = require('../services/kycService');
const {
  getDualWalletOverview,
  getOrCreateStandardDepositAddress,
} = require('../services/bitnobWalletService');
const {
  getBitnobKycPublicStatus,
  submitBitnobCardKycForUser,
} = require('../services/bitnobKycService');

const router = express.Router();

async function assertKycVerifiedForBitnob(userId) {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }
  const status = normalizeKycStatus(user.kyc_status);
  if (!isKycVerified(status)) {
    const err = new Error(
      'Standard Card requires KYC verification. Use Instant Card (No KYC) with Master Wallet, or complete KYC first.'
    );
    err.code = 'KYC_REQUIRED_FOR_BITNOB';
    err.kyc_status = status;
    throw err;
  }
  return user;
}

function attachHelpers({ respondCardPurchaseError, buildCardPurchaseSuccessPayload }) {
  router.get('/card/pricing', requireAuth, async (req, res) => {
    try {
      const settings = await getCardPricingSettings();
      const currentRate = await getCurrentRateSummary();
      const user = await User.findById(req.user.id);
      const bitnobKyc = getBitnobKycPublicStatus(user);
      const customerId = bitnobKyc.customer_id || resolveBitnobCustomerId({ user });
      const bitnobConfigured = Boolean(
        String(process.env.BITNOB_CLIENT_ID || '').trim()
        && String(process.env.BITNOB_CLIENT_SECRET || process.env.BITNOB_SECRET_KEY || '').trim()
      );
      const kycStatus = normalizeKycStatus(user?.kyc_status);
      const kycVerified = isKycVerified(kycStatus);
      res.json({
        card_issuance_fee_usd: settings.card_issuance_fee_usd,
        card_funding_fee_percent: settings.card_funding_fee_percent,
        card_processing_fee_usd: settings.card_processing_fee_usd,
        platform_markup_usd: settings.card_issuance_fee_usd,
        bitnob_create_fee_usd: BITNOB_CARD_CREATE_FEE_USD,
        bitnob_fee_schedule: getBitnobFeeSchedule(),
        minimum_initial_deposit_usd: settings.minimum_initial_deposit_usd,
        card_reload_fee_usd: settings.card_reload_fee_usd,
        card_reload_provider_cost_usd: settings.card_reload_provider_cost_usd,
        card_reload_net_profit_usd: settings.card_reload_net_profit_usd,
        minimum_usdt_deposit: settings.minimum_usdt_deposit,
        minimum_usdt_reload: settings.minimum_usdt_reload,
        mmk_to_usd_rate: settings.mmk_to_usd_rate,
        rate_effective_date: currentRate.effective_date,
        rate_label: "Today's Daily Exchange Rate",
        currency: 'USD',
        payment_currency: 'USDT',
        payment_wallet: 'bitnob_usdt',
        ledger: 'bitnob',
        card_flow: 'standard',
        mmk_wallet_allowed_for_cards: false,
        wallet_rules: {
          master_usdt: ['deposit', 'withdraw', 'instant_card_issuance', 'instant_card_reload'],
          bitnob_usdt: ['standard_card_deposit', 'standard_card_issuance', 'standard_card_reload'],
          mmk: ['bank_withdrawal_only'],
        },
        card_issuance_payment: 'bitnob_wallet',
        card_issuance_rate: '1 USDT ≈ 1 USD',
        exchange_rate_applied: false,
        auto_issue: true,
        provider: 'bitnob',
        deposit_path: 'bitnob_address',
        deposit_hint: 'Deposit USDT to your Standard Card address (Bitnob). Master Wallet cannot fund Standard Cards.',
        requires_kyc: true,
        kyc_status: kycStatus,
        is_kyc_verified: kycVerified,
        bitnob_configured: bitnobConfigured,
        bitnob_customer_ready: Boolean(bitnobKyc.customer_ready),
        bitnob_customer_id: customerId || null,
        bitnob_kyc_status: bitnobKyc.bitnob_kyc_status,
        bitnob_kyc_reason: bitnobKyc.bitnob_kyc_reason,
        bitnob_eligible: kycVerified && Boolean(bitnobKyc.can_issue_standard_card),
        withdrawal_fees: await getWithdrawalFeeSettings(),
        deposit_fees: await getDepositFeeSettings(),
      });
    } catch (err) {
      console.error('[user/card/pricing]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  async function handleStandardRequest(req, res, logTag) {
    try {
      await assertKycVerifiedForBitnob(req.user.id);
      const user = await User.findById(req.user.id);
      const walletType = String(req.body.wallet_type || 'bitnob_usdt').toLowerCase();
      if (walletType && !['usdt', 'bitnob_usdt', 'bitnob'].includes(walletType)) {
        return res.status(400).json({
          error: 'Standard Card accepts Bitnob wallet USDT only. Master Wallet funds Instant Cards.',
          code: 'BITNOB_WALLET_ONLY_CARD_ISSUANCE',
          ledger: 'bitnob',
        });
      }

      const result = await purchaseCardFromUsdtWallet(req.user.id, {
        initialLoadUsd: parseFloat(req.body.initial_load_usd),
        cardHolderName: req.body.name_on_card || req.body.card_holder_name || user.name,
        note: req.body.note,
        customerId: req.body.customer_id || req.body.customerId || null,
        paymentRef: req.body.payment_ref || req.body.idempotency_key || null,
      });

      return res.json(buildCardPurchaseSuccessPayload(result));
    } catch (err) {
      return respondCardPurchaseError(res, err, logTag);
    }
  }

  router.post('/card/request', requireAuth, requireSensitive, (req, res) =>
    handleStandardRequest(req, res, 'user/card/request'));
  router.post('/card/request-standard', requireAuth, requireSensitive, (req, res) =>
    handleStandardRequest(req, res, 'user/card/request-standard'));

  /** Legacy aliases — still Bitnob/Standard only (no Kripicard). */
  async function handleLegacyStandardIssue(req, res, logTag) {
    try {
      await assertKycVerifiedForBitnob(req.user.id);
      const user = await User.findById(req.user.id);
      const body = req.body || {};
      const initialLoadUsd = parseFloat(
        body.initial_load_usd ?? body.amount ?? body.purchase_amount ?? body.initial_amount
      );

      const result = await purchaseCardFromUsdtWallet(req.user.id, {
        initialLoadUsd,
        cardHolderName: body.name_on_card || body.cardholder_name || body.cardHolderName || user.name,
        note: body.note,
        customerId: body.customer_id || body.customerId || null,
        paymentRef: body.payment_ref || body.paymentRef || body.idempotency_key || body.idempotencyKey || null,
      });

      return res.json({
        ...buildCardPurchaseSuccessPayload(result),
        reused: false,
      });
    } catch (err) {
      return respondCardPurchaseError(res, err, logTag);
    }
  }

  router.post('/cards/purchase', requireAuth, requireSensitive, (req, res) =>
    handleLegacyStandardIssue(req, res, 'user/cards/purchase'));
  router.post('/cards/issue', requireAuth, requireSensitive, (req, res) =>
    handleLegacyStandardIssue(req, res, 'user/cards/issue'));

  router.get('/wallets/card-funding', requireAuth, async (req, res) => {
    try {
      const overview = await getDualWalletOverview(req.user.id);
      res.json(overview);
    } catch (err) {
      console.error('[user/wallets/card-funding]', err);
      res.status(500).json({ error: err.message || 'Failed to load wallets' });
    }
  });

  router.get('/wallets/standard/deposit-address', requireAuth, async (req, res) => {
    try {
      const deposit = await getOrCreateStandardDepositAddress(req.user.id, {
        forceRefresh: String(req.query.refresh || '') === '1',
      });
      res.json(deposit);
    } catch (err) {
      const code = err.code || 'BITNOB_DEPOSIT_ADDRESS_ERROR';
      const status = code === 'KYC_REQUIRED_FOR_BITNOB' ? 403
        : code === 'BITNOB_NOT_CONFIGURED' ? 503
          : 400;
      console.error('[user/wallets/standard/deposit-address]', err.message, code);
      res.status(status).json({ error: err.message, code, kyc_status: err.kyc_status });
    }
  });

  router.get('/wallets/standard/bitnob-kyc', requireAuth, async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      const platform = normalizeKycStatus(user?.kyc_status);
      res.json({
        success: true,
        platform_kyc_status: platform,
        is_kyc_verified: isKycVerified(platform),
        ...getBitnobKycPublicStatus(user),
      });
    } catch (err) {
      console.error('[user/wallets/standard/bitnob-kyc]', err);
      res.status(500).json({ error: err.message || 'Failed to load Bitnob KYC status' });
    }
  });

  router.post('/wallets/standard/bitnob-kyc', requireAuth, requireSensitive, async (req, res) => {
    try {
      await assertKycVerifiedForBitnob(req.user.id);
      const result = await submitBitnobCardKycForUser(req.user.id, {
        force: String(req.body?.force || '') === '1' || req.body?.force === true,
      });
      const user = await User.findById(req.user.id);
      res.json({
        success: true,
        ...result,
        ...getBitnobKycPublicStatus(user),
      });
    } catch (err) {
      const code = err.code || 'BITNOB_KYC_ERROR';
      const status = code === 'KYC_REQUIRED_FOR_BITNOB' ? 403
        : code === 'BITNOB_NOT_CONFIGURED' ? 503
          : 400;
      console.error('[user/wallets/standard/bitnob-kyc POST]', err.message, code);
      res.status(status).json({ error: err.message, code });
    }
  });

  return router;
}

module.exports = { attachHelpers, router, assertKycVerifiedForBitnob };
