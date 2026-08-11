const { parseRecordMetadata } = require('./settingsService');

function getProofType(mimeType) {
  if (!mimeType) return null;
  if (String(mimeType).startsWith('video/')) return 'video';
  if (String(mimeType).startsWith('image/')) return 'image';
  return null;
}

function inferPricingBreakdown(deposit, metadata, settings) {
  const amountUsd = Number(deposit.amount_usd) || 0;
  const amountMmk = Number(deposit.amount_mmk) || 0;
  const rate = amountUsd > 0
    ? Math.round(amountMmk / amountUsd)
    : (settings?.mmk_to_usd_rate || 4500);

  const purpose = deposit.purpose || metadata.purpose || 'topup';

  if (purpose === 'card_issuance') {
    const fee = settings?.card_issuance_fee_usd ?? 5;
    const initial = Math.max(0, Math.round((amountUsd - fee) * 100) / 100);
    return {
      initial_load_usd: initial,
      issuance_fee_usd: fee,
      total_usd_required: amountUsd,
      total_mmk: amountMmk,
      mmk_to_usd_rate: rate,
      card_request_id: metadata.card_request_id || null,
      inferred: true,
    };
  }

  if (purpose === 'card_reload') {
    const pricing = metadata.pricing || {};
    const fees = pricing.reload_fee_usd ?? settings?.card_reload_fee_usd ?? 3.5;
    const topUpUsd = pricing.top_up_usd ?? pricing.net_usd_to_card ?? Math.max(0, (pricing.gross_usd ?? amountUsd));
    const totalWalletUsd = pricing.total_wallet_usd ?? Math.round((topUpUsd + fees) * 100) / 100;
    return {
      deposit_mmk: pricing.deposit_mmk ?? amountMmk,
      top_up_usd: topUpUsd,
      gross_usd: topUpUsd,
      reload_fee_usd: fees,
      provider_cost_usd: pricing.provider_cost_usd ?? 1.5,
      net_profit_usd: pricing.net_profit_usd ?? 2,
      total_wallet_usd: totalWalletUsd,
      net_usd_to_card: topUpUsd,
      mmk_to_usd_rate: pricing.mmk_to_usd_rate || rate,
      card_id: metadata.card_id || pricing.card_id || null,
      card_label: metadata.card_label || pricing.card_label || null,
      inferred: !metadata.pricing,
    };
  }

  if (purpose === 'usdt_topup') {
    return {
      amount_usdt: metadata.amount_usdt ?? amountUsd,
      gross_usdt: metadata.payment_fee?.gross_usdt ?? metadata.pricing?.gross_usdt ?? metadata.amount_usdt ?? amountUsd,
      fee_usdt: metadata.payment_fee?.fee_usdt ?? metadata.pricing?.fee_usdt ?? null,
      net_usdt: metadata.payment_fee?.net_usdt ?? metadata.pricing?.net_usdt ?? null,
      fee_percent: metadata.payment_fee?.fee_percent ?? metadata.pricing?.fee_percent ?? null,
      fee_label: metadata.payment_fee?.fee_label ?? metadata.pricing?.fee_label ?? null,
      fee_rule: metadata.payment_fee?.fee_rule || 'Math.max(amount * 0.02, 1)',
      deposit_currency: 'USDT',
      usdt_network: metadata.usdt_network || deposit.usdt_network || null,
      deposit_address: metadata.deposit_address || null,
      deposit_channel: metadata.deposit_channel || 'platform_direct',
      p2p_seller_id: metadata.p2p_seller_id || null,
      p2p_seller_name: metadata.p2p_seller_name || null,
      p2p_status: metadata.p2p_status || null,
      is_usdt_topup: true,
      is_p2p: metadata.deposit_channel === 'p2p',
      inferred: true,
    };
  }

  if (purpose === 'topup' && metadata.payment_fee) {
    return {
      initial_load_usd: amountUsd,
      issuance_fee_usd: 0,
      total_usd_required: amountUsd,
      total_mmk: amountMmk,
      gross_mmk: metadata.payment_fee.gross_mmk ?? amountMmk,
      fee_mmk: metadata.payment_fee.fee_mmk,
      net_mmk: metadata.payment_fee.net_mmk,
      fee_percent: metadata.payment_fee.fee_percent,
      fee_label: metadata.payment_fee.fee_label,
      fee_rule: metadata.payment_fee.fee_rule || 'Math.max(amount * 0.02, 1)',
      mmk_to_usd_rate: rate,
      inferred: true,
      is_wallet_topup: true,
    };
  }

  return {
    initial_load_usd: amountUsd,
    issuance_fee_usd: 0,
    total_usd_required: amountUsd,
    total_mmk: amountMmk,
    mmk_to_usd_rate: rate,
    inferred: true,
    is_wallet_topup: true,
  };
}

function resolvePricingBreakdown(deposit, settings) {
  const metadata = parseRecordMetadata(deposit.metadata);
  const purpose = deposit.purpose || metadata.purpose || 'topup';

  const pricing = metadata.pricing || null;
  const rateSnapshot = metadata.rate_snapshot || null;
  if (pricing && pricing.total_usd_required != null) {
    return {
      ...pricing,
      mmk_to_usd_rate: pricing.mmk_to_usd_rate
        || rateSnapshot?.mmk_to_usd_rate
        || (deposit.amount_usd > 0
          ? Math.round(deposit.amount_mmk / deposit.amount_usd)
          : settings?.mmk_to_usd_rate),
      rate_effective_date: pricing.rate_effective_date || rateSnapshot?.effective_date,
      card_request_id: pricing.card_request_id || metadata.card_request_id || null,
      is_wallet_topup: purpose !== 'card_issuance',
    };
  }

  if (rateSnapshot && deposit.amount_usd > 0) {
    return inferPricingBreakdown(deposit, metadata, {
      ...settings,
      mmk_to_usd_rate: rateSnapshot.mmk_to_usd_rate || settings?.mmk_to_usd_rate,
      card_issuance_fee_usd: rateSnapshot.card_issuance_fee_usd || settings?.card_issuance_fee_usd,
    });
  }

  if (deposit.amount_usd > 0 && (deposit.amount_mmk > 0 || purpose === 'usdt_topup')) {
    return inferPricingBreakdown(deposit, metadata, settings);
  }

  return null;
}

function enrichDeposit(deposit, settings) {
  if (!deposit) return deposit;

  const proofType = getProofType(deposit.screenshot_mime_type);
  const metadata = parseRecordMetadata(deposit.metadata);
  const purpose = deposit.purpose || metadata.purpose || 'topup';
  const rateSnapshot = metadata.rate_snapshot || null;
  const pricingBreakdown = resolvePricingBreakdown(deposit, settings);
  const screenshotPath = deposit.screenshot_path || null;

  return {
    ...deposit,
    purpose,
    deposit_currency: deposit.deposit_currency || (purpose === 'usdt_topup' ? 'USDT' : 'MMK'),
    usdt_network: deposit.usdt_network || metadata.usdt_network || null,
    tx_hash: deposit.tx_hash || deposit.txn_id || deposit.kpay_transaction_id || null,
    screenshot_url: screenshotPath,
    proof_url: screenshotPath,
    receiptUrl: screenshotPath || metadata.receiptUrl || metadata.receipt_url || null,
    proofUrl: screenshotPath || metadata.proofUrl || metadata.proof_url || null,
    proof_type: proofType,
    proof_mime_type: deposit.screenshot_mime_type || null,
    pricing_breakdown: pricingBreakdown,
    rate_snapshot: rateSnapshot,
    metadata,
    deposit_channel: metadata.deposit_channel || null,
    p2p_seller_id: metadata.p2p_seller_id || null,
    p2p_seller_name: metadata.p2p_seller_name || null,
    p2p_status: metadata.p2p_status || null,
    is_p2p: metadata.deposit_channel === 'p2p',
  };
}

module.exports = {
  enrichDeposit,
  resolvePricingBreakdown,
  inferPricingBreakdown,
};
