const express = require('express');
const { requireAuth, requireSensitive } = require('../middleware/auth');
const {
  getWalletOverview,
  getWalletTransactions,
  getWalletBalance,
  provisionCustodialAddresses,
  linkExternalAddress,
  unlinkExternalAddress,
  normalizeNetwork,
} = require('../services/usdtWalletService');
const { transferUsdtInternal, getUsdtBalances } = require('../services/usdtLedgerService');
const User = require('../models/User');

const router = express.Router();

router.get('/', requireAuth, requireSensitive, async (req, res) => {
  try {
    const includeOnChain = req.query.on_chain === '1' || req.query.on_chain === 'true';
    const overview = await getWalletOverview(req.user.id, { includeOnChain });
    res.json(overview);
  } catch (err) {
    console.error('[usdt-wallet/overview]', err);
    res.status(500).json({ error: 'Failed to load USDT wallet' });
  }
});

router.get('/balance', requireAuth, requireSensitive, async (req, res) => {
  try {
    const balance = await getWalletBalance(req.user.id);
    res.json(balance);
  } catch (err) {
    console.error('[usdt-wallet/balance]', err);
    res.status(500).json({ error: 'Failed to load balance' });
  }
});

router.post('/provision', requireAuth, async (req, res) => {
  try {
    const addresses = await provisionCustodialAddresses(req.user.id);
    res.json({
      ok: true,
      addresses: addresses.map((row) => ({
        id: row.id,
        network: row.network,
        address: row.address,
        deposit_reference: row.deposit_reference,
      })),
    });
  } catch (err) {
    console.error('[usdt-wallet/provision]', err);
    res.status(500).json({ error: err.message || 'Failed to provision deposit addresses' });
  }
});

router.post('/link', requireAuth, async (req, res) => {
  try {
    const { network, address, label } = req.body || {};
    const linked = await linkExternalAddress(req.user.id, { network, address, label });
    res.status(201).json({
      ok: true,
      address: {
        id: linked.id,
        network: linked.network,
        address: linked.address,
        label: linked.label,
        address_type: linked.address_type,
      },
    });
  } catch (err) {
    const status = err.code === 'ADDRESS_ALREADY_LINKED' ? 409 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/link/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid address id' });
    }
    await unlinkExternalAddress(req.user.id, id);
    res.json({ ok: true });
  } catch (err) {
    const status = err.code === 'ADDRESS_NOT_FOUND' ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.get('/transactions', requireAuth, requireSensitive, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const network = req.query.network ? normalizeNetwork(req.query.network) : null;
    const transactions = await getWalletTransactions(req.user.id, { limit, offset, network });
    res.json({ transactions });
  } catch (err) {
    console.error('[usdt-wallet/transactions]', err);
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

router.post('/transfer', requireAuth, requireSensitive, async (req, res) => {
  try {
    const { to_user_id, to_email, amount_usdt, note, idempotency_key } = req.body || {};
    let recipientId = parseInt(to_user_id, 10);

    if (!Number.isFinite(recipientId) && to_email) {
      const recipient = await User.findByEmail(String(to_email).trim().toLowerCase());
      if (!recipient) {
        return res.status(404).json({ error: 'Recipient not found' });
      }
      recipientId = recipient.id;
    }

    if (!Number.isFinite(recipientId)) {
      return res.status(400).json({ error: 'Provide to_user_id or to_email' });
    }

    const result = await transferUsdtInternal(req.user.id, recipientId, amount_usdt, {
      idempotencyKey: idempotency_key || null,
      note: note || null,
      createdBy: 'user',
    });

    const balances = await getUsdtBalances(req.user.id);

    res.status(result.duplicate ? 200 : 201).json({
      ok: true,
      duplicate: Boolean(result.duplicate),
      transfer: result.transfer,
      journal_id: result.journal_id || result.transfer?.journal_id,
      wallet: balances,
    });
  } catch (err) {
    const status = err.code === 'INSUFFICIENT_USDT_BALANCE' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.get('/linked/:id/balance', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid address id' });
    }
    const { UserUsdtWalletAddress } = require('../models/UserUsdtWalletAddress');
    const row = await UserUsdtWalletAddress.findById(id);
    if (!row || row.user_id !== req.user.id || row.address_type !== 'linked') {
      return res.status(404).json({ error: 'Linked address not found' });
    }
    const { fetchUsdtOnChainBalance } = require('../services/usdtBlockchainService');
    const result = await fetchUsdtOnChainBalance(row.network, row.address);
    res.json({
      address_id: row.id,
      network: row.network,
      address: row.address,
      ...result,
    });
  } catch (err) {
    console.error('[usdt-wallet/linked-balance]', err);
    res.status(500).json({ error: 'Failed to fetch on-chain balance' });
  }
});

module.exports = router;
