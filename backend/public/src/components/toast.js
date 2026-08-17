/**
 * Toast / copy-toast UI helpers.
 * window.EisyComponents.toast
 */
(function (root) {
  'use strict';

  root.EisyComponents = root.EisyComponents || {};

  function $(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  const state = { toastTimer: null, copyTimer: null };

  function showToast(message, type = 'ok', otpCode = null) {
    const el = $('authToast');
    if (!el) return;
    if (otpCode) {
      el.className = 'auth-toast otp';
      el.innerHTML = `${message}<span class="toast-otp-code">${otpCode}</span><small>Auto-filled in OTP field</small>`;
    } else {
      el.className = `auth-toast ${type === 'error' ? 'err' : 'ok'}`;
      el.textContent = message;
    }
    el.classList.remove('hidden');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.add('hidden'), otpCode ? 20000 : 6000);
  }

  function showCopyToast(message = 'Copied to clipboard!') {
    const el = $('copyToast');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(state.copyTimer);
    state.copyTimer = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  root.EisyComponents.toast = { showToast, showCopyToast };
})(typeof globalThis !== 'undefined' ? globalThis : window);
