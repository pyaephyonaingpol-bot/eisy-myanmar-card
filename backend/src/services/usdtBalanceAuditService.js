/**
 * USDT custodial reconciliation: internal ledger vs TRON master wallet.
 *
 * Ideal identity (TRC20 master receives deposits and pays crypto withdrawals):
 *
 *   master_on_chain
 *     ≈ Σ(user available + locked)
 *     + platform_usdt_revenue
 *     + pending/processing crypto withdrawal nets (still on-chain until sent)
 *     + bank withdrawal nets (USDT stays on master; MMK paid off-chain)
 *     + USDT spent on cards from USDT wallet (stays on master until provider payout)
 *
 * discrepancy = master_on_chain − expected_master
 *   ≈ 0  → synced
 *   > 0  → master has extra (external top-up, uncredited on-chain deposit, …)
 *   < 0  → master short (external spend, inflated ledger, admin credits w/o deposit, …)
 */
'use strict';

const { getDb } = require('../db');
const { getPlatformUsdtRevenueBalance } = require('./platformRevenueService');
const { getSystemLedgerSummary } = require('./ledgerSummaryService');

const DEFAULT_TOLERANCE_USDT = 0.05;

function roundUsdt(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function safeQuery(db, sql, ...params) {
  try {
    return await db.get(sql, ...params);
  } catch (err) {
    return { __error: err.message };
  }
}

async function safeAll(db, sql, ...params) {
  try {
    return await db.all(sql, ...params);
  } catch (err) {
    return [];
  }
}

async function collectInternalUsdtSnapshot(db) {
  const ledger = await getSystemLedgerSummary();
  const platformRevenue = await getPlatformUsdtRevenueBalance();

  const feeEventsUsdt = await safeQuery(
    db,
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM platform_fee_events
     WHERE UPPER(currency) = 'USDT'`
  );

  const cryptoPending = await safeQuery(
    db,
    `SELECT
       COALESCE(SUM(net_usdt), 0) AS net_usdt,
       COALESCE(SUM(fee_usdt), 0) AS fee_usdt,
       COALESCE(SUM(amount_usdt), 0) AS amount_usdt,
       COUNT(*) AS count
     FROM usdt_withdrawal_requests
     WHERE status IN ('pending', 'processing')
       AND LOWER(COALESCE(payout_method, 'crypto')) = 'crypto'`
  );

  const bankRetained = await safeQuery(
    db,
    `SELECT
       COALESCE(SUM(net_usdt), 0) AS net_usdt,
       COALESCE(SUM(fee_usdt), 0) AS fee_usdt,
       COUNT(*) AS count
     FROM usdt_withdrawal_requests
     WHERE LOWER(COALESCE(payout_method, '')) = 'bank'
       AND status IN ('pending', 'processing', 'completed')`
  );

  const cryptoCompleted = await safeQuery(
    db,
    `SELECT
       COALESCE(SUM(net_usdt), 0) AS net_usdt,
       COALESCE(SUM(fee_usdt), 0) AS fee_usdt,
       COUNT(*) AS count
     FROM usdt_withdrawal_requests
     WHERE status = 'completed'
       AND LOWER(COALESCE(payout_method, 'crypto')) = 'crypto'`
  );

  const cardReloadUsdt = await safeQuery(
    db,
    `SELECT
       COALESCE(SUM(amount_usdt), 0) AS amount_usdt,
       COUNT(*) AS count
     FROM card_reload_requests
     WHERE LOWER(wallet_type) = 'usdt'
       AND LOWER(status) IN ('pending', 'approved')`
  );

  const cardIssueUsdt = await safeQuery(
    db,
    `SELECT
       COALESCE(SUM(
         CASE
           WHEN json_extract(metadata, '$.pricing.total_usdt_required') IS NOT NULL
             THEN CAST(json_extract(metadata, '$.pricing.total_usdt_required') AS REAL)
           WHEN json_extract(metadata, '$.wallet_debit_usdt') IS NOT NULL
             THEN CAST(json_extract(metadata, '$.wallet_debit_usdt') AS REAL)
           ELSE 0
         END
       ), 0) AS amount_usdt,
       COUNT(*) AS count
     FROM cards_v2
     WHERE (
       LOWER(COALESCE(json_extract(metadata, '$.payment_method'), '')) = 'usdt_wallet'
       OR LOWER(COALESCE(json_extract(metadata, '$.wallet_type'), '')) = 'usdt'
       OR LOWER(COALESCE(json_extract(metadata, '$.wallet'), '')) = 'usdt'
     )`
  );

  const adminAdjust = await safeQuery(
    db,
    `SELECT
       COALESCE(SUM(CASE WHEN direction = 'credit' THEN COALESCE(amount_usd, 0) ELSE 0 END), 0) AS credits,
       COALESCE(SUM(CASE WHEN direction = 'debit' THEN COALESCE(amount_usd, 0) ELSE 0 END), 0) AS debits,
       COUNT(*) AS count
     FROM transaction_logs
     WHERE type = 'admin_adjustment'
       AND (
         LOWER(COALESCE(json_extract(metadata, '$.wallet'), '')) = 'usdt'
         OR LOWER(COALESCE(json_extract(metadata, '$.wallet_type'), '')) = 'usdt'
         OR (amount_usd IS NOT NULL AND amount_mmk IS NULL)
       )`
  );

  const pendingUsdtDeposits = await safeQuery(
    db,
    `SELECT
       COALESCE(SUM(amount_usd), 0) AS amount_usdt,
       COUNT(*) AS count
     FROM deposit_requests_v2
     WHERE status IN ('PENDING', 'SUBMITTED', 'AWAITING_PAYMENT', 'pending', 'submitted')
       AND (
         LOWER(COALESCE(purpose, '')) LIKE '%usdt%'
         OR LOWER(COALESCE(usdt_network, '')) IN ('trc20', 'bep20')
         OR amount_usd IS NOT NULL AND (amount_mmk IS NULL OR amount_mmk = 0)
       )`
  );

  const verifiedUsdtDeposits = await safeQuery(
    db,
    `SELECT
       COALESCE(SUM(amount_usd), 0) AS gross_usdt,
       COUNT(*) AS count
     FROM deposit_requests_v2
     WHERE status = 'VERIFIED'
       AND (
         LOWER(COALESCE(purpose, '')) LIKE '%usdt%'
         OR LOWER(COALESCE(usdt_network, '')) IN ('trc20', 'bep20')
       )`
  );

  const topUsers = await safeAll(
    db,
    `SELECT
       id,
       name,
       phone,
       email,
       ROUND(COALESCE(balance_usdt, 0), 2) AS available_usdt,
       ROUND(COALESCE(balance_usdt_locked, 0), 2) AS locked_usdt,
       ROUND(COALESCE(balance_usdt, 0) + COALESCE(balance_usdt_locked, 0), 2) AS total_usdt
     FROM users
     WHERE COALESCE(balance_usdt, 0) + COALESCE(balance_usdt_locked, 0) > 0
     ORDER BY total_usdt DESC
     LIMIT 25`
  );

  const usersAvailable = roundUsdt(ledger.available_usdt);
  const usersLocked = roundUsdt(ledger.locked_usdt);
  const usersTotal = roundUsdt(usersAvailable + usersLocked);
  const platformRev = roundUsdt(platformRevenue);
  const feeEventsTotal = roundUsdt(feeEventsUsdt?.total);
  const pendingCryptoNet = roundUsdt(cryptoPending?.net_usdt);
  const bankRetainedNet = roundUsdt(bankRetained?.net_usdt);
  const cardReload = roundUsdt(cardReloadUsdt?.amount_usdt);
  const cardIssue = roundUsdt(cardIssueUsdt?.amount_usdt);
  const cardsRetained = roundUsdt(cardReload + cardIssue);
  const adminCredits = roundUsdt(adminAdjust?.credits);
  const adminDebits = roundUsdt(adminAdjust?.debits);
  const adminNet = roundUsdt(adminCredits - adminDebits);

  const liabilities = roundUsdt(usersTotal + platformRev);
  const expectedMaster = roundUsdt(
    liabilities + pendingCryptoNet + bankRetainedNet + cardsRetained
  );

  return {
    users: {
      count: ledger.user_count,
      available_usdt: usersAvailable,
      locked_usdt: usersLocked,
      total_usdt: usersTotal,
      escrow_holds_usdt: roundUsdt(ledger.escrow_breakdown?.active_escrow_holds),
    },
    platform_revenue_usdt: platformRev,
    platform_fee_events_usdt_sum: feeEventsTotal,
    platform_revenue_vs_fee_events_delta: roundUsdt(platformRev - feeEventsTotal),
    pending_crypto_withdrawals: {
      count: Number(cryptoPending?.count) || 0,
      net_usdt: pendingCryptoNet,
      fee_usdt: roundUsdt(cryptoPending?.fee_usdt),
      amount_usdt: roundUsdt(cryptoPending?.amount_usdt),
    },
    bank_withdrawals_retained_on_master: {
      count: Number(bankRetained?.count) || 0,
      net_usdt: bankRetainedNet,
      fee_usdt: roundUsdt(bankRetained?.fee_usdt),
      note: 'USDT remains on TRON master; MMK is paid off-chain',
    },
    completed_crypto_withdrawals: {
      count: Number(cryptoCompleted?.count) || 0,
      net_usdt_sent: roundUsdt(cryptoCompleted?.net_usdt),
      fee_usdt: roundUsdt(cryptoCompleted?.fee_usdt),
    },
    usdt_spent_on_cards_retained: {
      reload_usdt: cardReload,
      reload_count: Number(cardReloadUsdt?.count) || 0,
      issue_usdt: cardIssue,
      issue_count: Number(cardIssueUsdt?.count) || 0,
      total_usdt: cardsRetained,
      note: 'Debited from users but still on master until provider settlement',
    },
    admin_usdt_adjustments: {
      count: Number(adminAdjust?.count) || 0,
      credits_usdt: adminCredits,
      debits_usdt: adminDebits,
      net_credit_usdt: adminNet,
      note: 'Net admin credits without matching on-chain deposits create a negative discrepancy',
    },
    deposits: {
      pending_unverified_usdt: roundUsdt(pendingUsdtDeposits?.amount_usdt),
      pending_count: Number(pendingUsdtDeposits?.count) || 0,
      verified_gross_usdt: roundUsdt(verifiedUsdtDeposits?.gross_usdt),
      verified_count: Number(verifiedUsdtDeposits?.count) || 0,
      note: 'Pending deposits may already sit on master before ledger credit',
    },
    liabilities_usdt: liabilities,
    expected_master_usdt: expectedMaster,
    expected_master_breakdown: {
      users_total_usdt: usersTotal,
      platform_revenue_usdt: platformRev,
      pending_crypto_net_usdt: pendingCryptoNet,
      bank_retained_net_usdt: bankRetainedNet,
      cards_retained_usdt: cardsRetained,
    },
    top_user_balances: topUsers,
    query_warnings: [
      feeEventsUsdt?.__error,
      cryptoPending?.__error,
      bankRetained?.__error,
      cardReloadUsdt?.__error,
      cardIssueUsdt?.__error,
      adminAdjust?.__error,
      pendingUsdtDeposits?.__error,
      verifiedUsdtDeposits?.__error,
    ].filter(Boolean),
  };
}

async function fetchMasterWalletUsdt({ skipChain = false } = {}) {
  if (skipChain) {
    return {
      skipped: true,
      address: null,
      usdt_balance: null,
      trx_balance: null,
      error: null,
    };
  }

  try {
    const { getMasterWalletInfo } = require('./tronMasterWalletService');
    const info = await getMasterWalletInfo();
    return {
      skipped: false,
      address: info.address,
      usdt_balance: roundUsdt(info.usdtBalance),
      trx_balance: round2(info.trxBalance),
      trx_low: Boolean(info.trxLow),
      usdt_contract: info.contract,
      error: null,
    };
  } catch (err) {
    return {
      skipped: false,
      address: null,
      usdt_balance: null,
      trx_balance: null,
      error: err.message || String(err),
      code: err.code || null,
    };
  }
}

function classifyDiscrepancy(discrepancy, tolerance) {
  const abs = Math.abs(Number(discrepancy) || 0);
  if (!Number.isFinite(abs)) {
    return { status: 'unknown', synced: false, label: 'UNKNOWN' };
  }
  if (abs <= tolerance) {
    return { status: 'synced', synced: true, label: 'SYNCED' };
  }
  if (discrepancy > 0) {
    return {
      status: 'master_surplus',
      synced: false,
      label: 'MASTER_SURPLUS',
      hint: 'Master holds more USDT than the reconstructed internal expected balance',
    };
  }
  return {
    status: 'master_shortfall',
    synced: false,
    label: 'MASTER_SHORTFALL',
    hint: 'Master holds less USDT than internal liabilities + retained float imply',
  };
}

/**
 * @param {{ skipChain?: boolean, toleranceUsdt?: number }} [opts]
 */
async function runUsdtBalanceAudit(opts = {}) {
  const db = getDb();
  const tolerance = Math.max(0, Number(opts.toleranceUsdt ?? DEFAULT_TOLERANCE_USDT) || 0);
  const skipChain = Boolean(opts.skipChain);

  const internal = await collectInternalUsdtSnapshot(db);
  const master = await fetchMasterWalletUsdt({ skipChain });

  let discrepancy = null;
  let correlation = null;
  let coverage_ratio = null;

  if (master.usdt_balance != null && Number.isFinite(master.usdt_balance)) {
    discrepancy = roundUsdt(master.usdt_balance - internal.expected_master_usdt);
    correlation = {
      master_minus_user_liabilities: roundUsdt(master.usdt_balance - internal.users.total_usdt),
      master_minus_liabilities_with_revenue: roundUsdt(
        master.usdt_balance - internal.liabilities_usdt
      ),
      // Rough "net profit float" sitting on master beyond pure user liabilities
      master_beyond_user_balances_usdt: roundUsdt(master.usdt_balance - internal.users.total_usdt),
    };
    if (internal.expected_master_usdt > 0) {
      coverage_ratio = round2(master.usdt_balance / internal.expected_master_usdt);
    } else if (master.usdt_balance === 0) {
      coverage_ratio = 1;
    } else {
      coverage_ratio = null;
    }
  }

  const verdict = master.skipped
    ? { status: 'db_only', synced: false, label: 'DB_ONLY', hint: 'On-chain check skipped; review internal expected_master only' }
    : master.usdt_balance == null
      ? { status: 'chain_unavailable', synced: false, label: 'CHAIN_UNAVAILABLE' }
      : classifyDiscrepancy(discrepancy, tolerance);

  return {
    checked_at: new Date().toISOString(),
    tolerance_usdt: tolerance,
    formula: {
      expected_master:
        'users_total + platform_revenue + pending_crypto_net + bank_retained_net + usdt_card_spends',
      discrepancy: 'master_on_chain − expected_master',
      net_profit_proxy: 'platform_usdt_revenue (booked fees) — not the same as chain surplus',
    },
    master_wallet: master,
    internal,
    reconciliation: {
      expected_master_usdt: internal.expected_master_usdt,
      master_on_chain_usdt: master.usdt_balance,
      discrepancy_usdt: discrepancy,
      coverage_ratio,
      correlation,
      /** Booked platform fee balance (system "net profit" in USDT fee account) */
      booked_platform_net_profit_usdt: internal.platform_revenue_usdt,
      /**
       * Chain surplus vs user balances only (includes revenue + retained float + unexplained).
       * Useful quick health number; prefer discrepancy_usdt for sync checks.
       */
      chain_surplus_over_user_balances_usdt: correlation
        ? correlation.master_beyond_user_balances_usdt
        : null,
      verdict,
    },
  };
}

function formatAuditReport(audit) {
  const lines = [];
  const r = audit.reconciliation;
  const i = audit.internal;
  const m = audit.master_wallet;

  lines.push('=== USDT Balance Audit (TRON master vs internal ledger) ===');
  lines.push(`Checked at: ${audit.checked_at}`);
  lines.push(`Tolerance:  ±${audit.tolerance_usdt} USDT`);
  lines.push('');

  lines.push('--- Master wallet (on-chain) ---');
  if (m.skipped) {
    lines.push('Skipped (--skip-chain)');
  } else if (m.error) {
    lines.push(`ERROR: ${m.error}${m.code ? ` [${m.code}]` : ''}`);
  } else {
    lines.push(`Address:  ${m.address}`);
    lines.push(`USDT:     ${Number(m.usdt_balance).toFixed(2)}`);
    lines.push(`TRX:      ${Number(m.trx_balance).toFixed(4)}${m.trx_low ? ' (LOW)' : ''}`);
  }
  lines.push('');

  lines.push('--- Internal ledger ---');
  lines.push(`Users available:     ${i.users.available_usdt.toFixed(2)} USDT`);
  lines.push(`Users locked:        ${i.users.locked_usdt.toFixed(2)} USDT`);
  lines.push(`Users total:         ${i.users.total_usdt.toFixed(2)} USDT  (${i.users.count} users)`);
  lines.push(`Platform revenue:    ${i.platform_revenue_usdt.toFixed(2)} USDT`);
  lines.push(`Fee events (USDT):   ${i.platform_fee_events_usdt_sum.toFixed(2)} USDT`);
  lines.push(`Pending crypto WD:   ${i.pending_crypto_withdrawals.net_usdt.toFixed(2)} USDT (${i.pending_crypto_withdrawals.count})`);
  lines.push(`Bank WD retained:    ${i.bank_withdrawals_retained_on_master.net_usdt.toFixed(2)} USDT (${i.bank_withdrawals_retained_on_master.count})`);
  lines.push(`Cards retained:      ${i.usdt_spent_on_cards_retained.total_usdt.toFixed(2)} USDT`);
  lines.push(`Admin net credit:    ${i.admin_usdt_adjustments.net_credit_usdt.toFixed(2)} USDT (${i.admin_usdt_adjustments.count} logs)`);
  lines.push(`Pending deposits:    ${i.deposits.pending_unverified_usdt.toFixed(2)} USDT (${i.deposits.pending_count})`);
  lines.push('');

  lines.push('--- Reconciliation ---');
  lines.push(`Expected master:     ${r.expected_master_usdt.toFixed(2)} USDT`);
  lines.push(
    `  = users ${i.expected_master_breakdown.users_total_usdt.toFixed(2)}`
    + ` + revenue ${i.expected_master_breakdown.platform_revenue_usdt.toFixed(2)}`
    + ` + pending crypto ${i.expected_master_breakdown.pending_crypto_net_usdt.toFixed(2)}`
    + ` + bank retained ${i.expected_master_breakdown.bank_retained_net_usdt.toFixed(2)}`
    + ` + cards ${i.expected_master_breakdown.cards_retained_usdt.toFixed(2)}`
  );
  if (r.master_on_chain_usdt == null) {
    lines.push('Master on-chain:     (unavailable)');
    lines.push('Discrepancy:         (n/a)');
  } else {
    lines.push(`Master on-chain:     ${Number(r.master_on_chain_usdt).toFixed(2)} USDT`);
    lines.push(`Discrepancy:         ${Number(r.discrepancy_usdt).toFixed(2)} USDT`);
    if (r.coverage_ratio != null) {
      lines.push(`Coverage ratio:      ${r.coverage_ratio.toFixed(4)}  (master / expected)`);
    }
    lines.push(`Booked net profit:   ${Number(r.booked_platform_net_profit_usdt).toFixed(2)} USDT (platform fee account)`);
    lines.push(`Chain − user bals:   ${Number(r.chain_surplus_over_user_balances_usdt).toFixed(2)} USDT`);
  }
  lines.push('');
  lines.push(`VERDICT: ${r.verdict.label}${r.verdict.hint ? ` — ${r.verdict.hint}` : ''}`);

  if (i.query_warnings?.length) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of i.query_warnings) lines.push(`  - ${w}`);
  }

  if (i.top_user_balances?.length) {
    lines.push('');
    lines.push('Top user USDT balances:');
    for (const u of i.top_user_balances.slice(0, 10)) {
      const who = u.email || u.phone || u.name || `#${u.id}`;
      lines.push(
        `  #${u.id} ${who}: ${Number(u.total_usdt).toFixed(2)} `
        + `(avail ${Number(u.available_usdt).toFixed(2)} + locked ${Number(u.locked_usdt).toFixed(2)})`
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

module.exports = {
  DEFAULT_TOLERANCE_USDT,
  runUsdtBalanceAudit,
  formatAuditReport,
  collectInternalUsdtSnapshot,
};
