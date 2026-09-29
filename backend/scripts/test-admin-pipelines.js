/**
 * Instant admin pipeline (Kripicard). Legacy Business admin redirects to Instant.
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
  section('Express serves /admin/instant; legacy Business admin redirects');
  const indexJs = fs.readFileSync(path.join(ROOT, 'backend/src/index.js'), 'utf8');
  assert.ok(indexJs.includes('sendAdminPipeline') || indexJs.includes('__EISY_ADMIN_PIPELINE__'));
  assert.ok(indexJs.includes("'/admin/instant'") || indexJs.includes('"/admin/instant"'));
  assert.ok(/redirect\(\s*302\s*,\s*['"]\/admin\/instant['"]\s*\)/.test(indexJs));
  assert.ok(!/sendAdminPipeline\(\s*res,\s*['"]standard['"]\s*\)/.test(indexJs));
  assert.ok(!/Bitnob/i.test(indexJs));
  console.log('ok');
}

function testAdminHtmlMarked() {
  section('admin.html Instant pipeline chrome');
  const html = fs.readFileSync(path.join(ROOT, 'backend/public/admin.html'), 'utf8');
  assert.ok(html.includes('data-admin-pipeline="instant"') || html.includes('admin-instant') || html.includes('adminPipeline'));
  assert.ok(!/Bitnob/i.test(html));
  assert.ok(!/adminStandardCardNote/i.test(html));
  console.log('ok');
}

function testAdminJsInstantOnly() {
  section('admin.js Instant-only pipeline');
  const js = fs.readFileSync(path.join(ROOT, 'backend/public/admin.js'), 'utf8');
  assert.ok(!/STANDARD_ADMIN_PAGES/.test(js));
  assert.ok(js.includes('INSTANT_ADMIN_PAGES') || js.includes('/admin/instant'));
  assert.ok(!/bitnob/i.test(js));
  console.log('ok');
}

function testAdminShellGenerator() {
  section('admin portal generator is Instant-only');
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
  testAdminHtmlMarked();
  testAdminJsInstantOnly();
  testAdminShellGenerator();
  console.log('\nAdmin pipeline checks passed.');
}

main();
