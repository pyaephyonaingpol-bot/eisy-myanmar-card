/**
 * Deposit fee preview DOM updater.
 * window.EisyComponents.depositFeePreview
 */
(function (root) {
  'use strict';

  root.EisyComponents = root.EisyComponents || {};

  function $(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  function renderUsdtDepositFeePreview(preview) {
    if ($('usdtDepositPreviewGross')) {
      $('usdtDepositPreviewGross').textContent = preview ? `$${preview.amount_usdt.toFixed(2)}` : '—';
    }
    if ($('usdtDepositPreviewFee')) {
      $('usdtDepositPreviewFee').textContent = preview ? preview.fee_label : '—';
    }
    if ($('usdtDepositPreviewNet')) {
      $('usdtDepositPreviewNet').textContent = preview
        ? (preview.invalid_net ? 'Invalid' : `$${preview.net_usdt.toFixed(2)}`)
        : '—';
    }
  }

  function renderMmkDepositFeePreview(preview) {
    if ($('mmkDepositPreviewGross')) {
      $('mmkDepositPreviewGross').textContent = preview ? `${preview.amount_mmk.toLocaleString()} MMK` : '—';
    }
    if ($('mmkDepositPreviewFee')) {
      $('mmkDepositPreviewFee').textContent = preview ? preview.fee_label : '—';
    }
    if ($('mmkDepositPreviewNet')) {
      $('mmkDepositPreviewNet').textContent = preview
        ? (preview.invalid_net ? 'Invalid' : `${preview.net_mmk.toLocaleString()} MMK`)
        : '—';
    }
  }

  root.EisyComponents.depositFeePreview = {
    renderUsdtDepositFeePreview,
    renderMmkDepositFeePreview,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
