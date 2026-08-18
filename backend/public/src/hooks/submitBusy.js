/**
 * Submit-button busy / spinner helper (Step 4 hook).
 * window.EisyHooks.submitBusy
 */
(function (root) {
  'use strict';

  root.EisyHooks = root.EisyHooks || {};

  function setSubmitBusy(btn, busy, { loadingLabel, idleLabel } = {}) {
    if (!btn) return;
    if (busy) {
      if (!btn.dataset.idleLabel) {
        btn.dataset.idleLabel = (btn.textContent || '').trim();
      }
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.classList.add('is-busy');
      const label = loadingLabel || 'Submitting…';
      btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>${label}</span>`;
      return;
    }
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.classList.remove('is-busy');
    btn.textContent = idleLabel || btn.dataset.idleLabel || btn.textContent;
    delete btn.dataset.idleLabel;
  }

  /**
   * Simple in-flight guard factory for form submit handlers.
   */
  function createInFlightGuard() {
    let inFlight = false;
    return {
      get busy() { return inFlight; },
      tryStart() {
        if (inFlight) return false;
        inFlight = true;
        return true;
      },
      end() { inFlight = false; },
      reset() { inFlight = false; },
    };
  }

  root.EisyHooks.submitBusy = { setSubmitBusy, createInFlightGuard };
})(typeof globalThis !== 'undefined' ? globalThis : window);
