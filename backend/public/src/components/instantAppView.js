/**
 * Instant App View — Master USDT Wallet + Instant Card only.
 * Deposits: Kripicard Deposit API (unique pay_address / pay_amount / network).
 * Withdrawals: legacy TRON master wallet (not Kripicard).
 */
(function (root) {
  'use strict';

  root.EisyComponents = root.EisyComponents || {};

  const MODE = 'instant';
  const PROVIDER = 'kripicard';

  const TEMPLATE = `
<div id="instantAppView" class="app-mode-view" data-app-mode="instant" data-provider="kripicard" data-wallet="usdt">
  <section class="panel app-mode-wallet-panel">
    <h2 data-i18n="instant_app_wallet_heading">Master USDT Wallet (Instant)</h2>
    <p class="hint" data-i18n="instant_app_wallet_desc">Internal Master USDT balance. Top up via Kripicard (unique pay address), then issue Instant Card (No KYC). Withdrawals use the legacy TRON master wallet.</p>
    <div class="wallet-pay-hint ok" style="margin-bottom:0.75rem">
      <span data-i18n="instant_usdt_wallet_balance_label">Master USDT Wallet</span>:
      <strong id="instantAppUsdtBalance">—</strong>
    </div>
    <div class="field" style="margin-bottom:0.5rem" data-deposit-provider="kripicard">
      <label data-i18n="instant_kripicard_deposit_label">Kripicard deposit</label>
      <p class="hint" id="instantAppDepositHint" data-i18n="instant_kripicard_deposit_hint" style="margin:0.35rem 0 0">
        Each top-up issues a unique pay address, exact amount, and network (e.g. Tron). Min $20 USDT.
      </p>
    </div>
    <div class="action-row" style="display:flex;flex-wrap:wrap;gap:0.5rem">
      <button type="button" class="btn btn-primary btn-sm" data-open-usdt-topup data-i18n="top_up_usdt_wallet">Top up Master Wallet</button>
      <button type="button" class="btn btn-secondary btn-sm" id="btnInstantAppWithdraw" data-i18n="btn_withdraw_usdt" data-payout-system="legacy-tron-master-wallet">Withdraw USDT</button>
    </div>
    <p class="hint" style="margin-top:0.65rem" data-i18n="instant_withdraw_legacy_hint">Withdrawals payout from our legacy TRON master wallet (TRC20 automated) — not via Kripicard.</p>
  </section>

  <section class="panel app-mode-card-panel">
    <div id="instantAppCardHost" data-instant-card-host></div>
  </section>
</div>`.trim();

  function $(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  function cardView() {
    return root.EisyComponents && root.EisyComponents.instantCardView;
  }

  function renderBalance(ctx) {
    const el = $('instantAppUsdtBalance');
    if (!el) return;
    const bal = Number(ctx.getUsdtWalletBalance?.() ?? ctx.getMasterBalance?.() ?? 0);
    const format = ctx.formatUsdt || ((n) => `$ ${Number(n).toFixed(2)} USDT`);
    el.textContent = format(bal);
  }

  /** @deprecated Static HD TRC20 addresses retired — use Top up (Kripicard). */
  async function loadTrc20Deposit(ctx) {
    const hint = $('instantAppDepositHint');
    if (hint && !hint.dataset.i18nKeep) {
      hint.textContent = typeof ctx.t === 'function'
        ? (ctx.t('instant_kripicard_deposit_hint') || hint.textContent)
        : hint.textContent;
    }
    if (typeof ctx.refreshUsdtWallet === 'function') {
      await ctx.refreshUsdtWallet().catch(() => {});
      renderBalance(ctx);
    }
    return null;
  }

  function mount(host, { replace = true } = {}) {
    if (!host) return null;
    if (replace) host.innerHTML = TEMPLATE;
    else if (!host.querySelector('#instantAppView')) {
      host.insertAdjacentHTML('beforeend', TEMPLATE);
    }
    if (typeof root.I18n !== 'undefined' && root.I18n.apply) {
      root.I18n.apply(host);
    }
    return $('instantAppView');
  }

  function unmount(host) {
    const view = $('instantAppView');
    if (view) view.remove();
    if (host) host.innerHTML = '';
  }

  function hideNestedWalletChrome() {
    const host = $('instantAppCardHost');
    if (!host) return;
    host.querySelector('#instantWalletBalanceHint')?.classList.add('hidden');
    host.querySelectorAll('[data-open-usdt-topup]').forEach((btn) => {
      const wrap = btn.closest('p.hint') || btn;
      wrap.classList?.add?.('hidden');
    });
  }

  function bind(ctx = {}) {
    const rootEl = $('instantAppView');
    if (!rootEl || rootEl.dataset.bound === '1') return;
    rootEl.dataset.bound = '1';

    $('btnInstantAppWithdraw')?.addEventListener('click', () => {
      ctx.openUsdtWithdraw?.();
    });
    // Top-up CTAs use [data-open-usdt-topup] — bound globally by Dashboard.bindUsdtTopUpModal.

    const cardHost = $('instantAppCardHost');
    const card = cardView();
    if (card && cardHost) {
      card.mount(cardHost, { replace: true });
      card.bind(ctx);
      hideNestedWalletChrome();
    }
  }

  async function activate(ctx = {}) {
    if (typeof ctx.refreshUsdtWallet === 'function') {
      await ctx.refreshUsdtWallet().catch(() => {});
    }
    renderBalance(ctx);
    await loadTrc20Deposit(ctx);
    const card = cardView();
    if (card) {
      await card.activate(ctx);
      hideNestedWalletChrome();
    }
    renderBalance(ctx);
  }

  function deactivate() {
    cardView()?.deactivate?.();
    unmount();
  }

  root.EisyComponents.instantAppView = {
    MODE,
    PROVIDER,
    TEMPLATE,
    mount,
    unmount,
    bind,
    activate,
    deactivate,
    renderBalance,
    loadTrc20Deposit,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
