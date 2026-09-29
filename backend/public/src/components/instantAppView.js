/**
 * Instant App View — Master USDT Wallet + Instant Card only.
 * Shows Master USDT balance, TRC20 deposit address, and Instant Card actions.
 * Instant portal shell (Master Wallet + Kripicard).
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
    <p class="hint" data-i18n="instant_app_wallet_desc">Internal Master USDT balance. Deposit via TRC20, then issue Instant Card (No KYC).</p>
    <div class="wallet-pay-hint ok" style="margin-bottom:0.75rem">
      <span data-i18n="instant_usdt_wallet_balance_label">Master USDT Wallet</span>:
      <strong id="instantAppUsdtBalance">—</strong>
    </div>
    <div class="field" style="margin-bottom:0.5rem">
      <label data-i18n="instant_trc20_deposit_label">TRC20 deposit address</label>
      <input id="instantAppTrc20Address" type="text" readonly value="" placeholder="Loading…" />
      <small class="hint" id="instantAppTrc20Hint" data-i18n="instant_trc20_deposit_hint">USDT (TRC20) · Master Wallet deposits only — funds Instant Card</small>
    </div>
    <div class="action-row" style="display:flex;flex-wrap:wrap;gap:0.5rem">
      <button type="button" class="btn btn-secondary btn-sm" id="btnInstantAppCopyTrc20" data-i18n="btn_copy">Copy</button>
      <button type="button" class="btn btn-secondary btn-sm" id="btnInstantAppRefreshDeposit" data-i18n="refresh_instant_deposit">Refresh address</button>
      <button type="button" class="btn btn-primary btn-sm" data-open-usdt-topup data-i18n="top_up_usdt_wallet">Top up Master Wallet</button>
      <button type="button" class="btn btn-secondary btn-sm" id="btnInstantAppWithdraw" data-i18n="btn_withdraw_usdt">Withdraw USDT</button>
    </div>
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

  function usdtApi() {
    return root.EisyServices && root.EisyServices.usdtWallet;
  }

  function renderBalance(ctx) {
    const el = $('instantAppUsdtBalance');
    if (!el) return;
    const bal = Number(ctx.getUsdtWalletBalance?.() ?? ctx.getMasterBalance?.() ?? 0);
    const format = ctx.formatUsdt || ((n) => `$ ${Number(n).toFixed(2)} USDT`);
    el.textContent = format(bal);
  }

  function pickTrc20(addresses) {
    const list = Array.isArray(addresses) ? addresses : [];
    return list.find((row) => {
      const net = String(row.network || row.network_label || '').toUpperCase();
      return net.includes('TRC20') || net.includes('TRON');
    }) || list[0] || null;
  }

  async function loadTrc20Deposit(ctx, { force = false } = {}) {
    const input = $('instantAppTrc20Address');
    const hint = $('instantAppTrc20Hint');
    const svc = usdtApi();
    if (!svc) {
      if (input) input.value = '';
      if (hint) hint.textContent = 'Deposit service unavailable';
      return null;
    }
    try {
      if (input) input.placeholder = 'Loading…';
      if (force && typeof ctx.refreshUsdtWallet === 'function') {
        await ctx.refreshUsdtWallet().catch(() => {});
      }
      let addresses = ctx.getMasterDepositAddresses?.() || null;
      if (!addresses || force) {
        const data = await svc.getOverview();
        addresses = data?.deposit_addresses || [];
        ctx.setMasterDepositAddresses?.(addresses);
        if (typeof ctx.setUsdtBalanceFromOverview === 'function') {
          ctx.setUsdtBalanceFromOverview(data);
        }
      }
      const row = pickTrc20(addresses);
      if (input) {
        input.value = row?.address || '';
        input.placeholder = row?.address ? '' : 'No address yet';
      }
      if (hint) {
        if (row?.address) {
          const net = row.network_label || row.network || 'TRC20';
          hint.textContent = row.deposit_reference
            ? `${net} · Ref ${row.deposit_reference} · Master Wallet only`
            : `${net} · Master Wallet deposits only — Instant Card`;
        } else {
          hint.textContent = 'No TRC20 address yet — use Top up to provision';
        }
      }
      ctx.trc20Deposit = row;
      return row;
    } catch (err) {
      if (input) {
        input.value = '';
        input.placeholder = err.code === 'SENSITIVE_AUTH_REQUIRED'
          ? 'Unlock PIN to view address'
          : 'Unavailable';
      }
      if (hint) {
        hint.textContent = err.code === 'SENSITIVE_AUTH_REQUIRED'
          ? 'Unlock with PIN to load your Master TRC20 deposit address'
          : (err.message || 'Deposit address unavailable');
      }
      if (err.code === 'SENSITIVE_AUTH_REQUIRED') ctx.openPinUnlock?.();
      return null;
    }
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

    $('btnInstantAppCopyTrc20')?.addEventListener('click', async () => {
      const val = $('instantAppTrc20Address')?.value || '';
      if (!val || val === 'Loading…') return;
      try {
        await navigator.clipboard.writeText(val);
        ctx.toast?.(typeof ctx.t === 'function' ? ctx.t('copied') : 'Copied', 'ok');
      } catch (_) {
        ctx.toast?.('Copy failed', 'error');
      }
    });

    $('btnInstantAppRefreshDeposit')?.addEventListener('click', () => {
      loadTrc20Deposit(ctx, { force: true }).catch(() => {});
    });

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
    await loadTrc20Deposit(ctx, { force: false });
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
