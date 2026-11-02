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

  const state = { toastTimer: null, copyTimer: null, insetRaf: 0 };

  /** Place success/error toasts below the visible app header + safe area. */
  function syncToastViewportInsets() {
    if (typeof document === 'undefined') return;
    const doc = document.documentElement;
    const auth = $('authScreen');
    const dash = $('dashboardScreen');
    const admin = $('adminApp');
    const authVisible = auth && !auth.classList.contains('hidden');
    const dashVisible = dash && !dash.classList.contains('hidden');
    const adminVisible = admin && !admin.classList.contains('hidden');

    doc.classList.toggle('auth-screen-active', authVisible && !dashVisible && !adminVisible);

    let header = null;
    if (adminVisible) header = document.querySelector('#adminApp .app-main .header');
    else if (dashVisible) header = document.querySelector('#dashboardScreen .app-main .header');

    if (header) {
      const rect = header.getBoundingClientRect();
      if (rect.height > 8 && rect.bottom > 0) {
        doc.style.setProperty('--toast-top-measured', `${Math.ceil(rect.bottom + 10)}px`);
        return;
      }
    }
    doc.style.removeProperty('--toast-top-measured');
  }

  function scheduleToastInsetSync() {
    if (typeof requestAnimationFrame === 'undefined') {
      syncToastViewportInsets();
      return;
    }
    if (state.insetRaf) return;
    state.insetRaf = requestAnimationFrame(() => {
      state.insetRaf = 0;
      syncToastViewportInsets();
    });
  }

  function showToast(message, type = 'ok', otpCode = null) {
    const el = $('authToast');
    if (!el) return;
    scheduleToastInsetSync();
    syncToastViewportInsets();
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
    scheduleToastInsetSync();
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(state.copyTimer);
    state.copyTimer = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  if (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof window.addEventListener === 'function'
  ) {
    window.addEventListener('resize', scheduleToastInsetSync, { passive: true });
    window.addEventListener('orientationchange', scheduleToastInsetSync, { passive: true });
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleToastInsetSync);
    } else {
      scheduleToastInsetSync();
    }
  }

  root.EisyComponents.toast = { showToast, showCopyToast, syncToastViewportInsets };
})(typeof globalThis !== 'undefined' ? globalThis : window);
