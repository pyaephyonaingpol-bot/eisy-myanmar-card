/**
 * Instant Card view — Non-KYC / Master Wallet / Kripicard only.
 * Mounts its own markup. Must never reference KYC-provider wallet APIs.
 */
(function (root) {
  'use strict';

  root.EisyComponents = root.EisyComponents || {};

  const FLOW = 'instant';
  const PROVIDER = 'kripicard';

  const TEMPLATE = `
<div id="instantCardApplyPanel" class="card-provider-panel is-active" data-card-page="instant" data-provider="kripicard" role="tabpanel" aria-labelledby="tabInstantCard">
  <h2 data-i18n="apply_instant_card">Instant Card (No KYC)</h2>
  <p class="hint" style="margin-bottom:0.75rem" data-i18n="apply_instant_card_hint">No KYC required. Pay from Master Wallet USDT (TRC20 crypto deposit).</p>
  <div class="wallet-pay-hint ok" id="instantWalletBalanceHint" style="margin-bottom:0.75rem">
    <span data-i18n="master_wallet_balance_label">Master Wallet</span>:
    <strong id="instantMasterBalance">—</strong>
  </div>
  <p class="hint" style="margin-bottom:0.75rem">
    <button type="button" class="btn btn-secondary btn-sm" data-open-usdt-topup data-i18n="top_up_master_wallet">Top up Master Wallet</button>
  </p>
  <form id="kripicardRequestForm" class="form">
    <div class="field"><label for="kripicardHolderName" data-i18n="name_on_card">Name on Card</label>
      <input id="kripicardHolderName" type="text" minlength="2" maxlength="50" autocomplete="name" placeholder="Cardholder name" required />
    </div>
    <div class="field"><label for="kripicardBinSelect" data-i18n="card_bin">Card BIN</label>
      <select id="kripicardBinSelect" required>
        <option value="">Loading BINs…</option>
      </select>
    </div>
    <div class="field"><label for="kripicardInitialLoad" data-i18n="initial_card_load">Initial Card Load Amount (USD)</label>
      <input id="kripicardInitialLoad" type="number" step="0.01" min="10" placeholder="10.00" required />
      <small id="kripicardMinDepositHint" class="hint" data-i18n="min_initial_deposit">Minimum initial deposit: $10.00</small>
    </div>
    <div class="field">
      <label data-i18n="pay_from">Pay From</label>
      <p class="wallet-pay-hint ok" style="margin:0" data-i18n="pay_master_wallet_issuance">Master Wallet USDT (1 USDT ≈ 1 USD — Instant Card only)</p>
    </div>
    <div id="kripicardPricingBreakdown" class="pricing-breakdown">
      <div class="pricing-row"><span data-i18n="initial_card_load_row">Initial Card Load</span><strong id="kpbInitialLoad">$0.00</strong></div>
      <div class="pricing-row"><span data-i18n="card_issuance_fee">+ Card Issuance Fee</span><strong id="kpbIssuanceFee">$0.00</strong></div>
      <div class="pricing-row"><span data-i18n="card_funding_fee">+ Funding Fee</span><strong id="kpbFundingFee">$0.00</strong></div>
      <div class="pricing-row"><span data-i18n="card_processing_fee">+ Processing Fee</span><strong id="kpbProcessingFee">$1.50</strong></div>
      <div class="pricing-row pricing-total"><span data-i18n="total_usd_required">= Total USD Required</span><strong id="kpbTotalUsd">$0.00</strong></div>
      <div class="pricing-row pricing-usdt"><span data-i18n="total_payable_usdt">Total Payable (USDT)</span><strong id="kpbTotalUsdt">$0.00 USDT</strong></div>
    </div>
    <button type="submit" class="btn btn-primary" id="btnRequestKripicard" data-i18n="submit_instant_card">Issue Instant Card</button>
  </form>
  <div id="kripicardRequestReceipt" class="pricing-receipt hidden"></div>
</div>`.trim();

  function $(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  function api() {
    return root.EisyServices && root.EisyServices.instantCard;
  }

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function estimateTotal(pricing, initialLoad) {
    const p = pricing || {};
    const load = Number(initialLoad) || 0;
    const issuance = Number(p.card_issuance_fee_usd) || 0;
    const pct = Number(p.card_funding_fee_percent) || 0;
    const funding = Math.round((load * pct) / 100 * 100) / 100;
    const processing = Number(p.card_processing_fee_usd);
    const proc = Number.isFinite(processing) ? processing : 1.5;
    return Math.round((load + issuance + funding + proc) * 100) / 100;
  }

  function updatePricingBreakdown(ctx) {
    const p = ctx.pricing;
    if (!p) return;
    const initial = parseFloat($('kripicardInitialLoad')?.value) || 0;
    const issuance = Number(p.card_issuance_fee_usd) || 0;
    const pct = Number(p.card_funding_fee_percent) || 0;
    const funding = Math.round((initial * pct) / 100 * 100) / 100;
    const processing = Number(p.card_processing_fee_usd);
    const proc = Number.isFinite(processing) ? processing : 1.5;
    const total = Math.round((initial + issuance + funding + proc) * 100) / 100;
    setText('kpbInitialLoad', `$${initial.toFixed(2)}`);
    setText('kpbIssuanceFee', `$${issuance.toFixed(2)}`);
    setText('kpbFundingFee', `$${funding.toFixed(2)}`);
    setText('kpbProcessingFee', `$${proc.toFixed(2)}`);
    setText('kpbTotalUsd', `$${total.toFixed(2)}`);
    setText('kpbTotalUsdt', `$${total.toFixed(2)} USDT`);
  }

  function renderMasterBalance(ctx) {
    const el = $('instantMasterBalance');
    if (!el) return;
    const bal = Number(ctx.getMasterBalance?.() ?? 0);
    const format = ctx.formatUsdt || ((n) => `$ ${Number(n).toFixed(2)} USDT`);
    el.textContent = format(bal);
  }

  async function loadBins() {
    const select = $('kripicardBinSelect');
    const svc = api();
    if (!select || !svc) return;
    try {
      const data = await svc.getBins();
      const bins = Array.isArray(data.bins) ? data.bins : [];
      const details = Array.isArray(data.details) ? data.details : [];
      const labelFor = (bin) => {
        const d = details.find((x) => String(x.bin) === String(bin));
        if (d?.label) return d.label;
        if (d?.brand) return `${String(d.brand).toUpperCase()} ${bin}`;
        return String(bin);
      };
      select.innerHTML = '';
      if (!bins.length) {
        select.innerHTML = '<option value="">No BINs available</option>';
        return;
      }
      bins.forEach((bin) => {
        const opt = document.createElement('option');
        opt.value = bin;
        opt.textContent = labelFor(bin);
        if (bin === data.default_bin) opt.selected = true;
        select.appendChild(opt);
      });
    } catch (err) {
      console.warn('[instantCardView bins]', err.message);
      select.innerHTML = '<option value="441357">US Visa 441357 (fallback)</option>';
    }
  }

  async function loadPricing(ctx) {
    const svc = api();
    if (!svc) return null;
    try {
      const data = await svc.getPricing();
      ctx.pricing = data;
      const min = data.minimum_initial_deposit_usd ?? 10;
      const input = $('kripicardInitialLoad');
      if (input) {
        input.min = min;
        input.placeholder = Number(min).toFixed(2);
        if (!input.value) input.value = Number(min).toFixed(2);
      }
      const hint = $('kripicardMinDepositHint');
      if (hint) hint.textContent = `Minimum initial deposit: $${Number(min).toFixed(2)}`;
      const nameInput = $('kripicardHolderName');
      if (nameInput && !nameInput.value && ctx.userName) {
        nameInput.value = ctx.userName;
      }
      updatePricingBreakdown(ctx);
      return data;
    } catch (err) {
      console.warn('[instantCardView pricing]', err.message);
      return null;
    }
  }

  function setVisible(visible) {
    const panel = $('instantCardApplyPanel');
    if (!panel) return;
    panel.classList.toggle('is-active', visible);
    panel.hidden = !visible;
    panel.classList.toggle('hidden', !visible);
  }

  function mount(host, { replace = true } = {}) {
    if (!host) return null;
    if (replace) host.innerHTML = TEMPLATE;
    else if (!host.querySelector('#kripicardRequestForm')) {
      host.insertAdjacentHTML('beforeend', TEMPLATE);
    }
    return $('instantCardApplyPanel');
  }

  function bind(ctx = {}) {
    const form = $('kripicardRequestForm');
    if (!form || form.dataset.bound === '1') return;
    form.dataset.bound = '1';

    $('kripicardInitialLoad')?.addEventListener('input', () => updatePricingBreakdown(ctx));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const svc = api();
      if (!svc) return;
      try {
        const initialLoad = parseFloat($('kripicardInitialLoad').value);
        const nameOnCard = ($('kripicardHolderName')?.value || '').trim();
        const bin = ($('kripicardBinSelect')?.value || '').trim();
        const required = ctx.pricing?.sample_pricing?.total_charge_usdt
          || estimateTotal(ctx.pricing, initialLoad);
        const masterBal = Number(ctx.getMasterBalance?.() ?? 0);
        const t = ctx.t;
        const toast = ctx.toast || (() => {});
        const formatUsdt = ctx.formatUsdt || ((n) => `$${Number(n).toFixed(2)} USDT`);

        if (!nameOnCard || nameOnCard.length < 2) {
          toast(typeof t === 'function' ? t('name_on_card_required') : 'Enter the name on card (min 2 characters)', 'error');
          return;
        }
        if (!bin) {
          toast(typeof t === 'function' ? t('select_card_bin') : 'Select a card BIN', 'error');
          return;
        }
        if (masterBal < required) {
          toast(`Insufficient Master Wallet. Need ${formatUsdt(required)}. Top up via crypto deposit first.`, 'error');
          ctx.openUsdtTopUp?.();
          return;
        }

        const data = await svc.requestCard({
          name_on_card: nameOnCard,
          card_holder_name: nameOnCard,
          initial_load_usd: initialLoad,
          bin,
          wallet_type: 'usdt',
        });

        const debited = data.wallet?.usdt_formatted || formatUsdt(data.wallet?.debited_usdt);
        toast(data.message || (typeof t === 'function' ? t('card_issued_ok') : 'Card issued'), 'ok');

        const receipt = $('kripicardRequestReceipt');
        if (receipt) {
          receipt.classList.remove('hidden');
          receipt.innerHTML = `
            <p class="wallet-pay-hint ok" style="margin:0">
              Instant Card issued.
              ${debited ? `<br><small>Debited ${debited}</small>` : ''}
            </p>`;
        }

        form.reset();
        if ($('kripicardHolderName') && nameOnCard) $('kripicardHolderName').value = nameOnCard;
        loadBins().catch(() => {});
        updatePricingBreakdown(ctx);
        ctx.onIssued?.(data);
      } catch (err) {
        if (err.code === 'SENSITIVE_AUTH_REQUIRED') ctx.openPinUnlock?.();
        (ctx.toast || (() => {}))(err.message || 'Instant card request failed', 'error');
        if (err.code === 'INSUFFICIENT_USDT_BALANCE') ctx.openUsdtTopUp?.();
      }
    });
  }

  async function activate(ctx = {}) {
    setVisible(true);
    renderMasterBalance(ctx);
    await Promise.all([
      loadPricing(ctx),
      loadBins(),
    ]);
    renderMasterBalance(ctx);
  }

  function deactivate() {
    setVisible(false);
  }

  root.EisyComponents.instantCardView = {
    FLOW,
    PROVIDER,
    TEMPLATE,
    mount,
    bind,
    activate,
    deactivate,
    setVisible,
    renderMasterBalance,
    updatePricingBreakdown,
    loadPricing,
    loadBins,
    estimateTotal,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
