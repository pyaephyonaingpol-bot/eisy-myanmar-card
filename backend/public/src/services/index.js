/**
 * Services barrel — marks EisyServices ready after individual modules load.
 */
(function (root) {
  'use strict';

  root.EisyServices = root.EisyServices || {};
  root.EisyServices.ready = true;
  root.EisyServices.version = 'step3';

  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[EisyServices] ready', Object.keys(root.EisyServices));
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
