/**
 * P2P marketplace API (user SPA) — True P2P Escrow endpoints.
 */
(function (root) {
  'use strict';

  root.EisyServices = root.EisyServices || {};
  const api = () => root.EisyServices.api;

  root.EisyServices.p2p = {
    getMarket({ side, network } = {}) {
      const qs = new URLSearchParams();
      if (side) qs.set('side', side);
      if (network) qs.set('network', network);
      const query = qs.toString();
      return api().request('GET', `/api/p2p/market${query ? `?${query}` : ''}`);
    },
    getFeeInfo() {
      return api().request('GET', '/api/p2p/fee-info');
    },
    getActiveOrders() {
      return api().request('GET', '/api/p2p/active-orders');
    },
    getActiveOrder(type, id) {
      return api().request('GET', `/api/p2p/active-orders/${encodeURIComponent(type)}/${id}`);
    },
    listAds() {
      return api().request('GET', '/api/p2p/ads');
    },
    createAd(body) {
      return api().request('POST', '/api/p2p/ads', body, { sensitive: true });
    },
    cancelAd(adId) {
      return api().request('POST', `/api/p2p/ads/${adId}/cancel`, null, { sensitive: true });
    },
    createBuyOrder(body) {
      return api().request('POST', '/api/p2p/buy-orders', body, { sensitive: true });
    },
    confirmBuyTransfer(orderId, body) {
      return api().request(
        'POST',
        `/api/p2p/buy-orders/${orderId}/confirm-transfer`,
        body,
        { sensitive: true }
      );
    },
    confirmBuyTransferForm(orderId, formData) {
      return api().form(
        `/api/p2p/buy-orders/${orderId}/confirm-transfer`,
        formData,
        { sensitive: true }
      );
    },
    releaseBuyOrder(id) {
      return api().request('POST', `/api/p2p/buy-orders/${id}/release`, null, { sensitive: true });
    },
    createSellOrder(body) {
      return api().request('POST', '/api/p2p/sell-orders', body, { sensitive: true });
    },
    confirmSellMmkAndRelease(id) {
      return api().request(
        'POST',
        `/api/p2p/sell-orders/${id}/confirm-mmk-and-release`,
        null,
        { sensitive: true }
      );
    },
    cancelSellOrder(id) {
      return api().request('POST', `/api/p2p/sell-orders/${id}/cancel`, null, { sensitive: true });
    },
    getMessages(orderType, orderId) {
      return api().request('GET', `/api/p2p/orders/${orderType}/${orderId}/messages`);
    },
    postMessageForm(orderType, orderId, formData) {
      return api().form(`/api/p2p/orders/${orderType}/${orderId}/messages`, formData);
    },
    openDisputeForm(orderType, orderId, formData) {
      return api().form(`/api/p2p/orders/${orderType}/${orderId}/dispute`, formData, { sensitive: true });
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
