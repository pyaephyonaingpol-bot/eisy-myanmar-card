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

  function formatUsdtAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '—';
    return `$${amount.toFixed(2)} USDT`;
  }

  function renderUsdtDepositFeePreview(preview) {
    if ($('usdtDepositPreviewGross')) {
      $('usdtDepositPreviewGross').textContent = preview ? formatUsdtAmount(preview.amount_usdt) : '—';
    }
    if ($('usdtDepositPreviewFee')) {
      $('usdtDepositPreviewFee').textContent = preview ? formatUsdtAmount(preview.fee_usdt) : '—';
    }
    if ($('usdtDepositPreviewFeeLabel')) {
      $('usdtDepositPreviewFeeLabel').textContent = preview?.fee_label || '';
    }
    if ($('usdtDepositPreviewNet')) {
      $('usdtDepositPreviewNet').textContent = preview && !preview.invalid_net
        ? formatUsdtAmount(preview.net_usdt)
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
