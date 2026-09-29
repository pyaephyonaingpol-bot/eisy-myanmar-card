/**
 * Generate dedicated Instant portal HTML shell from index.html.
 * Keeps a single source of truth while serving isolated /instant pages.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '../public');
const INDEX = path.join(PUBLIC, 'index.html');

function writePortal(portal, label) {
  if (!fs.existsSync(INDEX)) {
    throw new Error(`Missing ${INDEX}`);
  }
  let html = fs.readFileSync(INDEX, 'utf8');
  const inject = `  <script>window.__EISY_PORTAL__=${JSON.stringify(portal)};</script>\n`;
  if (!html.includes(`__EISY_PORTAL__=${JSON.stringify(portal)}`)) {
    html = html.replace(/<head([^>]*)>/i, (m) => `${m}\n${inject}`);
  }
  html = html.replace(/<html([^>]*)>/i, (m, attrs = '') => {
    if (/data-eisy-portal=/.test(attrs)) {
      return m.replace(/data-eisy-portal="[^"]*"/, `data-eisy-portal="${portal}"`);
    }
    return `<html${attrs} data-eisy-portal="${portal}">`;
  });
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>Eisy Myanmar — ${label}</title>`);
  const out = path.join(PUBLIC, `${portal}.html`);
  fs.writeFileSync(out, html);
  console.log(`[write-portal-html] wrote ${out}`);
}

writePortal('instant', 'Instant');
