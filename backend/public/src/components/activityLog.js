/**
 * Activity log list helper.
 * window.EisyComponents.activityLog
 */
(function (root) {
  'use strict';

  root.EisyComponents = root.EisyComponents || {};

  function log(msg, type) {
    const logEl = typeof document !== 'undefined' ? document.getElementById('activityLog') : null;
    if (!logEl) {
      console.log(`[Activity] ${msg}`);
      return;
    }
    const el = document.createElement('div');
    el.className = 'log-entry';
    el.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString()}</span><span class="${type === 'error' ? 'log-err' : 'log-ok'}">${msg}</span>`;
    logEl.prepend(el);
  }

  root.EisyComponents.activityLog = { log };
})(typeof globalThis !== 'undefined' ? globalThis : window);
