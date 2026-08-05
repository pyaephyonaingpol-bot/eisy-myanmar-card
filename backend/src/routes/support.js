const express = require('express');
const { requireAuth } = require('../middleware/auth');
const SupportThread = require('../models/SupportThread');
const SupportMessage = require('../models/SupportMessage');

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
    const { subject, category, message } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    const thread = await SupportThread.create({
      userId: req.user.id,
      subject: subject || 'Support request',
      category: category || 'general',
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
    if (thread.status === 'closed') {
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
