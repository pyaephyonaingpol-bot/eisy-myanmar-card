'use strict';

/** One-way USDT escrow: seller lock → buyer fiat off-platform → release to buyer. */
const ONE_WAY_ESCROW_STEPS = [
  { step: 1, status: 'pending_payment', label: 'Pending Payment' },
  { step: 2, status: 'pending_seller_release', label: 'Payment Sent' },
  { step: 3, status: 'released', label: 'USDT Released' },
];

function normalizeP2pEscrowStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed_by_admin') return 'released';
  /** Sell orders stay in this status while buyer pays MMK externally (one-way lock already held). */
  if (s === 'pending_merchant_mmk') return 'pending_payment';
  return s;
}

function p2pEscrowStepIndex(status) {
  const s = normalizeP2pEscrowStatus(status);
  if (s === 'pending_payment') return 1;
  if (s === 'pending_seller_release') return 2;
  if (s === 'released') return 3;
  return 0;
}

function p2pEscrowStepLabel(status) {
  const idx = p2pEscrowStepIndex(status);
  const found = ONE_WAY_ESCROW_STEPS.find((x) => x.step === idx);
  return found ? found.label : String(status || 'Unknown');
}

function p2pEscrowStatusBadge(status, { isMaker = false, makerCanRelease = false, isDisputed = false } = {}) {
  if (isDisputed) {
    return {
      label: 'Disputed',
      code: 'DISPUTED',
      step_index: p2pEscrowStepIndex(status),
      step_label: p2pEscrowStepLabel(status),
      requires_action: false,
    };
  }
  const stepIndex = p2pEscrowStepIndex(status);
  const stepLabel = p2pEscrowStepLabel(status);
  const code = stepIndex === 1 ? 'PENDING_PAYMENT' : stepIndex === 2 ? 'PAYMENT_SENT' : stepIndex === 3 ? 'USDT_RELEASED' : 'UNKNOWN';
  let label = stepLabel;
  let requires_action = false;
  let action_label = 'Resume / View Details';

  if (status === 'pending_payment') {
    requires_action = true;
    action_label = 'Pay seller externally';
  } else if (status === 'pending_seller_release') {
    if (isMaker && makerCanRelease) {
      label = 'Payment Sent — Release USDT';
      requires_action = true;
      action_label = 'Release USDT to Buyer';
    } else {
      label = 'Payment Sent';
      action_label = 'View order status';
    }
  } else if (normalizeP2pEscrowStatus(status) === 'released') {
    label = 'USDT Released';
    action_label = 'View receipt';
  }

  return {
    label,
    code,
    step_index: stepIndex,
    step_label: stepLabel,
    requires_action,
    action_label,
  };
}

module.exports = {
  ONE_WAY_ESCROW_STEPS,
  normalizeP2pEscrowStatus,
  p2pEscrowStepIndex,
  p2pEscrowStepLabel,
  p2pEscrowStatusBadge,
};
