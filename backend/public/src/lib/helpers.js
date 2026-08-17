/**
 * Shared helpers for reading Eisy lib namespaces safely.
 * Classic-script consumers: window.EisyLib.getConfig()
 */
(function (root) {
  'use strict';

  root.Eisy = root.Eisy || {};

  root.EisyLib = {
    getConfig() {
      return (root.Eisy && root.Eisy.config) || {};
    },
    getStorageKeys() {
      return (root.Eisy && root.Eisy.storageKeys) || {};
    },
    getConstants() {
      return (root.Eisy && root.Eisy.constants) || {};
    },
    storageKey(name, fallback) {
      const keys = this.getStorageKeys();
      return keys[name] || fallback;
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
