/**
 * Compact Instant ↔ Standard app-mode switcher.
 * Exclusively mounts InstantAppView or StandardAppView (full independent pages).
 * Zero shared wallet/card DOM between modes.
 *
 * Multiple switch pills (header + My Cards shell) share one mode; every pill is bound.
 */
(function (root) {
  'use strict';

  root.EisyComponents = root.EisyComponents || {};

  const STORAGE_KEY = 'eisy_app_mode';

  // No fixed element id — header and shell both mount a pill; duplicate ids broke binding.
  const SWITCH_MARKUP = `
<div class="app-mode-switch" data-app-mode-switch role="tablist" aria-label="App mode" data-active="instant">
  <span class="app-mode-switch-thumb" aria-hidden="true"></span>
  <button type="button" class="app-mode-tab is-active" role="tab" aria-selected="true" data-app-mode="instant">
    <span class="app-mode-tab-title" data-i18n="pill_instant_card">Instant</span>
    <span class="app-mode-tab-sub" data-i18n="pill_no_kyc">No KYC</span>
  </button>
  <button type="button" class="app-mode-tab" role="tab" aria-selected="false" data-app-mode="standard">
    <span class="app-mode-tab-title" data-i18n="pill_standard_card">Standard</span>
    <span class="app-mode-tab-sub" data-i18n="pill_verified">Verified</span>
  </button>
</div>`.trim();

  const SHELL_MARKUP = `
<div class="app-mode-shell">
  <div class="app-mode-switch-bar">
    <p class="app-mode-switch-label" data-i18n="choose_app_mode">Mode</p>
    <div data-app-mode-switch-mount></div>
  </div>
  <p id="appModeFlowDesc" class="hint app-mode-flow-desc" data-i18n="card_flow_desc_instant">
    Instant mode: USDT Wallet + Instant Card (No KYC).
  </p>
  <div id="appModeActiveHost" class="app-mode-active-host" data-app-mode-host aria-live="polite"></div>
</div>`.trim();

  let _activeMode = null;
  let _boundCtx = null;

  function $(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  function allSwitches() {
    if (typeof document === 'undefined') return [];
    return Array.from(document.querySelectorAll('[data-app-mode-switch]'));
  }

  function normalizeMode(mode) {
    if (mode === 'standard' || mode === 'bitnob') return 'standard';
    return 'instant';
  }

  function readStoredMode() {
    try {
      return normalizeMode(localStorage.getItem(STORAGE_KEY) || 'instant');
    } catch (_) {
      return 'instant';
    }
  }

  function writeStoredMode(mode) {
    try {
      localStorage.setItem(STORAGE_KEY, normalizeMode(mode));
    } catch (_) { /* ignore */ }
  }

  function getApps() {
    return {
      instant: root.EisyComponents.instantAppView,
      standard: root.EisyComponents.standardAppView,
    };
  }

  function syncSwitchUi(mode) {
    const which = normalizeMode(mode);
    allSwitches().forEach((track) => {
      track.setAttribute('data-active', which);
      track.querySelectorAll('.app-mode-tab').forEach((btn) => {
        const active = btn.getAttribute('data-app-mode') === which;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
        btn.tabIndex = active ? 0 : -1;
      });
    });

    const desc = $('appModeFlowDesc');
    if (desc) {
      if (which === 'instant') {
        desc.setAttribute('data-i18n', 'card_flow_desc_instant');
        desc.textContent = 'Instant mode: USDT Wallet + Instant Card (No KYC).';
      } else {
        desc.setAttribute('data-i18n', 'card_flow_desc_standard');
        desc.textContent = 'Standard mode: Bitnob wallet + Standard Card (Verified).';
      }
      if (typeof root.I18n !== 'undefined' && root.I18n.apply) {
        root.I18n.apply(desc.parentElement || document);
      }
    }

    document.querySelectorAll('[data-mode-nav="instant"], [data-mode-shell="instant"]').forEach((el) => {
      el.classList.toggle('hidden', which !== 'instant');
    });
    document.querySelectorAll('[data-mode-nav="standard"], [data-mode-shell="standard"]').forEach((el) => {
      el.classList.toggle('hidden', which !== 'standard');
    });
    document.documentElement.setAttribute('data-app-mode', which);
  }

  function clearHost() {
    const host = $('appModeActiveHost');
    const apps = getApps();
    apps.instant?.deactivate?.();
    apps.standard?.deactivate?.();
    if (host) host.innerHTML = '';
    _activeMode = null;
  }

  function mountSwitch(into) {
    if (!into) return null;
    if (!into.querySelector('[data-app-mode-switch]')) {
      into.innerHTML = SWITCH_MARKUP;
    }
    return into.querySelector('[data-app-mode-switch]');
  }

  function mountShell(host) {
    if (!host) return null;
    if (!host.querySelector('#appModeActiveHost')) {
      host.innerHTML = SHELL_MARKUP;
    }
    const mount = host.querySelector('[data-app-mode-switch-mount]') || $('appModeSwitchMount');
    mountSwitch(mount);
    if (typeof root.I18n !== 'undefined' && root.I18n.apply) {
      root.I18n.apply(host);
    }
    return host;
  }

  async function setMode(mode, ctx = {}) {
    const which = normalizeMode(mode);
    const apps = getApps();
    const host = $('appModeActiveHost');
    const merged = {
      ...(_boundCtx || {}),
      ...ctx,
      instantCtx: ctx.instantCtx || (_boundCtx && _boundCtx.instantCtx) || ctx,
      standardCtx: ctx.standardCtx || (_boundCtx && _boundCtx.standardCtx) || ctx,
    };
    _boundCtx = merged;

    syncSwitchUi(which);
    writeStoredMode(which);

    if (!host) {
      _activeMode = which;
      merged.onModeChange?.(which);
      return which;
    }

    clearHost();

    if (which === 'instant') {
      apps.instant?.mount(host, { replace: true });
      apps.instant?.bind(merged.instantCtx || merged);
      await apps.instant?.activate(merged.instantCtx || merged);
    } else {
      apps.standard?.mount(host, { replace: true });
      apps.standard?.bind(merged.standardCtx || merged);
      await apps.standard?.activate(merged.standardCtx || merged);
    }

    _activeMode = which;
    merged.onModeChange?.(which);
    return which;
  }

  function bindTrack(track, ctx) {
    if (!track || track.dataset.bound === '1') return;
    track.dataset.bound = '1';
    track.querySelectorAll('.app-mode-tab[data-app-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setMode(btn.getAttribute('data-app-mode') || 'instant', _boundCtx || ctx);
      });
    });
    track.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = e.key === 'ArrowRight' ? 'standard' : 'instant';
      setMode(next, _boundCtx || ctx);
      track.querySelector(`[data-app-mode="${next}"]`)?.focus();
    });
  }

  /** Bind click/keyboard handlers on every Instant↔Standard pill currently in the DOM. */
  function bindAllTracks(ctx = {}) {
    _boundCtx = { ...(_boundCtx || {}), ...ctx };
    allSwitches().forEach((track) => bindTrack(track, _boundCtx));
  }

  function bind(ctx = {}) {
    _boundCtx = ctx;
    bindAllTracks(ctx);
    const initial = ctx.initialMode
      || (ctx.isKycVerified?.() ? 'standard' : readStoredMode());
    setMode(initial, ctx);
  }

  function mountInto(shellHost, ctx = {}) {
    mountShell(shellHost);
    bind(ctx);
    return shellHost?.querySelector('[data-app-mode-switch]') || null;
  }

  /** Compact switch only (e.g. header) — does not own the content host. */
  function mountCompact(into, ctx = {}) {
    mountSwitch(into);
    _boundCtx = { ...(_boundCtx || {}), ...ctx };
    bindAllTracks(_boundCtx);
    syncSwitchUi(ctx.initialMode || readStoredMode());
    return into?.querySelector('[data-app-mode-switch]') || null;
  }

  function getActiveMode() {
    return _activeMode || readStoredMode();
  }

  root.EisyComponents.appModeSwitcher = {
    SWITCH_MARKUP,
    SHELL_MARKUP,
    STORAGE_KEY,
    mountShell,
    mountSwitch,
    mountCompact,
    mountInto,
    bind,
    bindAllTracks,
    setMode,
    syncSwitchUi,
    normalizeMode,
    getActiveMode,
    readStoredMode,
    clearHost,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
