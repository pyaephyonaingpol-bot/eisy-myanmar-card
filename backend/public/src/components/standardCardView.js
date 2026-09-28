/**
 * Standard Card view — KYC / Bitnob direct wallet + issuance only.
 * Mounts its own markup. Must never call Non-KYC Instant / Master Wallet issue APIs.
 */
(function (root) {
  'use strict';

  root.EisyComponents = root.EisyComponents || {};

  const FLOW = 'standard';
  const PROVIDER = 'bitnob';

  const TEMPLATE = `
<div id="standardCardApplyPanel" class="card-provider-panel" data-card-page="standard" data-provider="bitnob" role="tabpanel" aria-labelledby="tabStandardCard" hidden>
  <h2 data-i18n="apply_standard_card">Standard Card (Verified)</h2>
  <p class="hint" style="margin-bottom:0.75rem" data-i18n="apply_standard_card_hint">Requires verified KYC. Pay from your Standard Card wallet (Bitnob deposit address — separate from Master Wallet).</p>
  <div id="bitnobKycGate" class="wallet-pay-hint err hidden" data-i18n="standard_kyc_required">Complete KYC verification before applying for a Standard Card. Without KYC, use Instant Card instead.</div>
  <div id="standardWalletPanel" class="standard-wallet-panel" style="margin-bottom:0.85rem">
    <div class="wallet-pay-hint ok" style="margin-bottom:0.5rem">
      <span data-i18n="standard_wallet_balance_label">Standard Card wallet</span>:
      <strong id="standardBitnobBalance">—</strong>
    </div>
    <div class="field" style="margin-bottom:0.5rem">
      <label data-i18n="standard_deposit_address_label">Deposit address</label>
      <input id="standardDepositAddress" type="text" readonly value="" placeholder="Loading…" />
      <small class="hint" id="standardDepositChainHint"></small>
    </div>
    <button type="button" class="btn btn-secondary btn-sm" id="btnRefreshStandardDeposit" data-i18n="refresh_standard_deposit">Refresh deposit address</button>
  </div>
  <form id="cardRequestForm" class="form">
    <div class="field"><label for="cardHolderNameInput" data-i18n="name_on_card">Name on Card</label>
      <input id="cardHolderNameInput" type="text" minlength="2" maxlength="50" autocomplete="name" placeholder="Cardholder name" required />
    </div>
    <div class="field"><label for="cardInitialLoad" data-i18n="initial_card_load">Initial Card Load Amount (USD)</label>
      <input id="cardInitialLoad" type="number" step="0.01" min="10" placeholder="10.00" required />
      <small id="cardMinDepositHint" class="hint" data-i18n="min_initial_deposit">Minimum initial deposit: $10.00</small>
    </div>
    <div class="field">
      <label data-i18n="pay_from">Pay From</label>
      <p id="cardPayFromUsdt" class="wallet-pay-hint ok" style="margin:0" data-i18n="pay_standard_wallet_issuance">Standard Card wallet (Bitnob deposits — not Master Wallet)</p>
      <input type="hidden" id="cardPaymentMethod" value="wallet_bitnob_usdt" />
    </div>
    <p id="cardWalletHint" class="wallet-pay-hint ok hidden"></p>
    <p id="cardWalletError" class="wallet-pay-hint err hidden"></p>
    <div id="cardPricingBreakdown" class="pricing-breakdown">
      <div class="pricing-row"><span data-i18n="initial_card_load_row">Initial Card Load</span><strong id="pbInitialLoad">$0.00</strong></div>
      <div class="pricing-row"><span data-i18n="card_issuance_fee">+ Card Issuance Fee</span><strong id="pbIssuanceFee">$0.00</strong></div>
      <div class="pricing-row"><span data-i18n="card_funding_fee">+ Funding Fee</span><strong id="pbFundingFee">$0.00</strong></div>
      <div class="pricing-row pricing-total"><span data-i18n="total_usd_required">= Total USD Required</span><strong id="pbTotalUsd">$0.00</strong></div>
      <div class="pricing-row pricing-usdt" id="pbUsdtRow"><span data-i18n="total_payable_usdt">Total Payable (USDT)</span><strong id="pbTotalUsdt">$0.00 USDT</strong></div>
      <p id="pbRateLabel" class="hint pricing-rate" data-i18n="usdt_parity_rate">1 USDT ≈ 1 USD</p>
    </div>
    <button type="submit" class="btn btn-primary" id="btnRequestCard" data-i18n="submit_standard_card">Issue Standard Card</button>
  </form>
  <div id="cardRequestReceipt" class="pricing-receipt hidden"></div>
</div>`.trim();

  function $(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  function api() {
    return root.EisyServices && root.EisyServices.standardCard;
  }

  function syncKycGate(ctx) {
    const gate = $('bitnobKycGate');
    const form = $('cardRequestForm');
    const btn = $('btnRequestCard');
    const panel = $('standardWalletPanel');
    const verified = Boolean(ctx.isKycVerified?.());
    if (gate) gate.classList.toggle('hidden', verified);
    if (panel) panel.classList.toggle('hidden', !verified);
    if (form) {
      form.querySelectorAll('input,button,select').forEach((el) => {
        if (el.id === 'cardPaymentMethod') return;
        el.disabled = !verified;
      });
    }
    if (btn) btn.disabled = !verified;
  }

  function renderWalletBalance(ctx) {
    const el = $('standardBitnobBalance');
    if (!el) return;
    const bal = Number(ctx.getBitnobBalance?.() ?? 0);
    const format = ctx.formatUsdt || ((n) => `$ ${Number(n).toFixed(2)} USDT`);
    el.textContent = format(bal);
  }

  function updatePricingBreakdown(ctx) {
    const p = ctx.pricing;
    if (!p) return;

    const initial = parseFloat($('cardInitialLoad')?.value) || 0;
    const bitnobCreate = Number(p.bitnob_create_fee_usd);
    const createFee = Number.isFinite(bitnobCreate) && bitnobCreate >= 0 ? bitnobCreate : 2;
    const platformIssuance = Number(p.card_issuance_fee_usd) || 0;
    const issuanceFee = Math.round((createFee + platformIssuance) * 100) / 100;
    const schedule = p.bitnob_fee_schedule || {};
    const threshold = Number(schedule.fund_fee_threshold_usd) || 100;
    const flatFund = Number(schedule.fund_fee_flat_usd);
    const pctFund = Number(schedule.fund_fee_percent);
    let fundingFee = 0;
    if (initial > 0) {
      if (initial < threshold) {
        fundingFee = Number.isFinite(flatFund) ? flatFund : 1;
      } else {
        const pct = Number.isFinite(pctFund) ? pctFund : 1;
        fundingFee = Math.round((initial * pct / 100) * 100) / 100;
      }
    }
    const processingFee = Number(p.card_processing_fee_usd);
    const processingFeeUsd = Number.isFinite(processingFee) && processingFee >= 0 ? processingFee : 1.5;
    const totalUsd = Math.round((initial + issuanceFee + fundingFee + processingFeeUsd) * 100) / 100;

    if ($('pbInitialLoad')) $('pbInitialLoad').textContent = `$${initial.toFixed(2)}`;
    if ($('pbIssuanceFee')) $('pbIssuanceFee').textContent = `$${issuanceFee.toFixed(2)}`;
    if ($('pbFundingFee')) $('pbFundingFee').textContent = `$${fundingFee.toFixed(2)}`;
    if ($('pbProcessingFee')) $('pbProcessingFee').textContent = `$${processingFeeUsd.toFixed(2)}`;
    if ($('pbTotalUsd')) $('pbTotalUsd').textContent = `$${totalUsd.toFixed(2)}`;
    if ($('pbTotalUsdt')) $('pbTotalUsdt').textContent = `${totalUsd.toFixed(2)} USDT`;
    if ($('pbUsdtRow')) $('pbUsdtRow').classList.remove('hidden');

    ctx.pricing = {
      ...p,
      total_usd_required: totalUsd,
      total_usdt: totalUsd,
    };
  }

  async function loadPricing(ctx) {
    const svc = api();
    if (!svc) return null;
    try {
      const data = await svc.getPricing();
      ctx.pricing = data;
      ctx.onPricingLoaded?.(data);
      const min = data.minimum_initial_deposit_usd ?? 10;
      const input = $('cardInitialLoad');
      if (input) {
        input.min = min;
        input.placeholder = Number(min).toFixed(2);
        if (!input.value) input.value = Number(min).toFixed(2);
      }
      const hint = $('cardMinDepositHint');
      if (hint) hint.textContent = `Minimum initial deposit: $${Number(min).toFixed(2)}`;
      const nameInput = $('cardHolderNameInput');
      if (nameInput && !nameInput.value && ctx.userName) {
        nameInput.value = ctx.userName;
      }
      syncKycGate(ctx);
      updatePricingBreakdown(ctx);
      return data;
    } catch (err) {
      console.warn('[standardCardView pricing]', err.message);
      return null;
    }
  }

  async function loadDepositAddress(ctx, { force = false } = {}) {
    const input = $('standardDepositAddress');
    const chainHint = $('standardDepositChainHint');
    const panel = $('standardWalletPanel');
    if (!ctx.isKycVerified?.()) {
      if (panel) panel.classList.add('hidden');
      return null;
    }
    if (panel) panel.classList.remove('hidden');
    if (input && !force && input.value && input.value !== 'Loading…') {
      return { address: input.value };
    }
    const svc = api();
    if (!svc) return null;
    try {
      if (input) input.value = 'Loading…';
      const data = await svc.getDepositAddress(force);
      if (input) input.value = data.address || '';
      if (chainHint) {
        chainHint.textContent = data.chain
          ? `Network: ${String(data.chain).toUpperCase()} · Standard Card deposits only`
          : 'Standard Card deposits only (not Master Wallet)';
      }
      ctx.deposit = data;
      return data;
    } catch (err) {
      if (input) input.value = '';
      if (chainHint) chainHint.textContent = err.message || 'Deposit address unavailable';
      console.warn('[standardCardView deposit]', err.message);
      return null;
    }
  }

  async function loadFundingWallets(ctx) {
    const svc = api();
    if (!svc) return null;
    try {
      const data = await svc.getCardFundingWallets();
      ctx.fundingWallets = data;
      if (typeof ctx.setBitnobBalance === 'function') {
        ctx.setBitnobBalance(Number(data?.standard?.balance_usdt ?? 0));
      }
      renderWalletBalance(ctx);
      return data;
    } catch (err) {
      console.warn('[standardCardView wallets]', err.message);
      return null;
    }
  }

  function setVisible(visible) {
    const panel = $('standardCardApplyPanel') || $('bitnobApplyPanel');
    if (!panel) return;
    panel.classList.toggle('is-active', visible);
    panel.hidden = !visible;
    panel.classList.toggle('hidden', !visible);
  }

  function mount(host, { replace = true } = {}) {
    if (!host) return null;
    if (replace) host.innerHTML = TEMPLATE;
    else if (!host.querySelector('#cardRequestForm')) {
      host.insertAdjacentHTML('beforeend', TEMPLATE);
    }
    return $('standardCardApplyPanel');
  }

  function bind(ctx = {}) {
    const form = $('cardRequestForm');
    if (!form || form.dataset.bound === '1') return;
    form.dataset.bound = '1';

    $('cardInitialLoad')?.addEventListener('input', () => updatePricingBreakdown(ctx));
    const refreshBtn = $('btnRefreshStandardDeposit');
    if (refreshBtn && refreshBtn.dataset.bound !== '1') {
      refreshBtn.dataset.bound = '1';
      refreshBtn.addEventListener('click', () => {
        loadDepositAddress(ctx, { force: true }).catch(() => {});
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const svc = api();
      if (!svc) return;
      const t = ctx.t;
      const toast = ctx.toast || (() => {});
      const formatUsdt = ctx.formatUsdt || ((n) => `$${Number(n).toFixed(2)} USDT`);

      try {
        if (!ctx.isKycVerified?.()) {
          toast(
            typeof t === 'function' ? t('standard_kyc_required') : 'Complete KYC before applying for a Standard Card.',
            'error'
          );
          ctx.onNeedInstant?.();
          return;
        }

        const initialLoad = parseFloat($('cardInitialLoad').value);
        const nameOnCard = ($('cardHolderNameInput')?.value || '').trim();
        const required = ctx.pricing?.total_usdt ?? ctx.pricing?.total_usd_required ?? 0;
        const bitnobBal = Number(ctx.getBitnobBalance?.() ?? 0);

        if (!nameOnCard || nameOnCard.length < 2) {
          toast(typeof t === 'function' ? t('name_on_card_required') : 'Enter the name on card (min 2 characters)', 'error');
          return;
        }
        if (ctx.pricing && ctx.pricing.bitnob_customer_ready === false) {
          toast(
            typeof t === 'function'
              ? t('bitnob_customer_required')
              : 'Complete Card KYC first so your verified card profile is ready, then try again.',
            'error'
          );
          return;
        }
        if (bitnobBal < required) {
          toast(
            `Insufficient Standard Card wallet. Need ${formatUsdt(required)}. Deposit to your Standard Card address first.`,
            'error'
          );
          loadDepositAddress(ctx, { force: true }).catch(() => {});
          return;
        }

        const data = await svc.requestCard({
          name_on_card: nameOnCard,
          card_holder_name: nameOnCard,
          initial_load_usd: initialLoad,
          pay_from_wallet: true,
          wallet_type: 'bitnob_usdt',
        });

        const debited = data.wallet?.usdt_formatted || formatUsdt(data.wallet?.debited_usdt);
        toast(data.message || (data.issued
          ? (typeof t === 'function' ? t('card_issued_ok') : 'Card issued')
          : (typeof t === 'function' ? t('card_request_submitted') : 'Request submitted')), 'ok');

        const receipt = $('cardRequestReceipt');
        if (receipt) {
          receipt.classList.remove('hidden');
          receipt.innerHTML = `
            <p class="wallet-pay-hint ok" style="margin:0">
              ${data.issued
                ? (typeof t === 'function' ? t('card_issued_ok') : 'Your virtual card is ready.')
                : (typeof t === 'function' ? t('card_request_pending_msg') : 'Request pending.')}
              ${debited ? `<br><small>${typeof t === 'function' ? t('card_request_deducted', { amount: debited }) : `Debited ${debited}`}</small>` : ''}
            </p>`;
        }

        form.reset();
        if ($('cardHolderNameInput') && nameOnCard) $('cardHolderNameInput').value = nameOnCard;
        if ($('cardPaymentMethod')) $('cardPaymentMethod').value = 'wallet_bitnob_usdt';
        updatePricingBreakdown(ctx);
        loadFundingWallets(ctx).catch(() => {});
        ctx.onIssued?.(data);
      } catch (err) {
        if (err.code === 'SENSITIVE_AUTH_REQUIRED') ctx.openPinUnlock?.();
        if (
          err.code === 'INSUFFICIENT_BITNOB_BALANCE'
          || err.code === 'BITNOB_WALLET_ONLY_CARD_ISSUANCE'
          || err.code === 'BITNOB_CUSTOMER_REQUIRED'
          || err.code === 'KYC_REQUIRED_FOR_BITNOB'
        ) {
          toast(err.message, 'error');
          if (err.code === 'INSUFFICIENT_BITNOB_BALANCE' || err.code === 'BITNOB_WALLET_ONLY_CARD_ISSUANCE') {
            loadDepositAddress(ctx, { force: true }).catch(() => {});
          }
          if (err.code === 'KYC_REQUIRED_FOR_BITNOB') ctx.onNeedInstant?.();
          return;
        }
        toast(err.message || 'Card request failed', 'error');
      }
    });
  }

  async function activate(ctx = {}) {
    setVisible(true);
    syncKycGate(ctx);
    renderWalletBalance(ctx);
    await loadPricing(ctx);
    await loadFundingWallets(ctx);
    if (ctx.isKycVerified?.()) {
      await loadDepositAddress(ctx, { force: false });
    }
    syncKycGate(ctx);
    renderWalletBalance(ctx);
  }

  function deactivate() {
    setVisible(false);
  }

  root.EisyComponents.standardCardView = {
    FLOW,
    PROVIDER,
    TEMPLATE,
    mount,
    bind,
    activate,
    deactivate,
    setVisible,
    syncKycGate,
    renderWalletBalance,
    updatePricingBreakdown,
    loadPricing,
    loadDepositAddress,
    loadFundingWallets,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
