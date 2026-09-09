const express = require('express');
const { requireAuth } = require('../middleware/auth');
const SupportThread = require('../models/SupportThread');
const SupportMessage = require('../models/SupportMessage');
const {
  SUPPORT_MAIN_CATEGORIES,
  normalizeSupportCategory,
  normalizeSupportPriority,
} = require('../constants/supportTasks');

const router = express.Router();

router.get('/threads', requireAuth, async (req, res) => {
  try {
    const threads = await SupportThread.findByUserId(req.user.id);
    res.json({ threads });
  } catch (err) {
    console.error('[support/threads]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/threads', requireAuth, async (req, res) => {
  try {
    const { subject, category, priority, message } = req.body || {};

    if (!message?.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    const cat = normalizeSupportCategory(category, { fallback: 'mmk_payouts' });
    if (!SUPPORT_MAIN_CATEGORIES.includes(cat)) {
      return res.status(400).json({
        error: 'category must be mmk_payouts (MMK Payouts) or card_issuing (Card Issuing Issues)',
      });
    }
    const pri = normalizeSupportPriority(priority, { fallback: 'medium' });
    if (priority && !['high', 'medium', 'low', 'urgent', 'normal'].includes(String(priority).toLowerCase())) {
      return res.status(400).json({ error: 'priority must be high, medium, or low' });
    }

    const thread = await SupportThread.create({
      userId: req.user.id,
      subject: subject || 'Support request',
      category: cat,
      priority: pri,
      status: 'pending',
    });

    const msg = await SupportMessage.create({
      threadId: thread.id,
      senderType: 'user',
      senderId: req.user.id,
      message: message.trim(),
    });

    res.json({ success: true, thread, message: msg });
  } catch (err) {
    console.error('[support/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/threads/:id/messages', requireAuth, async (req, res) => {
  try {
    const threadId = parseInt(req.params.id, 10);
    const thread = await SupportThread.findById(threadId);

    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (thread.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const messages = await SupportMessage.findByThreadId(threadId);
    await SupportMessage.markReadByUser(threadId);

    res.json({ thread, messages });
  } catch (err) {
    console.error('[support/messages]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/threads/:id/messages', requireAuth, async (req, res) => {
  try {
    const threadId = parseInt(req.params.id, 10);
    const { message } = req.body;

    const thread = await SupportThread.findById(threadId);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (thread.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (thread.status === 'completed' || thread.status === 'closed' || thread.status === 'failed') {
      return res.status(400).json({ error: 'Thread is closed' });
    }

    const msg = await SupportMessage.create({
      threadId,
      senderType: 'user',
      senderId: req.user.id,
      message: message.trim(),
    });

    res.json({ success: true, message: msg });
  } catch (err) {
    console.error('[support/reply]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
