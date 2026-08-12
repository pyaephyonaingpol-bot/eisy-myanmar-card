/** Canonical platform fee categories for ledger / analytics */
const PLATFORM_FEE_TYPES = {
  P2P: 'TYPE_P2P_FEE',
  CARD_RELOAD: 'TYPE_CARD_RELOAD_FEE',
  CARD_ISSUE: 'TYPE_CARD_ISSUE_FEE',
  WITHDRAWAL: 'TYPE_WITHDRAWAL_FEE',
  DEPOSIT: 'TYPE_DEPOSIT_FEE',
};

/** Fee types that may credit the USDT profit ledger (native USDT). */
const USDT_FEE_TYPES = new Set([
  PLATFORM_FEE_TYPES.P2P,
  PLATFORM_FEE_TYPES.WITHDRAWAL,
  PLATFORM_FEE_TYPES.DEPOSIT,
  PLATFORM_FEE_TYPES.CARD_RELOAD,
  PLATFORM_FEE_TYPES.CARD_ISSUE,
]);

/** Fee types that may credit the MMK profit ledger (native MMK). */
const MMK_FEE_TYPES = new Set([
  PLATFORM_FEE_TYPES.WITHDRAWAL,
  PLATFORM_FEE_TYPES.DEPOSIT,
  PLATFORM_FEE_TYPES.CARD_RELOAD,
  PLATFORM_FEE_TYPES.CARD_ISSUE,
]);

/** @deprecated Legacy USD-denominated card fees — new writes should use MMK or USDT. */
const USD_FEE_TYPES = new Set([
  PLATFORM_FEE_TYPES.CARD_RELOAD,
  PLATFORM_FEE_TYPES.CARD_ISSUE,
]);

module.exports = {
  PLATFORM_FEE_TYPES,
  USDT_FEE_TYPES,
  MMK_FEE_TYPES,
  USD_FEE_TYPES,
};
