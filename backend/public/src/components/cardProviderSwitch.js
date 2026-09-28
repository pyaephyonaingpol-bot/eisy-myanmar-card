/**
 * Noon-style Instant ↔ Standard pill switch.
 * Mounts exactly ONE independent view at a time into a single host —
 * like swapping full HTML pages. No overlapping wallet DOM or handlers.
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
<p id="cardProviderFlowDesc" class="hint card-provider-flow-desc" data-i18n="card_flow_desc_instant" style="margin:0 0 1rem">
  Instant Card uses your internal USDT Wallet and issues via Instant (No KYC).
</p>
<div class="card-provider-panels">
  <div id="cardProviderActiveHost" data-card-view-host="active" aria-live="polite"></div>
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

  let _activeProvider = null;
  let _boundCtx = null;

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

  function activeHost() {
    return $('cardProviderActiveHost');
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

    const desc = $('cardProviderFlowDesc');
    if (desc) {
      if (which === 'kripicard') {
        desc.setAttribute('data-i18n', 'card_flow_desc_instant');
        desc.textContent = 'Instant Card uses your internal USDT Wallet and issues via Instant (No KYC).';
      } else {
        desc.setAttribute('data-i18n', 'card_flow_desc_standard');
        desc.textContent = 'Standard Card uses your Bitnob wallet deposit address and requires verified KYC.';
      }
      if (typeof root.I18n !== 'undefined' && typeof root.I18n.apply === 'function') {
        root.I18n.apply(desc.parentElement || document);
      }
    }
  }

  function clearActiveHost() {
    const host = activeHost();
    const views = getViews();
    views.instant?.unmount?.(host);
    views.standard?.unmount?.(host);
    if (host) host.innerHTML = '';
    _activeProvider = null;
  }

  function mountShell(host) {
    if (!host) return null;
    if (!host.querySelector('#cardProviderSwitch')) {
      host.innerHTML = SWITCH_MARKUP;
    }
    return host;
  }

  /**
   * Exclusive mount: destroy whatever is in the active host, then mount
   * only Instant OR only Standard — never both.
   */
  async function setActive(provider, ctx = {}) {
    const which = normalizeProvider(provider);
    const views = getViews();
    const host = activeHost();
    const mergedCtx = {
      ...(_boundCtx || {}),
      ...ctx,
      instantCtx: ctx.instantCtx || (_boundCtx && _boundCtx.instantCtx) || ctx,
      standardCtx: ctx.standardCtx || (_boundCtx && _boundCtx.standardCtx) || ctx,
    };
    _boundCtx = mergedCtx;

    syncSwitchUi(which);

    if (!host) {
      _activeProvider = which;
      mergedCtx.onProviderChange?.(which);
      return which;
    }

    // Full page-style swap: wipe previous view DOM + handlers first.
    clearActiveHost();

    if (which === 'kripicard') {
      views.instant?.mount(host, { replace: true });
      views.instant?.bind(mergedCtx.instantCtx || mergedCtx);
      await views.instant?.activate(mergedCtx.instantCtx || mergedCtx);
    } else {
      views.standard?.mount(host, { replace: true });
      views.standard?.bind(mergedCtx.standardCtx || mergedCtx);
      await views.standard?.activate(mergedCtx.standardCtx || mergedCtx);
    }

    _activeProvider = which;
    mergedCtx.onProviderChange?.(which);
    return which;
  }

  function bind(ctx = {}) {
    _boundCtx = ctx;
    const main = $('cardProviderSwitch');
    if (!main) return;

    if (main.dataset.bound !== '1') {
      main.dataset.bound = '1';

      document.querySelectorAll('.card-provider-tab[data-card-provider]').forEach((btn) => {
        btn.addEventListener('click', () => {
          setActive(btn.getAttribute('data-card-provider') || 'kripicard', _boundCtx || ctx);
        });
      });

      main.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const next = e.key === 'ArrowRight' ? 'bitnob' : 'kripicard';
        setActive(next, _boundCtx || ctx);
        main.querySelector(`[data-card-provider="${next}"]`)?.focus();
      });
    }

    const initial = ctx.initialProvider
      || (ctx.isKycVerified?.() ? 'bitnob' : 'kripicard');
    setActive(initial, ctx);
  }

  function mountInto(shellHost, ctx = {}) {
    mountShell(shellHost);
    clearActiveHost();
    bind(ctx);
    return $('cardProviderSwitch');
  }

  function getActiveProvider() {
    return _activeProvider;
  }

  root.EisyComponents.cardProviderSwitch = {
    SWITCH_MARKUP,
    mountShell,
    mountInto,
    bind,
    setActive,
    syncSwitchUi,
    normalizeProvider,
    clearActiveHost,
    getActiveProvider,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
