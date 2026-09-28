/**
 * Noon-style Instant ↔ Standard pill switch.
 * Renders / switches independent InstantCardView and StandardCardView hosts.
 * Does not contain issuance logic for either provider.
 */
(function (root) {
  'use strict';

  root.EisyComponents = root.EisyComponents || {};

  const SWITCH_MARKUP = `
<div class="card-provider-switch-wrap">
  <p class="card-provider-switch-label" data-i18n="choose_card_type">Choose card type</p>
  <div
    id="cardProviderSwitch"
    class="card-provider-switch"
    role="tablist"
    aria-label="Card types"
    data-active="kripicard"
  >
    <span class="card-provider-switch-thumb" aria-hidden="true"></span>
    <button
      type="button"
      class="card-provider-tab is-active"
      role="tab"
      aria-selected="true"
      data-card-provider="kripicard"
      id="tabInstantCard"
    >
      <span class="card-provider-tab-title" data-i18n="pill_instant_card">Instant Card</span>
      <span class="card-provider-tab-sub" data-i18n="pill_no_kyc">No KYC</span>
    </button>
    <button
      type="button"
      class="card-provider-tab"
      role="tab"
      aria-selected="false"
      data-card-provider="bitnob"
      id="tabStandardCard"
    >
      <span class="card-provider-tab-title" data-i18n="pill_standard_card">Standard Card</span>
      <span class="card-provider-tab-sub" data-i18n="pill_verified">Verified</span>
    </button>
  </div>
</div>
<div class="card-provider-panels">
  <div id="instantCardViewHost" data-card-view-host="instant"></div>
  <div id="standardCardViewHost" data-card-view-host="standard"></div>
</div>
<div class="card-provider-switch-footer">
  <div
    class="card-provider-switch card-provider-switch--compact"
    data-mirror="cardProviderSwitch"
    role="presentation"
    aria-hidden="true"
  >
    <span class="card-provider-switch-thumb" aria-hidden="true"></span>
    <button type="button" class="card-provider-tab is-active" data-card-provider="kripicard" tabindex="-1">
      <span class="card-provider-tab-title" data-i18n="pill_instant_card">Instant Card</span>
      <span class="card-provider-tab-sub" data-i18n="pill_no_kyc">No KYC</span>
    </button>
    <button type="button" class="card-provider-tab" data-card-provider="bitnob" tabindex="-1">
      <span class="card-provider-tab-title" data-i18n="pill_standard_card">Standard Card</span>
      <span class="card-provider-tab-sub" data-i18n="pill_verified">Verified</span>
    </button>
  </div>
</div>`.trim();

  function $(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  function normalizeProvider(provider) {
    if (provider === 'bitnob' || provider === 'standard') return 'bitnob';
    return 'kripicard';
  }

  function getViews() {
    return {
      instant: root.EisyComponents.instantCardView,
      standard: root.EisyComponents.standardCardView,
    };
  }

  function syncSwitchUi(provider) {
    const which = normalizeProvider(provider);
    document.querySelectorAll('.card-provider-switch').forEach((track) => {
      track.setAttribute('data-active', which);
      track.querySelectorAll('.card-provider-tab').forEach((btn) => {
        const active = btn.getAttribute('data-card-provider') === which;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
        btn.tabIndex = track.id === 'cardProviderSwitch' ? (active ? 0 : -1) : -1;
      });
    });
  }

  function mountShell(host) {
    if (!host) return null;
    if (!host.querySelector('#cardProviderSwitch')) {
      host.innerHTML = SWITCH_MARKUP;
    }
    return host;
  }

  function mountViews({ instantHost, standardHost } = {}) {
    const views = getViews();
    const iHost = instantHost || $('instantCardViewHost');
    const sHost = standardHost || $('standardCardViewHost');
    if (views.instant && iHost && !iHost.querySelector('#kripicardRequestForm')) {
      views.instant.mount(iHost, { replace: true });
    }
    if (views.standard && sHost && !sHost.querySelector('#cardRequestForm')) {
      views.standard.mount(sHost, { replace: true });
    }
  }

  function bind(ctx = {}) {
    const main = $('cardProviderSwitch');
    if (!main || main.dataset.bound === '1') {
      // Still ensure views are bound if switch already exists
      const views = getViews();
      views.instant?.bind(ctx.instantCtx || ctx);
      views.standard?.bind(ctx.standardCtx || ctx);
      return;
    }
    main.dataset.bound = '1';
    const views = getViews();

    const onPick = (provider) => {
      setActive(provider, ctx);
    };

    document.querySelectorAll('.card-provider-tab[data-card-provider]').forEach((btn) => {
      btn.addEventListener('click', () => {
        onPick(btn.getAttribute('data-card-provider') || 'kripicard');
      });
    });

    main.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = e.key === 'ArrowRight' ? 'bitnob' : 'kripicard';
      onPick(next);
      main.querySelector(`[data-card-provider="${next}"]`)?.focus();
    });

    views.instant?.bind(ctx.instantCtx || ctx);
    views.standard?.bind(ctx.standardCtx || ctx);

    const initial = ctx.initialProvider
      || (ctx.isKycVerified?.() ? 'bitnob' : 'kripicard');
    setActive(initial, ctx);
  }

  function setActive(provider, ctx = {}) {
    const which = normalizeProvider(provider);
    const views = getViews();
    syncSwitchUi(which);

    if (which === 'kripicard') {
      views.standard?.deactivate();
      views.instant?.activate(ctx.instantCtx || ctx);
    } else {
      views.instant?.deactivate();
      views.standard?.activate(ctx.standardCtx || ctx);
    }

    ctx.onProviderChange?.(which);
    return which;
  }

  /**
   * Mount Noon switch + both views into a cards apply shell.
   */
  function mountInto(shellHost, ctx = {}) {
    mountShell(shellHost);
    mountViews();
    bind(ctx);
    return $('cardProviderSwitch');
  }

  root.EisyComponents.cardProviderSwitch = {
    SWITCH_MARKUP,
    mountShell,
    mountViews,
    mountInto,
    bind,
    setActive,
    syncSwitchUi,
    normalizeProvider,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
