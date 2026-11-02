/**
 * Unified admin portal (Instant/Hub split removed).
 * Legacy /admin/instant and /admin/business redirect to /admin.
 * Run: npm run test:admin-pipelines
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testServerRoutes() {
  section('Express redirects legacy Instant/Business admin URLs to /admin');
  const indexJs = fs.readFileSync(path.join(ROOT, 'backend/src/index.js'), 'utf8');
  assert.ok(indexJs.includes("'/admin/instant'") || indexJs.includes('"/admin/instant"'));
  assert.ok(/redirect\(\s*302\s*,\s*['"]\/admin['"]\s*\)/.test(indexJs));
  assert.ok(!/sendAdminPipeline\(\s*res,\s*['"]standard['"]\s*\)/.test(indexJs));
  assert.ok(!/Bitnob/i.test(indexJs));
  console.log('ok');
}

function testAdminHtmlCoreNav() {
  section('admin.html shows core modules only');
  const html = fs.readFileSync(path.join(ROOT, 'backend/public/admin.html'), 'utf8');
  assert.ok(html.includes('Deposits &amp; KYC'), 'deposits+kyc nav');
  assert.ok(html.includes('Virtual Cards'), 'virtual cards nav');
  assert.ok(html.includes('id="tabCards"'), 'cards panel');
  assert.ok(html.includes('data-page="users"'), 'users nav');
  assert.ok(html.includes('data-page="settings"'), 'settings nav');
  assert.ok(!/Open Instant Admin/i.test(html));
  assert.ok(!/Bitnob/i.test(html));
  console.log('ok');
}

function testAdminJsUnified() {
  section('admin.js unified portal (no Instant/Hub chooser)');
  const js = fs.readFileSync(path.join(ROOT, 'backend/public/admin.js'), 'utf8');
  assert.ok(!/STANDARD_ADMIN_PAGES/.test(js));
  assert.ok(js.includes('CORE_ADMIN_PAGES'));
  assert.ok(js.includes("return 'instant'"));
  assert.ok(!/Open Instant Admin/.test(js));
  assert.ok(!/bitnob/i.test(js));
  console.log('ok');
}

function testAdminShellGenerator() {
  section('admin portal generator remains Instant-compatible');
  const writer = fs.readFileSync(path.join(ROOT, 'backend/scripts/write-admin-portal-html.js'), 'utf8');
  assert.ok(!writer.includes("writePipeline('standard'") && !writer.includes('admin-standard'));
  require(path.join(ROOT, 'backend/scripts/write-admin-portal-html.js'));
  assert.ok(fs.existsSync(path.join(ROOT, 'backend/public/admin-instant.html')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'backend/public/admin-standard.html')));
  const instant = fs.readFileSync(path.join(ROOT, 'backend/public/admin-instant.html'), 'utf8');
  assert.ok(!/bitnob/i.test(instant));
  console.log('ok');
}

function main() {
  testServerRoutes();
  testAdminHtmlCoreNav();
  testAdminJsUnified();
  testAdminShellGenerator();
  console.log('\nAdmin pipeline checks passed.');
}

main();
