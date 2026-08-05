const User = require('../models/User');
const P2PAd = require('../models/P2PAd');
const { getCardPricingSettings } = require('./settingsService');

function parsePaymentMethods(raw) {
  if (!raw) return ['KPay', 'WavePay', 'KBZ Bank'];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : ['KPay', 'WavePay'];
  } catch (_) {
    return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  }
}

async function listP2pMarket({ side = 'sell', network } = {}) {
  const settings = await getCardPricingSettings();
  const defaultRate = settings.mmk_to_usd_rate || 4500;
  const normalizedSide = side === 'buy' ? 'buy' : 'sell';

  const rows = await P2PAd.listActive({ side: normalizedSide, network });
  const listings = [];

  for (const row of rows) {
    const available = Number(row.available_volume_usdt || 0);
    const minOrder = Number(row.min_order_usdt || 5);
    if (available < minOrder) continue;

    const user = await User.findById(row.user_id);
    listings.push(P2PAd.mapForClient(row, { user }));
  }

  listings.sort((a, b) => {
    if (normalizedSide === 'sell') {
      return a.price_mmk_per_usdt - b.price_mmk_per_usdt;
    }
    return b.price_mmk_per_usdt - a.price_mmk_per_usdt;
  });

  return {
    side: normalizedSide,
    default_rate_mmk: defaultRate,
    listings,
    marketplace_type: 'c2c',
  };
}

module.exports = {
  listP2pMarket,
  parsePaymentMethods,
};
