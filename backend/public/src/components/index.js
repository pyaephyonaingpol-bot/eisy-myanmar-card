/**
 * Components barrel.
 */
(function (root) {
  'use strict';

  root.EisyComponents = root.EisyComponents || {};
  root.EisyComponents.ready = true;
  root.EisyComponents.version = 'card-views-split';

  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[EisyComponents] ready', Object.keys(root.EisyComponents));
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
