/**
 * Generate dedicated Instant admin HTML shell from admin.html.
 * Serves isolated /admin/instant management pipeline.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '../public');
const ADMIN = path.join(PUBLIC, 'admin.html');

function writeAdminPipeline(pipeline) {
  if (!fs.existsSync(ADMIN)) {
    throw new Error(`Missing ${ADMIN}`);
  }
  let html = fs.readFileSync(ADMIN, 'utf8');
  const inject = `  <script>window.__EISY_ADMIN_PIPELINE__=${JSON.stringify(pipeline)};</script>\n`;
  if (!html.includes(`__EISY_ADMIN_PIPELINE__=${JSON.stringify(pipeline)}`)) {
    html = html.replace(/window\.__EISY_ADMIN_PIPELINE__\s*=\s*["'][^"']*["'];?/, '');
    html = html.replace(/<head([^>]*)>/i, (m) => `${m}\n${inject}`);
  }
  html = html.replace(/<html([^>]*)>/i, (m, attrs = '') => {
    if (/data-admin-pipeline=/.test(attrs)) {
      return m.replace(/data-admin-pipeline="[^"]*"/, `data-admin-pipeline="${pipeline}"`);
    }
    return `<html${attrs} data-admin-pipeline="${pipeline}">`;
  });
  html = html.replace(/<title>[^<]*<\/title>/i, '<title>Eisymyanmar</title>');
  // Cache-bust admin.js so pipeline isolation ships with HTML shells.
  html = html.replace(/admin\.js\?v=[^"']+/g, 'admin.js?v=20261008netRevenue2');
  const out = path.join(PUBLIC, `admin-${pipeline}.html`);
  fs.writeFileSync(out, html);
  console.log(`[write-admin-portal-html] wrote ${out}`);
}

writeAdminPipeline('instant');
