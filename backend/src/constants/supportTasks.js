'use strict';

/** Admin support task taxonomy (MMK Payouts + Card Issuing Issues). */

const SUPPORT_CATEGORIES = Object.freeze({
  mmk_payouts: 'MMK Payouts',
  card_issuing: 'Card Issuing Issues',
  general: 'General',
  deposit: 'Deposit',
  card: 'Card',
  account: 'Account',
  technical: 'Technical',
});

const SUPPORT_MAIN_CATEGORIES = Object.freeze(['mmk_payouts', 'card_issuing']);

const SUPPORT_PRIORITIES = Object.freeze(['high', 'medium', 'low']);

const SUPPORT_STATUSES = Object.freeze([
  'pending',
  'in_progress',
  'completed',
  'failed',
]);

const SUPPORT_STATUS_LABELS = Object.freeze({
  pending: 'Open',
  in_progress: 'In Progress',
  completed: 'Resolved',
  failed: 'Failed',
  open: 'Open',
  closed: 'Resolved',
  resolved: 'Resolved',
});

const SUPPORT_PRIORITY_LABELS = Object.freeze({
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  urgent: 'High',
  normal: 'Medium',
});

function normalizeSupportCategory(value, { fallback = 'general' } = {}) {
  const key = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (key === 'mmk_payout' || key === 'mmk-payouts' || key === 'mmk_payouts') return 'mmk_payouts';
  if (key === 'card_issuing_issues' || key === 'card-issuing' || key === 'card_issuing') return 'card_issuing';
  if (Object.prototype.hasOwnProperty.call(SUPPORT_CATEGORIES, key)) return key;
  return fallback;
}

function normalizeSupportPriority(value, { fallback = 'medium' } = {}) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'urgent' || key === 'high') return 'high';
  if (key === 'normal' || key === 'medium') return 'medium';
  if (key === 'low') return 'low';
  return fallback;
}

function normalizeSupportStatus(value, { fallback = 'pending' } = {}) {
  const key = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (key === 'open') return 'pending';
  if (key === 'closed' || key === 'done' || key === 'complete' || key === 'resolved') return 'completed';
  if (key === 'in-progress' || key === 'progress') return 'in_progress';
  if (SUPPORT_STATUSES.includes(key)) return key;
  return fallback;
}

function isUrgentSupportPriority(priority) {
  return normalizeSupportPriority(priority) === 'high';
}

module.exports = {
  SUPPORT_CATEGORIES,
  SUPPORT_MAIN_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABELS,
  SUPPORT_PRIORITY_LABELS,
  normalizeSupportCategory,
  normalizeSupportPriority,
  normalizeSupportStatus,
  isUrgentSupportPriority,
};
