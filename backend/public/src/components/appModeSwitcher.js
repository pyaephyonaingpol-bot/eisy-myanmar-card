/**
 * Compact Instant ↔ Standard app-mode switcher.
 * Exclusively mounts InstantAppView or StandardAppView (full independent pages).
 * Zero shared wallet/card DOM between modes.
 */
(function (root) {
  'use strict';

  root.EisyComponents = root.EisyComponents || {};

  const STORAGE_KEY = 'eisy_app_mode';

  const SWITCH_MARKUP = `
<div class="app-mode-switch" id="appModeSwitch" role="tablist" aria-label="App mode" data-active="instant">
  <span class="app-mode-switch-thumb" aria-hidden="true"></span>
  <button type="button" class="app-mode-tab is-active" role="tab" aria-selected="true" data-app-mode="instant" id="tabAppInstant">
    <span class="app-mode-tab-title" data-i18n="pill_instant_card">Instant</span>
    <span class="app-mode-tab-sub" data-i18n="pill_no_kyc">No KYC</span>
  </button>
  <button type="button" class="app-mode-tab" role="tab" aria-selected="false" data-app-mode="standard" id="tabAppStandard">
    <span class="app-mode-tab-title" data-i18n="pill_standard_card">Standard</span>
    <span class="app-mode-tab-sub" data-i18n="pill_verified">Verified</span>
  </button>
</div>`.trim();

  const SHELL_MARKUP = `
<div class="app-mode-shell">
  <div class="app-mode-switch-bar">
    <p class="app-mode-switch-label" data-i18n="choose_app_mode">Mode</p>
    <div id="appModeSwitchMount"></div>
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
    document.querySelectorAll('.app-mode-switch').forEach((track) => {
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

    // Toggle mode-scoped nav items
    document.querySelectorAll('[data-mode-nav="instant"]').forEach((el) => {
      el.classList.toggle('hidden', which !== 'instant');
    });
    document.querySelectorAll('[data-mode-nav="standard"]').forEach((el) => {
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
    const target = into || $('appModeSwitchMount');
    if (!target) return null;
    if (!target.querySelector('#appModeSwitch')) {
      target.innerHTML = SWITCH_MARKUP;
    }
    return $('appModeSwitch');
  }

  function mountShell(host) {
    if (!host) return null;
    if (!host.querySelector('#appModeActiveHost')) {
      host.innerHTML = SHELL_MARKUP;
    }
    mountSwitch($('appModeSwitchMount'));
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

  function bind(ctx = {}) {
    _boundCtx = ctx;
    const main = $('appModeSwitch');
    if (!main) return;

    if (main.dataset.bound !== '1') {
      main.dataset.bound = '1';
      main.querySelectorAll('.app-mode-tab[data-app-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          setMode(btn.getAttribute('data-app-mode') || 'instant', _boundCtx || ctx);
        });
      });
      main.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const next = e.key === 'ArrowRight' ? 'standard' : 'instant';
        setMode(next, _boundCtx || ctx);
        main.querySelector(`[data-app-mode="${next}"]`)?.focus();
      });
    }

    const initial = ctx.initialMode
      || (ctx.isKycVerified?.() ? 'standard' : readStoredMode());
    setMode(initial, ctx);
  }

  function mountInto(shellHost, ctx = {}) {
    mountShell(shellHost);
    bind(ctx);
    return $('appModeSwitch');
  }

  /** Compact switch only (e.g. header) — does not own the content host. */
  function mountCompact(into, ctx = {}) {
    mountSwitch(into);
    _boundCtx = ctx;
    const main = $('appModeSwitch');
    if (main && main.dataset.bound !== '1') {
      main.dataset.bound = '1';
      main.querySelectorAll('.app-mode-tab[data-app-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = btn.getAttribute('data-app-mode') || 'instant';
          if ($('appModeActiveHost')) {
            setMode(mode, _boundCtx || ctx);
          } else {
            syncSwitchUi(mode);
            writeStoredMode(mode);
            (_boundCtx || ctx).onModeChange?.(mode);
          }
        });
      });
    }
    syncSwitchUi(ctx.initialMode || readStoredMode());
    return main;
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
    setMode,
    syncSwitchUi,
    normalizeMode,
    getActiveMode,
    readStoredMode,
    clearHost,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
