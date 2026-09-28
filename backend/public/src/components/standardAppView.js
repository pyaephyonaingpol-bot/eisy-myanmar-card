/**
 * Standard App View — KYC / Bitnob pipeline only.
 * Owns Bitnob wallet balance, deposit address, Standard Card issuance, Bitnob actions.
 * Must never import or render Non-KYC Instant Card UI or APIs.
 */
(function (root) {
  'use strict';

  root.EisyComponents = root.EisyComponents || {};

  const MODE = 'standard';
  const PROVIDER = 'bitnob';

  const TEMPLATE = `
<div id="standardAppView" class="app-mode-view" data-app-mode="standard" data-provider="bitnob">
  <section class="panel app-mode-wallet-panel">
    <h2 data-i18n="standard_app_wallet_heading">Bitnob Wallet (Standard)</h2>
    <p class="hint" data-i18n="standard_app_wallet_desc">Verified KYC only. Deposit USDT to your Bitnob address, then issue a Standard Card.</p>
    <div id="standardAppKycGate" class="wallet-pay-hint err hidden" data-i18n="standard_kyc_required">Complete KYC verification before using Standard Card / Bitnob wallet.</div>
    <div id="standardAppWalletBody" class="standard-app-wallet-body">
      <div class="wallet-pay-hint ok" style="margin-bottom:0.5rem">
        <span data-i18n="standard_wallet_balance_label">Bitnob / Standard Card wallet</span>:
        <strong id="standardAppBitnobBalance">—</strong>
      </div>
      <div class="field" style="margin-bottom:0.5rem">
        <label data-i18n="standard_deposit_address_label">Bitnob deposit address</label>
        <input id="standardAppDepositAddress" type="text" readonly value="" placeholder="Loading…" />
        <small class="hint" id="standardAppDepositChainHint"></small>
      </div>
      <div class="action-row" style="display:flex;flex-wrap:wrap;gap:0.5rem">
        <button type="button" class="btn btn-secondary btn-sm" id="btnStandardAppRefreshDeposit" data-i18n="refresh_standard_deposit">Refresh deposit address</button>
        <button type="button" class="btn btn-secondary btn-sm" id="btnStandardAppCopyDeposit" data-i18n="btn_copy">Copy</button>
      </div>
    </div>
  </section>

  <section class="panel app-mode-deposit-panel">
    <h2 data-i18n="standard_app_deposit_heading">Standard Deposit</h2>
    <p class="hint" data-i18n="standard_app_deposit_desc">Send USDT to the Bitnob deposit address above. Credits your Standard Card wallet only — not the Instant USDT Wallet.</p>
  </section>

  <section class="panel app-mode-card-panel">
    <div id="standardAppCardHost" data-standard-card-host></div>
  </section>
</div>`.trim();

  function $(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  function cardView() {
    return root.EisyComponents && root.EisyComponents.standardCardView;
  }

  function api() {
    return root.EisyServices && root.EisyServices.standardCard;
  }

  function syncKyc(ctx) {
    const verified = Boolean(ctx.isKycVerified?.());
    const gate = $('standardAppKycGate');
    const body = $('standardAppWalletBody');
    if (gate) gate.classList.toggle('hidden', verified);
    if (body) body.classList.toggle('hidden', !verified);
  }

  function renderBalance(ctx) {
    const el = $('standardAppBitnobBalance');
    if (!el) return;
    const bal = Number(ctx.getBitnobBalance?.() ?? 0);
    const format = ctx.formatUsdt || ((n) => `$ ${Number(n).toFixed(2)} USDT`);
    el.textContent = format(bal);
  }

  async function loadDepositAddress(ctx, { force = false } = {}) {
    const input = $('standardAppDepositAddress');
    const hint = $('standardAppDepositChainHint');
    if (!ctx.isKycVerified?.()) {
      if (input) input.value = '';
      return null;
    }
    const svc = api();
    if (!svc) return null;
    try {
      if (input) input.value = 'Loading…';
      const data = await svc.getDepositAddress(force);
      if (input) input.value = data.address || '';
      if (hint) {
        hint.textContent = data.chain
          ? `Network: ${String(data.chain).toUpperCase()} · Bitnob deposits only`
          : 'Bitnob Standard deposits only';
      }
      ctx.deposit = data;
      return data;
    } catch (err) {
      if (input) input.value = '';
      if (hint) hint.textContent = err.message || 'Deposit address unavailable';
      return null;
    }
  }

  async function loadFunding(ctx) {
    const svc = api();
    if (!svc) return null;
    try {
      const data = await svc.getCardFundingWallets();
      if (typeof ctx.setBitnobBalance === 'function') {
        ctx.setBitnobBalance(Number(data?.standard?.balance_usdt ?? 0));
      }
      renderBalance(ctx);
      return data;
    } catch (err) {
      console.warn('[standardAppView wallets]', err.message);
      return null;
    }
  }

  function mount(host, { replace = true } = {}) {
    if (!host) return null;
    if (replace) host.innerHTML = TEMPLATE;
    else if (!host.querySelector('#standardAppView')) {
      host.insertAdjacentHTML('beforeend', TEMPLATE);
    }
    if (typeof root.I18n !== 'undefined' && root.I18n.apply) {
      root.I18n.apply(host);
    }
    return $('standardAppView');
  }

  function unmount(host) {
    const view = $('standardAppView');
    if (view) view.remove();
    if (host) host.innerHTML = '';
  }

  function bind(ctx = {}) {
    const rootEl = $('standardAppView');
    if (!rootEl || rootEl.dataset.bound === '1') return;
    rootEl.dataset.bound = '1';

    $('btnStandardAppRefreshDeposit')?.addEventListener('click', () => {
      loadDepositAddress(ctx, { force: true }).catch(() => {});
    });

    $('btnStandardAppCopyDeposit')?.addEventListener('click', async () => {
      const val = $('standardAppDepositAddress')?.value || '';
      if (!val || val === 'Loading…') return;
      try {
        await navigator.clipboard.writeText(val);
        ctx.toast?.(typeof ctx.t === 'function' ? ctx.t('copied') : 'Copied', 'ok');
      } catch (_) {
        ctx.toast?.('Copy failed', 'error');
      }
    });

    const cardHost = $('standardAppCardHost');
    const card = cardView();
    if (card && cardHost) {
      // Mount Standard card form without duplicating the outer wallet panel:
      // standardCardView includes its own wallet block — hide that inner duplicate
      // when already shown in the app shell, OR mount full card view.
      card.mount(cardHost, { replace: true });
      card.bind(ctx);
      // Hide nested wallet panel inside card view to avoid double wallet UI.
      const nestedWallet = cardHost.querySelector('#standardWalletPanel');
      if (nestedWallet) nestedWallet.classList.add('hidden');
      const nestedHint = cardHost.querySelector('[data-i18n="apply_standard_card_hint"]');
      // Keep form; outer app view owns deposit address.
    }
  }

  async function activate(ctx = {}) {
    syncKyc(ctx);
    renderBalance(ctx);
    await loadFunding(ctx);
    if (ctx.isKycVerified?.()) {
      await loadDepositAddress(ctx, { force: false });
    }
    const card = cardView();
    if (card) {
      await card.activate(ctx);
      const nestedWallet = $('standardAppCardHost')?.querySelector('#standardWalletPanel');
      if (nestedWallet) nestedWallet.classList.add('hidden');
    }
    syncKyc(ctx);
    renderBalance(ctx);
  }

  function deactivate() {
    cardView()?.deactivate?.();
    unmount();
  }

  root.EisyComponents.standardAppView = {
    MODE,
    PROVIDER,
    TEMPLATE,
    mount,
    unmount,
    bind,
    activate,
    deactivate,
    renderBalance,
    loadDepositAddress,
    loadFunding,
    syncKyc,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
