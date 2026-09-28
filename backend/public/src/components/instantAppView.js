/**
 * Instant App View — Non-KYC / Kripicard pipeline only.
 * Owns USDT Wallet balance, Master Wallet deposit CTA, Instant Card issuance.
 * Must never import or render KYC-provider / Standard Card UI or APIs.
 */
(function (root) {
  'use strict';

  root.EisyComponents = root.EisyComponents || {};

  const MODE = 'instant';
  const PROVIDER = 'kripicard';

  const TEMPLATE = `
<div id="instantAppView" class="app-mode-view" data-app-mode="instant" data-provider="kripicard">
  <section class="panel app-mode-wallet-panel">
    <h2 data-i18n="instant_app_wallet_heading">USDT Wallet (Instant)</h2>
    <p class="hint" data-i18n="instant_app_wallet_desc">Internal platform USDT balance. Top up via TRC20, then issue Instant Card (No KYC).</p>
    <div class="wallet-pay-hint ok" style="margin-bottom:0.75rem">
      <span data-i18n="instant_usdt_wallet_balance_label">USDT Wallet</span>:
      <strong id="instantAppUsdtBalance">—</strong>
    </div>
    <div class="action-row" style="display:flex;flex-wrap:wrap;gap:0.5rem">
      <button type="button" class="btn btn-primary btn-sm" data-open-usdt-topup data-i18n="top_up_usdt_wallet">Top up USDT Wallet</button>
      <button type="button" class="btn btn-secondary btn-sm" id="btnInstantAppWithdraw" data-i18n="btn_withdraw_usdt">Withdraw USDT</button>
      <button type="button" class="btn btn-secondary btn-sm" data-goto="usdt-wallet" data-i18n="btn_manage_usdt_wallet">Manage Wallet</button>
    </div>
  </section>

  <section class="panel app-mode-deposit-panel">
    <h2 data-i18n="instant_app_deposit_heading">Instant Deposit</h2>
    <p class="hint" data-i18n="instant_app_deposit_desc">Deposit USDT (TRC20) to your Master Wallet address. Funds Instant Card issuance only.</p>
    <button type="button" class="btn btn-primary btn-sm" data-open-usdt-topup data-i18n="btn_top_up_usdt">Show Deposit Address</button>
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

  function bind(ctx = {}) {
    const rootEl = $('instantAppView');
    if (!rootEl || rootEl.dataset.bound === '1') return;
    rootEl.dataset.bound = '1';

    $('btnInstantAppWithdraw')?.addEventListener('click', () => {
      ctx.openUsdtWithdraw?.();
    });

    const cardHost = $('instantAppCardHost');
    const card = cardView();
    if (card && cardHost) {
      card.mount(cardHost, { replace: true });
      card.bind(ctx);
      // App view owns wallet chrome — hide nested Instant wallet strip.
      cardHost.querySelector('#instantWalletBalanceHint')?.classList.add('hidden');
      cardHost.querySelector('[data-open-usdt-topup]')?.closest('p.hint')?.classList.add('hidden');
    }
  }

  async function activate(ctx = {}) {
    if (typeof ctx.refreshUsdtWallet === 'function') {
      await ctx.refreshUsdtWallet().catch(() => {});
    }
    renderBalance(ctx);
    const card = cardView();
    if (card) {
      await card.activate(ctx);
      const host = $('instantAppCardHost');
      host?.querySelector('#instantWalletBalanceHint')?.classList.add('hidden');
      host?.querySelector('[data-open-usdt-topup]')?.closest('p.hint')?.classList.add('hidden');
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
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
