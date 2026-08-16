const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const {
  requireAuth,
  requireSensitive,
  requireAdminAuth,
  requirePermission,
} = require('../middleware/auth');
const { uploadDepositScreenshot, publicUploadPath, saveDepositScreenshotFromBase64 } = require('../middleware/upload');
const DepositRequest = require('../models/DepositRequest');
const {
  createDepositRequest,
  createUsdtDepositRequest,
  submitAndAutoVerifyUsdtDeposit,
  retryVerifySubmittedUsdtDeposit,
  verifyByListener,
  getExchangeRate,
} = require('../services/depositService');
const {
  submitP2pUsdtDeposit,
  isP2pDeposit,
} = require('../services/p2pDepositService');
const { enrichDeposit } = require('../services/depositEnrichment');
const { walletPayload } = require('../services/walletService');
const { getUsdtDepositSettings } = require('../services/settingsService');
const { createBinancePayDeposit } = require('../services/binanceDepositService');
const { listPaymentMethods, resolveActivePaymentMethod } = require('../services/depositPaymentMethodService');
const { getMasterWalletAddress } = require('../services/tronMasterWalletService');

const router = express.Router();

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Secure POST /api/deposit/verify:
 * - Verified server hook via DEPOSIT_LISTENER_SECRET header, OR
 * - Authorized admin (API key / admin session) with deposits permission.
 * Never open to anonymous callers — even in non-production.
 */
function requireListenerOrAdmin(req, res, next) {
  const expected = process.env.DEPOSIT_LISTENER_SECRET || '';
  const provided = req.headers['x-deposit-listener-secret']
    || req.headers['x-listener-secret']
    || '';

  if (expected) {
    if (provided) {
      if (timingSafeEqualString(provided, expected)) {
        req.verifyAuth = 'listener';
        return next();
      }
      return res.status(401).json({ error: 'Unauthorized listener', code: 'LISTENER_UNAUTHORIZED' });
    }
    // No listener secret header — allow authorized admin instead.
  } else if (process.env.NODE_ENV === 'production') {
    console.warn('[deposit/verify] DEPOSIT_LISTENER_SECRET unset in production — admin auth required');
  }

  return requireAdminAuth(req, res, (err) => {
    if (err) return next(err);
    return requirePermission('deposits')(req, res, (permErr) => {
      if (permErr) return next(permErr);
      req.verifyAuth = 'admin';
      return next();
    });
  });
}

/**
 * POST /api/deposit/create
 * Create a Binance Pay checkout order with 2% fee (min $1).
 * Body: { amount_usdt | amount, currency?, terminalType?, returnUrl?, cancelUrl? }
 */
router.post('/create', requireAuth, requireSensitive, async (req, res) => {
  try {
    const result = await createBinancePayDeposit(req.user.id, req.body || {});
    return res.status(201).json({
      success: true,
      provider: 'binance_pay',
      message: result.message,
      deposit: result.deposit,
      fee_breakdown: result.fee_breakdown,
      fee_rule: 'Math.max(amount * 0.02, 1)',
      binance: result.binance,
      checkout_url: result.binance?.checkout_url || null,
      qrcode_link: result.binance?.qrcode_link || null,
    });
  } catch (err) {
    console.error('[deposit/create]', err.message, err.code || '');
    const status = err.code === 'BINANCE_PAY_NOT_CONFIGURED'
      ? 503
      : (err.code === 'PAYMENT_FEE_EXCEEDS_AMOUNT' ? 400 : 400);
    return res.status(status).json({
      success: false,
      error: err.message || 'Failed to create Binance Pay deposit',
      code: err.code,
      binance: err.binance || undefined,
    });
  }
});

router.post('/request', requireAuth, requireSensitive, async (req, res) => {
  try {
    const userId = req.user.id;
    const depositType = (req.body.deposit_type || 'mmk').toLowerCase();

    if (depositType === 'usdt') {
      const amountUsdt = parseFloat(req.body.amount_usdt);
      const network = req.body.network || 'TRC20';
      const depositChannel = (req.body.deposit_channel || 'platform_direct').toLowerCase();

      if (!amountUsdt || amountUsdt <= 0) {
        return res.status(400).json({ error: 'Positive amount_usdt is required' });
      }

      if (depositChannel === 'p2p') {
        return res.status(400).json({
          error: 'P2P merchant USDT deposits are no longer supported. Use Platform Direct or buy USDT on the P2P marketplace.',
        });
      }

      const { deposit, depositAddress, network: net, fee_breakdown } = await createUsdtDepositRequest(userId, {
        amount_usdt: amountUsdt,
        network,
        metadata: { deposit_channel: 'platform_direct', ...(req.body.metadata || {}) },
      });

      return res.json({
        success: true,
        message: 'USDT Deposit Request Submitted!',
        deposit: enrichDeposit(deposit),
        deposit_type: 'usdt',
        deposit_channel: 'platform_direct',
        fee_breakdown,
        payment_instructions: {
          message: `Send exactly ${amountUsdt.toFixed(2)} USDT via ${net} to the platform address below`,
          ref_code: deposit.ref_code,
          network: net,
          deposit_address: depositAddress,
          fee_usdt: fee_breakdown?.fee_usdt,
          net_usdt: fee_breakdown?.net_usdt,
          fee_label: fee_breakdown?.fee_label,
          note: `Service fee is max(2%, $1). Net credit ≈ $${Number(fee_breakdown?.net_usdt || 0).toFixed(2)} USDT after approval.`,
        },
      });
    }

    const { amount_mmk, payment_method, purpose, payment_method_id } = req.body;

    if (!amount_mmk || amount_mmk <= 0) {
      return res.status(400).json({ error: 'Positive amount_mmk is required' });
    }

    let methodRow;
    try {
      methodRow = await resolveActivePaymentMethod({
        paymentMethodId: payment_method_id,
        paymentMethod: payment_method,
      });
    } catch (resolveErr) {
      return res.status(400).json({ error: resolveErr.message || 'Payment method unavailable' });
    }

    const method = methodRow.bank_name;
    const deposit = await createDepositRequest(userId, {
      amount_mmk,
      payment_method: method,
      purpose: purpose || 'topup',
      metadata: {
        ...(req.body.metadata || {}),
        payment_method_id: methodRow.id,
        bank_name: methodRow.bank_name,
        account_name: methodRow.account_name,
        account_number: methodRow.account_number,
        method_type: methodRow.method_type,
        qr_code_image_url: methodRow.qr_code_image_url,
      },
    });

    const rate = await getExchangeRate();
    const enriched = enrichDeposit(deposit);
    const feeInfo = enriched?.pricing_breakdown || enriched?.metadata?.payment_fee;

    res.json({
      success: true,
      deposit: enriched,
      fee_breakdown: feeInfo || null,
      payment_method: methodRow,
      payment_instructions: {
        message: `Send exactly ${Number(amount_mmk).toLocaleString()} MMK to the ${methodRow.bank_name} account below`,
        ref_code: deposit.ref_code,
        note: `Include reference code ${deposit.ref_code} in the payment note/description`,
        bank_name: methodRow.bank_name,
        account_name: methodRow.account_name,
        account_number: methodRow.account_number,
        method_type: methodRow.method_type,
        qr_code_image_url: methodRow.qr_code_image_url,
        qr_code_url: methodRow.qr_code_image_url
          || `/api/qr?size=200&data=${encodeURIComponent(methodRow.account_number)}`,
      },
      rate,
    });
  } catch (err) {
    console.error('[deposit/request]', err);
    const msg = err.message || 'Internal server error';
    if (
      msg.includes('Minimum')
      || msg.includes('Positive')
      || msg.includes('network must be')
      || msg.includes('Invalid')
      || msg.includes('not available')
      || msg.includes('No active bank')
      || err.code === 'SQLITE_CONSTRAINT'
    ) {
      return res.status(400).json({
        success: false,
        error: msg.includes('SQLITE_CONSTRAINT')
          ? 'Invalid deposit data — please check amount and network'
          : msg,
      });
    }
    res.status(500).json({ success: false, error: msg });
  }
});

router.post('/submit', requireAuth, requireSensitive, (req, res, next) => {
  if (req.is('application/json')) {
    return next();
  }
  uploadDepositScreenshot.single('screenshot')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed — images or videos (max 50MB)' });
    }
    next();
  });
}, async (req, res) => {
  try {
    const deposit_id = parseInt(req.body.deposit_id, 10);
    const kpay_transaction_id = req.body.kpay_transaction_id?.trim();
    const txn_id = req.body.txn_id?.trim();
    const tx_hash = req.body.tx_hash?.trim();
    const user_note = req.body.user_note?.trim();

    if (!deposit_id) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'deposit_id is required' });
    }
    if (!kpay_transaction_id && !txn_id && !tx_hash) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'kpay_transaction_id, txn_id, or tx_hash is required' });
    }

    const deposit = await DepositRequest.findById(deposit_id);
    if (!deposit) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Deposit not found' });
    }
    if (deposit.user_id !== req.user.id) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(403).json({ error: 'Access denied' });
    }
    if (['VERIFIED', 'REJECTED', 'FAILED'].includes(deposit.status)) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: `Cannot submit proof for status: ${deposit.status}` });
    }

    const isUsdt = deposit.purpose === 'usdt_topup' || deposit.deposit_currency === 'USDT';
    const txHashValue = tx_hash || txn_id || kpay_transaction_id;

    if (isUsdt && txHashValue) {
      if (isP2pDeposit(deposit)) {
        const result = await submitP2pUsdtDeposit(deposit_id, {
          txHash: txHashValue,
          userNote: user_note,
          userId: req.user.id,
        });
        return res.json({
          success: true,
          auto_verified: false,
          pending_p2p: true,
          pending: true,
          message: result.message,
          deposit: enrichDeposit(result.deposit),
        });
      }

      const result = await submitAndAutoVerifyUsdtDeposit(deposit_id, {
        txHash: txHashValue,
        userNote: user_note,
        userId: req.user.id,
      });

      const updatedDeposit = enrichDeposit(result.deposit);
      const wallet = result.user ? walletPayload(result.user) : null;

      if (result.autoVerified) {
        return res.json({
          success: true,
          auto_verified: true,
          pending: false,
          message: result.message || 'USDT Deposit Approved Successfully!',
          deposit: updatedDeposit,
          wallet,
          verification: result.verification || null,
        });
      }

      return res.json({
        success: true,
        auto_verified: false,
        pending: Boolean(result.pending),
        message: result.message,
        deposit: updatedDeposit,
        verification: result.verification || null,
      });
    }

    let screenshotPath;
    let screenshotOriginalName;
    let screenshotMimeType;
    if (req.file) {
      screenshotPath = publicUploadPath(req.file.filename);
      screenshotOriginalName = req.file.originalname;
      screenshotMimeType = req.file.mimetype;
    } else {
      const base64 = req.body.screenshot_base64
        || req.body.proof_base64
        || req.body.receipt_base64;
      if (base64) {
        const saved = saveDepositScreenshotFromBase64(base64, {
          originalName: req.body.screenshot_filename
            || req.body.proof_filename
            || req.body.receipt_filename
            || 'receipt.jpg',
        });
        screenshotPath = saved.screenshotPath;
        screenshotOriginalName = saved.originalName;
        screenshotMimeType = saved.mimeType;
      }
    }

    const updated = await DepositRequest.submitProof(deposit_id, {
      kpayTransactionId: kpay_transaction_id || txn_id || tx_hash,
      txnId: txn_id || tx_hash || kpay_transaction_id,
      txHash: tx_hash || txn_id || kpay_transaction_id,
      screenshotPath,
      screenshotOriginalName,
      screenshotMimeType,
      userNote: user_note,
    });

    res.json({
      success: true,
      auto_verified: false,
      pending: false,
      message: 'Deposit proof submitted — awaiting admin review',
      deposit: enrichDeposit(updated),
    });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error('[deposit/submit]', err);
    const msg = err.message || 'Internal server error';
    if (msg.includes('already been used') || msg.includes('Access denied') || msg.includes('Cannot submit')) {
      return res.status(400).json({ success: false, error: msg });
    }
    res.status(500).json({ success: false, error: msg });
  }
});

router.get('/payment-methods', requireAuth, async (_req, res) => {
  try {
    const methods = await listPaymentMethods({ activeOnly: true });
    let masterWalletAddress = null;
    try {
      masterWalletAddress = getMasterWalletAddress();
    } catch (_) {
      masterWalletAddress = null;
    }
    res.json({
      payment_methods: methods,
      usdt: {
        network: 'TRC20',
        address: masterWalletAddress,
        qr_code_url: masterWalletAddress
          ? `/api/qr?size=180&data=${encodeURIComponent(masterWalletAddress)}`
          : null,
        label: 'Master wallet (TRC20 USDT)',
      },
    });
  } catch (err) {
    console.error('[deposit/payment-methods]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/usdt-addresses', requireAuth, async (_req, res) => {
  try {
    const settings = await getUsdtDepositSettings();
    let masterWalletAddress = null;
    try {
      masterWalletAddress = getMasterWalletAddress();
    } catch (_) {
      masterWalletAddress = settings.usdt_trc20_address || null;
    }
    res.json({
      networks: [
        {
          id: 'TRC20',
          label: 'TRC20 (Tron) — Master Wallet',
          address: masterWalletAddress,
          qr_code_url: masterWalletAddress
            ? `/api/qr?size=180&data=${encodeURIComponent(masterWalletAddress)}`
            : null,
        },
        { id: 'BEP20', label: 'BEP20 (BSC)', address: settings.usdt_bep20_address },
      ],
      master_wallet_address: masterWalletAddress,
      minimum_usdt_deposit: settings.minimum_usdt_deposit,
    });
  } catch (err) {
    console.error('[deposit/usdt-addresses]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/mine', requireAuth, async (req, res) => {
  try {
    const deposits = await DepositRequest.findByUserId(req.user.id, { limit: 50 });
    res.json({ deposits: deposits.map(enrichDeposit) });
  } catch (err) {
    console.error('[deposit/mine]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Android MMK listener hook or authorized admin — never anonymous
router.post('/verify', requireListenerOrAdmin, async (req, res) => {
  try {
    const { ref_code, amount, txn_id, sender_phone } = req.body;

    if (!ref_code || amount == null || amount === '') {
      return res.status(400).json({ error: 'ref_code and amount are required' });
    }

    const result = await verifyByListener({ ref_code, amount, txn_id, sender_phone });

    if (result.alreadyVerified) {
      return res.json({
        success: true,
        message: 'Already verified',
        status: 'VERIFIED',
        user: { id: result.user.id, balance: result.user.balance },
      });
    }

    res.json({
      success: true,
      message: 'Deposit verified and balance credited',
      deposit: enrichDeposit(result.deposit),
      user: { id: result.user.id, balance: result.user.balance },
    });
  } catch (err) {
    console.error('[deposit/verify]', err.message || err);
    if (err.message === 'Deposit request not found') {
      return res.status(404).json({ error: err.message, ref_code: req.body.ref_code });
    }
    if (err.message === 'Amount mismatch' || err.code === 'TX_HASH_REUSED') {
      return res.status(400).json({ error: err.message });
    }
    if (/cannot be verified|USDT deposits cannot/i.test(err.message || '')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/status/:ref_code', requireAuth, async (req, res) => {
  try {
    let deposit = await DepositRequest.findByRefCode(req.params.ref_code);
    if (!deposit) return res.status(404).json({ error: 'Deposit not found' });
    if (deposit.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    let autoVerify = null;
    const isUsdt = deposit.purpose === 'usdt_topup' || deposit.deposit_currency === 'USDT';
    const hash = String(deposit.tx_hash || deposit.txn_id || deposit.kpay_transaction_id || '').trim();
    if (
      isUsdt
      && hash
      && ['SUBMITTED', 'UNDER_REVIEW', 'PENDING'].includes(deposit.status)
    ) {
      try {
        autoVerify = await retryVerifySubmittedUsdtDeposit(deposit.id, { userId: req.user.id });
        deposit = autoVerify.deposit || await DepositRequest.findById(deposit.id);
      } catch (err) {
        console.warn('[deposit/status] re-verify skipped:', err.message);
      }
    }

    res.json({
      deposit: enrichDeposit(deposit),
      auto_verify: autoVerify
        ? {
            auto_verified: Boolean(autoVerify.autoVerified),
            pending: Boolean(autoVerify.pending),
            message: autoVerify.message || null,
          }
        : null,
    });
  } catch (err) {
    console.error('[deposit/status]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
