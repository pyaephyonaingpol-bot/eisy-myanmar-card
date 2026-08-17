/**
 * P2P marketplace API (user SPA) — common endpoints.
 */
(function (root) {
  'use strict';

  root.EisyServices = root.EisyServices || {};
  const api = () => root.EisyServices.api;

  root.EisyServices.p2p = {
    getMarket() {
      return api().request('GET', '/api/p2p/market');
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
      return api().request('POST', `/api/p2p/ads/${adId}/cancel`);
    },
    createBuyOrder(body) {
      return api().request('POST', '/api/p2p/buy-orders', body, { sensitive: true });
    },
    createSellOrder(body) {
      return api().request('POST', '/api/p2p/sell-orders', body, { sensitive: true });
    },
    releaseBuyOrder(id) {
      return api().request('POST', `/api/p2p/buy-orders/${id}/release`, null, { sensitive: true });
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
