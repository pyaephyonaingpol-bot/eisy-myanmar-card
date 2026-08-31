/**
 * USDT deposit address + QR box.
 * window.EisyComponents.usdtAddressBox
 */
(function (root) {
  'use strict';

  root.EisyComponents = root.EisyComponents || {};

  function $(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  function showUsdtDepositAddress(network, address, { onAddressSet } = {}) {
    if ($('usdtNetworkLabel')) $('usdtNetworkLabel').textContent = network;
    $('usdtMerchantName')?.classList.add('hidden');
    if ($('usdtDepositAddress')) {
      $('usdtDepositAddress').textContent = address || '—';
      $('usdtDepositAddress').title = address || '';
    }
    onAddressSet?.(address || '');
    const qr = $('usdtQrCode');
    if (qr && address) {
      qr.src = `/api/qr?size=180&data=${encodeURIComponent(address)}`;
      qr.alt = `${network} deposit QR for ${address}`;
      qr.classList.remove('hidden');
      qr.onerror = () => {
        qr.src = `/assets/qr/placeholder-deposit.png`;
      };
    }
    $('usdtAddressBox')?.classList.remove('hidden');
  }

  function switchDepositTab() {
    const dash = root.Dashboard;
    if (dash && typeof dash.openUsdtTopUpModal === 'function') {
      dash.openUsdtTopUpModal();
      return;
    }
    $('depositUsdtPanel')?.classList.remove('hidden');
  }

  root.EisyComponents.usdtAddressBox = { showUsdtDepositAddress, switchDepositTab };
})(typeof globalThis !== 'undefined' ? globalThis : window);
