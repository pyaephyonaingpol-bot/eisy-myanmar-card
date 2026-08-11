const express = require('express');
const fs = require('fs');
const { requireAuth, requireSensitive } = require('../middleware/auth');
const { uploadDepositScreenshot, publicUploadPath, saveDepositScreenshotFromBase64 } = require('../middleware/upload');
const DepositRequest = require('../models/DepositRequest');
const {
  createDepositRequest,
  createUsdtDepositRequest,
  submitAndAutoVerifyUsdtDeposit,
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

const router = express.Router();

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

    const { amount_mmk, payment_method, purpose } = req.body;

    if (!amount_mmk || amount_mmk <= 0) {
      return res.status(400).json({ error: 'Positive amount_mmk is required' });
    }

    const method = payment_method || 'KBZPay';
    if (!['KBZPay', 'WavePay', 'KPay', 'Other'].includes(method)) {
      return res.status(400).json({ error: 'Invalid payment_method' });
    }

    const deposit = await createDepositRequest(userId, {
      amount_mmk,
      payment_method: method,
      purpose: purpose || 'topup',
      metadata: req.body.metadata,
    });

    const rate = await getExchangeRate();
    const enriched = enrichDeposit(deposit);
    const feeInfo = enriched?.pricing_breakdown || enriched?.metadata?.payment_fee;

    res.json({
      success: true,
      deposit: enriched,
      fee_breakdown: feeInfo || null,
      payment_instructions: {
        message: `Send exactly ${Number(amount_mmk).toLocaleString()} MMK via ${deposit.payment_method}`,
        ref_code: deposit.ref_code,
        note: purpose === 'topup' || !purpose
          ? `Include reference code ${deposit.ref_code}. Service fee is max(2%, min $1 MMK-equivalent); net credit after approval.`
          : `Include reference code ${deposit.ref_code} in the payment note/description`,
        kbzpay: 'Transfer to Eisy Myanmar KBZPay account, then submit your transaction ID below.',
        wavepay: 'Transfer to Eisy Myanmar WavePay account, then submit your transaction ID below.',
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

router.get('/usdt-addresses', requireAuth, async (_req, res) => {
  try {
    const settings = await getUsdtDepositSettings();
    res.json({
      networks: [
        { id: 'TRC20', label: 'TRC20 (Tron)', address: settings.usdt_trc20_address },
        { id: 'BEP20', label: 'BEP20 (BSC)', address: settings.usdt_bep20_address },
      ],
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

// Public — called by Android notification listener
router.post('/verify', async (req, res) => {
  try {
    const { ref_code, amount, txn_id, sender_phone } = req.body;

    if (!ref_code || !amount) {
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
    console.error('[deposit/verify]', err);
    if (err.message === 'Deposit request not found') {
      return res.status(404).json({ error: err.message, ref_code: req.body.ref_code });
    }
    if (err.message === 'Amount mismatch') {
      return res.status(400).json({ error: 'Amount mismatch' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/status/:ref_code', requireAuth, async (req, res) => {
  try {
    const deposit = await DepositRequest.findByRefCode(req.params.ref_code);
    if (!deposit) return res.status(404).json({ error: 'Deposit not found' });
    if (deposit.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json({ deposit: enrichDeposit(deposit) });
  } catch (err) {
    console.error('[deposit/status]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
