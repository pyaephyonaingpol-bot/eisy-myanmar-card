#!/usr/bin/env node
/**
 * Minimal DOM simulation: AppNav.navigate('p2p') must activate pageP2p, not pageCards.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const navSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'nav.js'), 'utf8');

function classListSet(initial = []) {
  const set = new Set(initial);
  return {
    toggle(name, on) {
      if (on) set.add(name);
      else set.delete(name);
    },
    has(name) {
      return set.has(name);
    },
    add(name) {
      set.add(name);
    },
    delete(name) {
      set.delete(name);
    },
  };
}

function makeShell() {
  const pages = [
    { dataset: { page: 'home' }, classList: classListSet(['is-active']) },
    { dataset: { page: 'cards' }, classList: classListSet() },
    { dataset: { page: 'p2p' }, classList: classListSet() },
  ];
  const navItems = [
    { dataset: { page: 'home' }, classList: classListSet(['active']), setAttribute() {} },
    { dataset: { page: 'cards' }, classList: classListSet(), setAttribute() {} },
    { dataset: { page: 'p2p' }, classList: classListSet(), setAttribute() {} },
  ];

  const mkList = (items) => ({
    forEach(fn) {
      items.forEach((el) => fn(el));
    },
  });

  return {
    querySelectorAll(sel) {
      if (sel === '.app-page[data-page]') return mkList(pages);
      if (sel === '.sidebar-nav [data-page]') return mkList(navItems);
      return mkList([]);
    },
    querySelector(sel) {
      if (sel === '[data-page-title="p2p"]') {
        return { textContent: 'P2P Express', getAttribute: () => 'nav_p2p' };
      }
      if (sel === '.header .page-heading') {
        return { textContent: 'Dashboard', setAttribute() {}, removeAttribute() {} };
      }
      return null;
    },
    classList: { contains: () => false },
    _pages: pages,
    _nav: navItems,
  };
}

const location = { hash: '' };
const context = {
  window: {
    get location() {
      return location;
    },
    addEventListener() {},
    innerWidth: 1200,
  },
  document: { addEventListener() {} },
  history: { replaceState() {} },
  console,
};
context.window.AppNav = null;
vm.createContext(context);
vm.runInContext(`${navSrc}\nwindow.AppNav = AppNav;`, context);

const AppNav = context.window.AppNav;
const shell = makeShell();
let onChangePage = null;

AppNav.root = shell;
AppNav.navSelector = '.sidebar-nav [data-page]';
AppNav.pageSelector = '.app-page[data-page]';
AppNav.defaultPage = 'home';
AppNav.hashPrefix = '';
AppNav.onChange = (page) => { onChangePage = page; };
AppNav.currentPage = 'cards';
shell._pages.find((p) => p.dataset.page === 'cards').classList.add('is-active');
shell._pages.find((p) => p.dataset.page === 'home').classList.delete('is-active');

AppNav.navigate('p2p', { pushHash: true });

assert.strictEqual(AppNav.currentPage, 'p2p', 'currentPage must be p2p');
assert.strictEqual(onChangePage, 'p2p', 'onChange must receive p2p');
assert.ok(shell._pages.find((p) => p.dataset.page === 'p2p').classList.has('is-active'), 'pageP2p panel active');
assert.ok(!shell._pages.find((p) => p.dataset.page === 'cards').classList.has('is-active'), 'cards panel inactive');
assert.strictEqual(context.window.location.hash, '#p2p', 'URL hash must be #p2p');

console.log('[test-p2p-nav-dom-smoke] ok');
