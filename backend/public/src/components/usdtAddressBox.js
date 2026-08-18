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

  function switchDepositTab(tab) {
    const t = tab === 'usdt' ? 'usdt' : 'mmk';
    document.querySelectorAll('.deposit-tab').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.depositTab === t);
    });
    $('depositMmkPanel')?.classList.toggle('hidden', t !== 'mmk');
    $('depositUsdtPanel')?.classList.toggle('hidden', t !== 'usdt');
  }

  root.EisyComponents.usdtAddressBox = { showUsdtDepositAddress, switchDepositTab };
})(typeof globalThis !== 'undefined' ? globalThis : window);
