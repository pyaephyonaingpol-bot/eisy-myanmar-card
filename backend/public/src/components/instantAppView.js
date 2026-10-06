/**
 * Instant App View — Master USDT Wallet funded by the per-user TRON HD address.
 * Deposits: GET /api/tron/wallet/address → address + QR.
 * Card issuing and hub catalog purchases are not mounted here.
 */
(function (root) {
  'use strict';

  root.EisyComponents = root.EisyComponents || {};

  const MODE = 'instant';
  const PROVIDER = 'tron-hd';

  const TEMPLATE = `
<div id="instantAppView" class="app-mode-view" data-app-mode="instant" data-provider="tron-hd" data-wallet="usdt" data-deposit-provider="tron-hd">
  <section class="panel app-mode-wallet-panel">
    <h2 data-i18n="instant_app_wallet_heading">Master USDT Wallet</h2>
    <p class="hint" data-i18n="instant_app_wallet_desc">Internal USDT balance. Top up by sending USDT (TRC20) to your TRON HD deposit address.</p>
    <div class="wallet-pay-hint ok" style="margin-bottom:0.75rem">
      <span data-i18n="instant_usdt_wallet_balance_label">Master USDT Wallet</span>:
      <strong id="instantAppUsdtBalance">—</strong>
    </div>
    <div class="field" style="margin-bottom:0.75rem" data-deposit-provider="tron-hd">
      <label data-i18n="instant_kripicard_deposit_label">TRON HD deposit</label>
      <p class="hint" id="instantAppDepositHint" data-i18n="instant_kripicard_deposit_hint" style="margin:0.35rem 0 0.75rem">
        Send USDT on TRON (TRC20) to the address below. Your wallet is credited after confirmation.
      </p>
      <div class="usdt-address-box" id="instantTronHdBox" data-tron-hd-paybox="1">
        <img id="instantTronHdQr" class="usdt-qr hidden" alt="TRON USDT deposit QR code" width="180" height="180" />
        <div class="usdt-address-display">
          <span class="usdt-address-label" data-i18n="deposit_address_label">TRON deposit address</span>
          <code id="instantTronHdAddress" class="usdt-address-code">Loading…</code>
          <button type="button" class="btn btn-secondary btn-sm usdt-copy-btn" id="btnCopyInstantTronHd" data-i18n="copy_address">Copy Address</button>
        </div>
        <p class="status-line" data-i18n="tron_hd_deposit_status">This address is yours. Confirmed USDT (TRC20) sent here is credited to your wallet.</p>
        <p id="instantTronHdError" class="error-text hidden" role="alert"></p>
      </div>
    </div>
    <div class="action-row" style="display:flex;flex-wrap:wrap;gap:0.5rem">
      <button type="button" class="btn btn-primary btn-sm" data-open-usdt-topup data-i18n="top_up_usdt_wallet">Top up Master Wallet</button>
      <button type="button" class="btn btn-secondary btn-sm" id="btnInstantAppWithdraw" data-i18n="btn_withdraw_usdt" data-payout-system="tron">Withdraw USDT</button>
    </div>
    <p class="hint" style="margin-top:0.65rem" data-i18n="instant_withdraw_legacy_hint">USDT withdrawals are reviewed and sent on TRON (TRC20).</p>
  </section>
</div>`.trim();

  function $(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  function renderBalance(ctx) {
    const el = $('instantAppUsdtBalance');
    if (!el) return;
    const bal = Number(ctx.getUsdtWalletBalance?.() ?? ctx.getMasterBalance?.() ?? 0);
    const format = ctx.formatUsdt || ((n) => `$ ${Number(n).toFixed(2)} USDT`);
    el.textContent = format(bal);
  }

  function paintAddress(address) {
    const code = $('instantTronHdAddress');
    if (code) {
      code.textContent = address || '—';
      code.title = address || '';
    }
    const qr = $('instantTronHdQr');
    if (qr && address) {
      qr.src = `/api/qr?size=180&data=${encodeURIComponent(address)}`;
      qr.alt = 'TRON USDT deposit QR code';
      qr.classList.remove('hidden');
    }
    const err = $('instantTronHdError');
    if (err && address) {
      err.textContent = '';
      err.classList.add('hidden');
    }
  }

  async function loadTrc20Deposit(ctx) {
    const hint = $('instantAppDepositHint');
    if (hint && typeof ctx.t === 'function') {
      const next = ctx.t('instant_kripicard_deposit_hint');
      if (next) hint.textContent = next;
    }
    if (typeof ctx.refreshUsdtWallet === 'function') {
      await ctx.refreshUsdtWallet().catch(() => {});
      renderBalance(ctx);
    }
    try {
      if (typeof ctx.loadTronHdDeposit === 'function') {
        const data = await ctx.loadTronHdDeposit();
        if (data?.address) paintAddress(data.address);
      }
    } catch (err) {
      const errEl = $('instantTronHdError');
      if (errEl) {
        errEl.textContent = err.message || 'TRON deposit address is unavailable';
        errEl.classList.remove('hidden');
      }
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

  function bind(ctx = {}) {
    const rootEl = $('instantAppView');
    if (!rootEl || rootEl.dataset.bound === '1') return;
    rootEl.dataset.bound = '1';

    $('btnInstantAppWithdraw')?.addEventListener('click', () => {
      ctx.openUsdtWithdraw?.();
    });
    $('btnCopyInstantTronHd')?.addEventListener('click', async () => {
      const addr = $('instantTronHdAddress')?.textContent?.trim();
      if (!addr || addr === '—' || addr === 'Loading…') return;
      try {
        await navigator.clipboard.writeText(addr);
        ctx.toast?.('Address copied', 'ok');
      } catch (_) {
        ctx.toast?.('Could not copy address', 'error');
      }
    });
  }

  async function activate(ctx = {}) {
    if (typeof ctx.refreshUsdtWallet === 'function') {
      await ctx.refreshUsdtWallet().catch(() => {});
    }
    renderBalance(ctx);
    await loadTrc20Deposit(ctx);
    renderBalance(ctx);
  }

  function deactivate() {
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
    paintAddress,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
