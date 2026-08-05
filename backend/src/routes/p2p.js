const express = require('express');
const P2PBuyOrder = require('../models/P2PBuyOrder');
const P2PSellOrder = require('../models/P2PSellOrder');
const { requireAuth } = require('../middleware/auth');
const { uploadP2pAttachment, publicP2pUploadPath, saveP2pProofFromBase64 } = require('../middleware/upload');
const { listP2pMarket } = require('../services/p2pMarketService');
const {
  createP2pBuyOrder,
  confirmMmkTransfer,
  releaseP2pBuyOrderByMaker,
  listP2pBuyOrdersForUser,
  getP2pFeeInfo,
} = require('../services/p2pBuyOrderService');
const {
  createP2pAd,
  cancelP2pAd,
  listMyP2pAds,
} = require('../services/p2pAdService');
const {
  createP2pSellOrder,
  confirmMmkAndReleaseUsdt,
  cancelP2pSellOrder,
  listP2pSellOrdersForUser,
} = require('../services/p2pSellOrderService');
const { listActiveP2pOrdersForUser, getActiveP2pOrderForUser } = require('../services/p2pActiveOrderService');
const { processExpiredP2pOrders } = require('../services/p2pOrderExpiryService');
const { openP2pBuyDispute, openP2pSellDispute } = require('../services/p2pDisputeService');
const { listOrderMessages, postOrderMessage } = require('../services/p2pOrderChatService');

const router = express.Router();

function handleP2pRouteError(err, res, fallback = 'Request failed') {
  if (err.code === 'KYC_REQUIRED') {
    return res.status(403).json({
      error: err.message,
      code: 'KYC_REQUIRED',
      kyc_status: err.kyc_status || 'UNVERIFIED',
    });
  }
  if (err.code === 'INSUFFICIENT_USDT_BALANCE') {
    return res.status(400).json({
      error: err.message,
      required_usdt: err.required_usdt,
      available_usdt: err.available_usdt,
    });
  }
  return res.status(400).json({ error: err.message || fallback });
}

async function runExpirySweep(_req, _res, next) {
  try {
    await processExpiredP2pOrders();
  } catch (err) {
    console.error('[p2p/expiry-sweep]', err);
  }
  next();
}

router.use(runExpirySweep);

router.get('/market', requireAuth, async (req, res) => {
  try {
    const side = req.query.side || 'sell';
    const network = req.query.network;
    const market = await listP2pMarket({ side, network });
    const feeInfo = await getP2pFeeInfo();
    res.json({ success: true, ...market, fee_info: feeInfo });
  } catch (err) {
    console.error('[p2p/market]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/fee-info', requireAuth, async (_req, res) => {
  try {
    const feeInfo = await getP2pFeeInfo();
    res.json({ success: true, ...feeInfo });
  } catch (err) {
    console.error('[p2p/fee-info]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/active-orders', requireAuth, async (req, res) => {
  try {
    const orders = await listActiveP2pOrdersForUser(req.user.id);
    res.json({ success: true, orders });
  } catch (err) {
    console.error('[p2p/active-orders]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/active-orders/:orderType/:id', requireAuth, async (req, res) => {
  try {
    const { orderType, id } = req.params;
    if (!['buy', 'sell'].includes(orderType)) {
      return res.status(400).json({ error: 'Invalid order type' });
    }
    const order = await getActiveP2pOrderForUser(req.user.id, orderType, id);
    if (!order) {
      return res.status(404).json({ error: 'Active order not found' });
    }
    res.json({ success: true, order });
  } catch (err) {
    console.error('[p2p/active-orders/:type/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/orders/:orderType/:id/messages', requireAuth, async (req, res) => {
  try {
    const { orderType, id } = req.params;
    if (!['buy', 'sell'].includes(orderType)) {
      return res.status(400).json({ error: 'Invalid order type' });
    }
    const messages = await listOrderMessages(orderType, parseInt(id, 10), req.user.id);
    res.json({ success: true, messages });
  } catch (err) {
    console.error('[p2p/messages GET]', err);
    res.status(400).json({ error: err.message || 'Failed to load messages' });
  }
});

router.post('/orders/:orderType/:id/messages', requireAuth, uploadP2pAttachment.single('attachment'), async (req, res) => {
  try {
    const { orderType, id } = req.params;
    if (!['buy', 'sell'].includes(orderType)) {
      return res.status(400).json({ error: 'Invalid order type' });
    }
    const attachmentPath = req.file ? publicP2pUploadPath(req.file.filename) : null;
    const message = await postOrderMessage(orderType, parseInt(id, 10), req.user.id, {
      message: req.body.message,
      attachmentPath,
      txRef: req.body.tx_ref || req.body.txRef,
    });
    res.json({ success: true, message });
  } catch (err) {
    console.error('[p2p/messages POST]', err);
    res.status(400).json({ error: err.message || 'Failed to send message' });
  }
});

router.post('/orders/:orderType/:id/dispute', requireAuth, uploadP2pAttachment.single('proof'), async (req, res) => {
  try {
    const { orderType, id } = req.params;
    const orderId = parseInt(id, 10);
    const proofPath = req.file ? publicP2pUploadPath(req.file.filename) : null;
    const payload = {
      reason: req.body.reason,
      proofPath,
      txRef: req.body.tx_ref || req.body.txRef,
    };

    let mappedOrder;
    if (orderType === 'buy') {
      order = await openP2pBuyDispute(orderId, req.user.id, payload);
      mappedOrder = P2PBuyOrder.mapForClient(order);
    } else if (orderType === 'sell') {
      order = await openP2pSellDispute(orderId, req.user.id, payload);
      mappedOrder = P2PSellOrder.mapForClient(order);
    } else {
      return res.status(400).json({ error: 'Invalid order type' });
    }

    res.json({
      success: true,
      order: mappedOrder,
      message: 'Dispute opened — escrow locked pending admin review.',
    });
  } catch (err) {
    console.error('[p2p/dispute POST]', err);
    res.status(400).json({ error: err.message || 'Failed to open dispute' });
  }
});

router.get('/buy-orders', requireAuth, async (req, res) => {
  try {
    const orders = await listP2pBuyOrdersForUser(req.user.id);
    res.json({ success: true, orders });
  } catch (err) {
    console.error('[p2p/buy-orders GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/buy-orders', requireAuth, async (req, res) => {
  try {
    if (req.body.pay_from_wallet || req.body.use_mmk_wallet || req.body.wallet_type === 'mmk') {
      return res.status(400).json({
        error: 'P2P buy orders use external KPay/WavePay/Bank payment only — internal MMK wallet is not used.',
      });
    }
    const result = await createP2pBuyOrder(req.user.id, req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[p2p/buy-orders POST]', err);
    handleP2pRouteError(err, res, 'Failed to create buy order');
  }
});

router.post('/buy-orders/:id/confirm-transfer', requireAuth, uploadP2pAttachment.single('proof'), async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const txRef = req.body.tx_ref || req.body.txRef || req.body.payment_tx_ref || null;

    let proofPath;
    let proofOriginalName;
    let proofMimeType;

    if (req.file) {
      proofPath = publicP2pUploadPath(req.file.filename);
      proofOriginalName = req.file.originalname;
      proofMimeType = req.file.mimetype;
    } else {
      const base64 = req.body.proof_base64 || req.body.payment_proof_base64;
      if (base64) {
        const saved = saveP2pProofFromBase64(base64, {
          originalName: req.body.proof_filename || req.body.payment_proof_filename || 'receipt.jpg',
        });
        proofPath = saved.proofPath;
        proofOriginalName = saved.originalName;
        proofMimeType = saved.mimeType;
      }
    }

    if (!proofPath) {
      return res.status(400).json({
        error: 'Payment receipt screenshot is required — upload a payslip or transfer screenshot',
        code: 'PAYMENT_PROOF_REQUIRED',
      });
    }

    const result = await confirmMmkTransfer(orderId, req.user.id, {
      proofPath,
      proofOriginalName,
      proofMimeType,
      txRef,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[p2p/buy-orders confirm]', err);
    res.status(400).json({ error: err.message || 'Failed to confirm transfer' });
  }
});

router.post('/buy-orders/:id/release', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const result = await releaseP2pBuyOrderByMaker(orderId, req.user.id);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[p2p/buy-orders release]', err);
    res.status(400).json({ error: err.message || 'Failed to release USDT' });
  }
});

router.get('/ads', requireAuth, async (req, res) => {
  try {
    const ads = await listMyP2pAds(req.user.id);
    res.json({ success: true, ads });
  } catch (err) {
    console.error('[p2p/ads GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/ads', requireAuth, async (req, res) => {
  try {
    const result = await createP2pAd(req.user.id, req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[p2p/ads POST]', err);
    handleP2pRouteError(err, res, 'Failed to create ad');
  }
});

router.post('/ads/:id/cancel', requireAuth, async (req, res) => {
  try {
    const adId = parseInt(req.params.id, 10);
    const result = await cancelP2pAd(req.user.id, adId);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[p2p/ads cancel]', err);
    res.status(400).json({ error: err.message || 'Failed to cancel ad' });
  }
});

router.get('/sell-orders', requireAuth, async (req, res) => {
  try {
    const orders = await listP2pSellOrdersForUser(req.user.id);
    res.json({ success: true, orders });
  } catch (err) {
    console.error('[p2p/sell-orders GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/sell-orders', requireAuth, async (req, res) => {
  try {
    const result = await createP2pSellOrder(req.user.id, req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[p2p/sell-orders POST]', err);
    handleP2pRouteError(err, res, 'Failed to create sell order');
  }
});

router.post('/sell-orders/:id/confirm-mmk-and-release', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const result = await confirmMmkAndReleaseUsdt(orderId, req.user.id);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[p2p/sell-orders confirm-release]', err);
    res.status(400).json({ error: err.message || 'Failed to confirm MMK and release USDT' });
  }
});

router.post('/sell-orders/:id/cancel', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const result = await cancelP2pSellOrder(orderId, req.user.id);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[p2p/sell-orders cancel]', err);
    res.status(400).json({ error: err.message || 'Failed to cancel sell order' });
  }
});

module.exports = router;
