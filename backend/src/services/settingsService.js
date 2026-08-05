const { getDb } = require('../db');
const ExchangeRateHistory = require('../models/ExchangeRateHistory');
const {
  getCardReloadFeeBreakdown,
  CARD_RELOAD_USER_FEE_USD,
} = require('../constants/cardReloadFees');

const DEFAULTS = {
  card_issuance_fee_usd: '5.00',
  minimum_initial_deposit_usd: '10.00',
  card_reload_fee_usd: '3.50',
  card_reload_provider_cost_usd: '1.50',
  card_reload_net_profit_usd: '2.00',
  minimum_card_reload_mmk: '10000',
  minimum_usdt_deposit: '5.00',
  minimum_usdt_reload: '5.00',
  p2p_seller_fee_percent: '1.0',
  platform_usdt_revenue_balance: '0',
  mmk_to_usd_rate: String(process.env.MMK_TO_USD_RATE || '4500'),
  rate_effective_date: new Date().toISOString().slice(0, 10),
  usdt_trc20_address: process.env.USDT_TRC20_ADDRESS || 'TExampleTrc20Address1234567890',
  usdt_bep20_address: process.env.USDT_BEP20_ADDRESS || '0xExampleBep20Address1234567890abcdef',
  usdt_withdraw_fee_trc20: '1.5',
  usdt_withdraw_fee_bep20: '0.8',
  usdt_withdraw_fee_trc20_type: 'fixed',
  usdt_withdraw_fee_bep20_type: 'fixed',
  minimum_usdt_withdrawal: '10',
};

const NUMERIC_KEYS = new Set([
  'card_issuance_fee_usd',
  'minimum_initial_deposit_usd',
  'card_reload_fee_usd',
  'card_reload_provider_cost_usd',
  'card_reload_net_profit_usd',
  'minimum_card_reload_mmk',
  'minimum_usdt_deposit',
  'minimum_usdt_reload',
  'mmk_to_usd_rate',
  'p2p_seller_fee_percent',
  'platform_usdt_revenue_balance',
  'usdt_withdraw_fee_trc20',
  'usdt_withdraw_fee_bep20',
  'minimum_usdt_withdrawal',
]);

const STRING_KEYS = new Set([
  'usdt_trc20_address',
  'usdt_bep20_address',
  'usdt_withdraw_fee_trc20_type',
  'usdt_withdraw_fee_bep20_type',
]);

const FEE_TYPE_KEYS = new Set([
  'usdt_withdraw_fee_trc20_type',
  'usdt_withdraw_fee_bep20_type',
]);

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeEffectiveAt(effectiveDate) {
  const date = (effectiveDate || todayDateString()).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return `${date}T12:00:00`;
  }
  return date;
}

function formatEffectiveDate(effectiveAt) {
  if (!effectiveAt) return todayDateString();
  return String(effectiveAt).slice(0, 10);
}

async function getSetting(key) {
  const db = getDb();
  const row = await db.get('SELECT value FROM app_settings WHERE key = ?', key);
  if (row) return row.value;
  return DEFAULTS[key] ?? null;
}

async function setSetting(key, value) {
  const db = getDb();
  await db.run(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `, key, String(value));
}

async function getAllSettings() {
  const db = getDb();
  const rows = await db.all('SELECT key, value, updated_at FROM app_settings ORDER BY key');
  const map = { ...DEFAULTS };
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

async function getCardPricingSettings() {
  const raw = await getAllSettings();
  return {
    card_issuance_fee_usd: parseFloat(raw.card_issuance_fee_usd) || 5,
    minimum_initial_deposit_usd: parseFloat(raw.minimum_initial_deposit_usd) || 10,
    card_reload_fee_usd: parseFloat(raw.card_reload_fee_usd) || CARD_RELOAD_USER_FEE_USD,
    card_reload_provider_cost_usd: parseFloat(raw.card_reload_provider_cost_usd) || 1.5,
    card_reload_net_profit_usd: parseFloat(raw.card_reload_net_profit_usd) || 2,
    minimum_card_reload_mmk: parseFloat(raw.minimum_card_reload_mmk) || 10000,
    minimum_usdt_deposit: parseFloat(raw.minimum_usdt_deposit) || 5,
    minimum_usdt_reload: parseFloat(raw.minimum_usdt_reload) || 5,
    mmk_to_usd_rate: parseFloat(raw.mmk_to_usd_rate) || 4500,
    rate_effective_date: raw.rate_effective_date || todayDateString(),
    usdt_trc20_address: raw.usdt_trc20_address || DEFAULTS.usdt_trc20_address,
    usdt_bep20_address: raw.usdt_bep20_address || DEFAULTS.usdt_bep20_address,
    p2p_seller_fee_percent: parseFloat(raw.p2p_seller_fee_percent) || 1,
    platform_usdt_revenue_balance: parseFloat(raw.platform_usdt_revenue_balance) || 0,
    usdt_withdraw_fee_trc20: parseFloat(raw.usdt_withdraw_fee_trc20) || 1.5,
    usdt_withdraw_fee_bep20: parseFloat(raw.usdt_withdraw_fee_bep20) || 0.8,
    usdt_withdraw_fee_trc20_type: raw.usdt_withdraw_fee_trc20_type === 'percent' ? 'percent' : 'fixed',
    usdt_withdraw_fee_bep20_type: raw.usdt_withdraw_fee_bep20_type === 'percent' ? 'percent' : 'fixed',
    minimum_usdt_withdrawal: parseFloat(raw.minimum_usdt_withdrawal) || 10,
  };
}

async function getWithdrawalFeeSettings() {
  const pricing = await getCardPricingSettings();
  return {
    usdt_withdraw_fee_trc20: pricing.usdt_withdraw_fee_trc20,
    usdt_withdraw_fee_bep20: pricing.usdt_withdraw_fee_bep20,
    usdt_withdraw_fee_trc20_type: pricing.usdt_withdraw_fee_trc20_type,
    usdt_withdraw_fee_bep20_type: pricing.usdt_withdraw_fee_bep20_type,
    minimum_usdt_withdrawal: pricing.minimum_usdt_withdrawal,
  };
}

function calculateNetworkWithdrawalFee(amountUsdt, network, settings) {
  const amount = Math.round((parseFloat(amountUsdt) || 0) * 100) / 100;
  const net = String(network || 'TRC20').toUpperCase();
  const isBep20 = net === 'BEP20';
  const feeValue = isBep20
    ? (parseFloat(settings?.usdt_withdraw_fee_bep20) || 0)
    : (parseFloat(settings?.usdt_withdraw_fee_trc20) || 0);
  const feeType = isBep20
    ? (settings?.usdt_withdraw_fee_bep20_type === 'percent' ? 'percent' : 'fixed')
    : (settings?.usdt_withdraw_fee_trc20_type === 'percent' ? 'percent' : 'fixed');

  let feeUsdt = 0;
  if (feeType === 'percent') {
    feeUsdt = Math.round(amount * feeValue) / 100;
  } else {
    feeUsdt = Math.round(feeValue * 100) / 100;
  }

  feeUsdt = Math.round(feeUsdt * 100) / 100;
  const netUsdt = Math.round((amount - feeUsdt) * 100) / 100;

  const feeLabel = feeType === 'percent'
    ? `${feeValue}% (${feeUsdt.toFixed(2)} USDT)`
    : `${feeUsdt.toFixed(2)} USDT`;

  return {
    network: isBep20 ? 'BEP20' : 'TRC20',
    amount_usdt: amount,
    fee_usdt: feeUsdt,
    net_usdt: netUsdt,
    fee_type: feeType,
    fee_value: feeValue,
    fee_label: feeLabel,
  };
}

function calculateWithdrawalBreakdown(amountUsdt, network, settings) {
  const amount = parseFloat(amountUsdt);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Enter a valid USDT withdrawal amount');
  }

  const breakdown = calculateNetworkWithdrawalFee(amount, network, settings);
  const min = parseFloat(settings?.minimum_usdt_withdrawal) || 10;

  return {
    ...breakdown,
    minimum_usdt_withdrawal: min,
    below_minimum: amount < min,
    invalid_net: breakdown.net_usdt <= 0,
    summary: `Requested ${breakdown.amount_usdt.toFixed(2)} USDT − ${breakdown.fee_label} fee = ${breakdown.net_usdt.toFixed(2)} USDT sent`,
  };
}

function calculateP2pFeeBreakdown(amountUsdt, settings) {
  const buyerReceives = Math.round((parseFloat(amountUsdt) || 0) * 100) / 100;
  const feePercent = Math.round((parseFloat(settings?.p2p_seller_fee_percent) || 0) * 100) / 100;
  const platformFee = Math.round(buyerReceives * feePercent) / 100;
  const sellerTotalUsdt = Math.round((buyerReceives + platformFee) * 100) / 100;

  return {
    amount_usdt: buyerReceives,
    buyer_receives_usdt: buyerReceives,
    fee_percent: feePercent,
    buyer_fee_percent: 0,
    platform_fee_usdt: platformFee,
    seller_total_usdt: sellerTotalUsdt,
    net_usdt_to_buyer: buyerReceives,
    seller_fee_label: `Platform Fee: ${platformFee.toFixed(2)} USDT (Deducted from seller upon release)`,
    buyer_fee_label: '0% Fee for Buyers',
    buyer_fee_note: '0% Fee for Buyers. Seller pays platform fee upon release.',
  };
}

async function getUsdtDepositSettings() {
  const settings = await getCardPricingSettings();
  return {
    usdt_trc20_address: settings.usdt_trc20_address,
    usdt_bep20_address: settings.usdt_bep20_address,
    minimum_usdt_deposit: settings.minimum_usdt_deposit,
    minimum_usdt_reload: settings.minimum_usdt_reload,
  };
}

async function getCurrentRateSummary() {
  const pricing = await getCardPricingSettings();
  const latest = await ExchangeRateHistory.getLatest();

  const effectiveAt = latest?.effective_at || `${pricing.rate_effective_date}T12:00:00`;
  const effectiveDate = formatEffectiveDate(effectiveAt);

  return {
    mmk_to_usd_rate: pricing.mmk_to_usd_rate,
    card_issuance_fee_usd: pricing.card_issuance_fee_usd,
    minimum_initial_deposit_usd: pricing.minimum_initial_deposit_usd,
    card_reload_fee_usd: pricing.card_reload_fee_usd,
    minimum_card_reload_mmk: pricing.minimum_card_reload_mmk,
    effective_at: effectiveAt,
    effective_date: effectiveDate,
    updated_by: latest?.updated_by || 'admin',
    notes: latest?.notes || null,
    history_id: latest?.id || null,
  };
}

async function buildRateSnapshot() {
  const pricing = await getCardPricingSettings();
  const summary = await getCurrentRateSummary();
  return {
    mmk_to_usd_rate: pricing.mmk_to_usd_rate,
    card_issuance_fee_usd: pricing.card_issuance_fee_usd,
    minimum_initial_deposit_usd: pricing.minimum_initial_deposit_usd,
    effective_at: summary.effective_at,
    effective_date: summary.effective_date,
    history_id: summary.history_id,
  };
}

async function listExchangeRateHistory({ limit = 100 } = {}) {
  return ExchangeRateHistory.listRecent({ limit });
}

async function updateSettings(updates) {
  const {
    effective_date: effectiveDate,
    notes,
    updated_by: updatedBy,
    ...numericUpdates
  } = updates || {};

  const allowed = Object.keys(DEFAULTS).filter((k) => k !== 'rate_effective_date');

  for (const key of allowed) {
    if (numericUpdates[key] === undefined || numericUpdates[key] === null || numericUpdates[key] === '') continue;
    const strVal = String(numericUpdates[key]).trim();
    if (NUMERIC_KEYS.has(key)) {
      const num = parseFloat(strVal);
      if (!Number.isFinite(num) || num < 0) {
        throw new Error(`Invalid numeric value for ${key}`);
      }
      if (key === 'mmk_to_usd_rate' && num <= 0) {
        throw new Error('Exchange rate must be greater than zero');
      }
      if (key === 'p2p_seller_fee_percent' && (num < 0 || num > 10)) {
        throw new Error('P2P seller fee must be between 0% and 10%');
      }
      if ((key === 'usdt_withdraw_fee_trc20' || key === 'usdt_withdraw_fee_bep20') && num < 0) {
        throw new Error(`${key} must be zero or greater`);
      }
      if (key === 'minimum_usdt_withdrawal' && num <= 0) {
        throw new Error('Minimum USDT withdrawal must be greater than zero');
      }
      await setSetting(key, num);
    } else if (FEE_TYPE_KEYS.has(key)) {
      const normalized = strVal.toLowerCase();
      if (normalized !== 'fixed' && normalized !== 'percent') {
        throw new Error(`${key} must be "fixed" or "percent"`);
      }
      await setSetting(key, normalized);
    } else if (STRING_KEYS.has(key)) {
      if (!strVal) throw new Error(`Invalid value for ${key}`);
      await setSetting(key, strVal);
    } else {
      await setSetting(key, strVal);
    }
  }

  const pricing = await getCardPricingSettings();
  const effDate = effectiveDate || todayDateString();
  const effectiveAt = normalizeEffectiveAt(effDate);

  await setSetting('rate_effective_date', effDate);

  const historyEntry = await ExchangeRateHistory.create({
    effectiveAt,
    mmkToUsdRate: pricing.mmk_to_usd_rate,
    cardIssuanceFeeUsd: pricing.card_issuance_fee_usd,
    minimumInitialDepositUsd: pricing.minimum_initial_deposit_usd,
    updatedBy: updatedBy || 'admin',
    notes: notes || null,
  });

  return {
    pricing,
    current_rate: await getCurrentRateSummary(),
    history_entry: historyEntry,
  };
}

function calculateCardReloadPricing(topUpMmk, settings) {
  const mmk = parseFloat(topUpMmk);
  const rate = settings.mmk_to_usd_rate;
  const minMmk = settings.minimum_card_reload_mmk;
  const fees = getCardReloadFeeBreakdown();

  if (!Number.isFinite(mmk) || mmk <= 0) {
    throw new Error('Top-up amount must be a positive number');
  }
  if (mmk < minMmk) {
    throw new Error(`Minimum top-up amount is ${minMmk.toLocaleString()} MMK`);
  }

  const topUpUsd = Math.round((mmk / rate) * 100) / 100;
  const totalWalletUsd = Math.round((topUpUsd + fees.reload_fee_usd) * 100) / 100;
  const totalWalletMmk = Math.ceil(totalWalletUsd * rate);

  return {
    top_up_mmk: Math.round(mmk),
    top_up_usd: topUpUsd,
    net_usd_to_card: topUpUsd,
    reload_fee_usd: fees.reload_fee_usd,
    provider_cost_usd: fees.provider_cost_usd,
    net_profit_usd: fees.net_profit_usd,
    total_wallet_usd: totalWalletUsd,
    total_wallet_mmk: totalWalletMmk,
    deposit_mmk: totalWalletMmk,
    gross_usd: topUpUsd,
    mmk_to_usd_rate: rate,
    rate_effective_date: settings.rate_effective_date || todayDateString(),
  };
}

function calculateCardRequestPricing(initialLoadUsd, settings) {
  const initial = parseFloat(initialLoadUsd);
  const fee = settings.card_issuance_fee_usd;
  const min = settings.minimum_initial_deposit_usd;
  const rate = settings.mmk_to_usd_rate;

  if (!Number.isFinite(initial) || initial <= 0) {
    throw new Error('Initial card load amount must be a positive number');
  }
  if (initial < min) {
    throw new Error(`Minimum initial deposit is $${min.toFixed(2)} USD`);
  }

  const totalUsd = initial + fee;
  const totalMmk = Math.ceil(totalUsd * rate);

  return {
    initial_load_usd: Math.round(initial * 100) / 100,
    issuance_fee_usd: Math.round(fee * 100) / 100,
    total_usd_required: Math.round(totalUsd * 100) / 100,
    total_mmk: totalMmk,
    mmk_to_usd_rate: rate,
    rate_effective_date: settings.rate_effective_date || todayDateString(),
  };
}

function calculateCardRequestPricingUsdt(initialLoadUsd, settings) {
  const initial = parseFloat(initialLoadUsd);
  const fee = settings.card_issuance_fee_usd;
  const min = settings.minimum_initial_deposit_usd;

  if (!Number.isFinite(initial) || initial <= 0) {
    throw new Error('Initial card load amount must be a positive number');
  }
  if (initial < min) {
    throw new Error(`Minimum initial deposit is $${min.toFixed(2)} USD`);
  }

  const totalUsd = initial + fee;
  const totalUsdt = Math.round(totalUsd * 100) / 100;

  return {
    initial_load_usd: Math.round(initial * 100) / 100,
    issuance_fee_usd: Math.round(fee * 100) / 100,
    total_usd_required: Math.round(totalUsd * 100) / 100,
    total_usdt: totalUsdt,
    payment_currency: 'USDT',
    exchange_rate_applied: false,
    note: '1 USDT ≈ 1 USD — no MMK exchange rate applied',
  };
}

function calculateCardReloadPricingUsdt(topUpUsdt, settings) {
  const topUp = parseFloat(topUpUsdt);
  const minTopUp = settings.minimum_usdt_reload ?? settings.minimum_initial_deposit_usd ?? 5;
  const fees = getCardReloadFeeBreakdown();

  if (!Number.isFinite(topUp) || topUp <= 0) {
    throw new Error('Top-up amount must be a positive number');
  }
  if (topUp < minTopUp) {
    throw new Error(`Minimum USDT top-up is $${minTopUp.toFixed(2)}`);
  }

  const topUpUsd = Math.round(topUp * 100) / 100;
  const totalWalletUsdt = Math.round((topUpUsd + fees.reload_fee_usd) * 100) / 100;

  return {
    top_up_usdt: topUpUsd,
    top_up_usd: topUpUsd,
    deposit_usdt: totalWalletUsdt,
    total_wallet_usd: totalWalletUsdt,
    total_wallet_usdt: totalWalletUsdt,
    net_usd_to_card: topUpUsd,
    reload_fee_usd: fees.reload_fee_usd,
    provider_cost_usd: fees.provider_cost_usd,
    net_profit_usd: fees.net_profit_usd,
    gross_usd: topUpUsd,
    payment_currency: 'USDT',
    exchange_rate_applied: false,
    note: '1 USDT ≈ 1 USD — $3.50 fixed service fee added on top',
  };
}

function parseRecordMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

module.exports = {
  DEFAULTS,
  getSetting,
  setSetting,
  getAllSettings,
  getCardPricingSettings,
  getCurrentRateSummary,
  buildRateSnapshot,
  listExchangeRateHistory,
  updateSettings,
  calculateCardRequestPricing,
  calculateCardReloadPricing,
  calculateCardRequestPricingUsdt,
  calculateCardReloadPricingUsdt,
  getUsdtDepositSettings,
  calculateP2pFeeBreakdown,
  getWithdrawalFeeSettings,
  calculateNetworkWithdrawalFee,
  calculateWithdrawalBreakdown,
  parseRecordMetadata,
  todayDateString,
  formatEffectiveDate,
};
