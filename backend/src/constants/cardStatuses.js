/** Lifecycle statuses stored lowercase in cards_v2.status */
const CARD_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  FROZEN: 'frozen',
  TERMINATED: 'terminated',
  /** @deprecated legacy — treated as terminated in UI */
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
};

const ADMIN_SETTABLE_STATUSES = [
  CARD_STATUS.ACTIVE,
  CARD_STATUS.SUSPENDED,
  CARD_STATUS.FROZEN,
  CARD_STATUS.TERMINATED,
];

const DISPLAY_LABELS = {
  [CARD_STATUS.PENDING]: 'PENDING_ISSUANCE',
  [CARD_STATUS.ACTIVE]: 'ACTIVE',
  [CARD_STATUS.SUSPENDED]: 'SUSPENDED',
  [CARD_STATUS.FROZEN]: 'FROZEN',
  [CARD_STATUS.TERMINATED]: 'TERMINATED',
  [CARD_STATUS.CANCELLED]: 'TERMINATED',
  [CARD_STATUS.EXPIRED]: 'TERMINATED',
};

function normalizeCardStatus(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (!s) return CARD_STATUS.ACTIVE;
  if (s === CARD_STATUS.CANCELLED || s === CARD_STATUS.EXPIRED) return CARD_STATUS.TERMINATED;
  return s;
}

function displayStatusLabel(raw) {
  const normalized = normalizeCardStatus(raw);
  return DISPLAY_LABELS[normalized] || normalized.toUpperCase();
}

function isPendingCardRecord(card) {
  const status = String(card?.status || '').toLowerCase();
  const num = String(card?.card_number || '').trim();
  if (status === CARD_STATUS.PENDING) return true;
  return num.startsWith('PENDING-');
}

function isCardReloadAllowed(status) {
  return normalizeCardStatus(status) === CARD_STATUS.ACTIVE;
}

function isCardDetailsAllowed(status) {
  return normalizeCardStatus(status) === CARD_STATUS.ACTIVE;
}

function parseCardMetadata(card) {
  if (!card?.metadata) return {};
  if (typeof card.metadata === 'object') return card.metadata;
  try {
    return JSON.parse(card.metadata);
  } catch (_) {
    return {};
  }
}

/** Whether a card row should appear in the user's My Cards list. */
function isCardVisibleInUserList(card) {
  if (!card) return false;
  const status = normalizeCardStatus(card.status);
  if (status === CARD_STATUS.TERMINATED) return false;
  const metadata = parseCardMetadata(card);
  if (metadata.removed_by_user) return false;
  return true;
}

module.exports = {
  CARD_STATUS,
  ADMIN_SETTABLE_STATUSES,
  DISPLAY_LABELS,
  normalizeCardStatus,
  displayStatusLabel,
  isPendingCardRecord,
  isCardReloadAllowed,
  isCardDetailsAllowed,
  parseCardMetadata,
  isCardVisibleInUserList,
};
