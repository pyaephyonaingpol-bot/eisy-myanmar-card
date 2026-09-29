/**
 * Instant / Business admin pipeline routes and DOM segregation.
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
  section('Express serves /admin/instant and /admin/business');
  const indexJs = fs.readFileSync(path.join(ROOT, 'backend/src/index.js'), 'utf8');
  assert.ok(indexJs.includes('sendAdminPipeline'));
  assert.ok(indexJs.includes("'/admin/instant'") || indexJs.includes('"/admin/instant"'));
  assert.ok(indexJs.includes("'/admin/business'") || indexJs.includes('"/admin/business"'));
  assert.ok(indexJs.includes("'/admin/standard'") || indexJs.includes('"/admin/standard"'));
  assert.ok(indexJs.includes('__EISY_ADMIN_PIPELINE__'));
  assert.ok(indexJs.includes('admin-instant.html') || indexJs.includes("pipeline === 'instant'"));
  assert.ok(indexJs.includes('Business Admin'));
  console.log('ok');
}

function testAdminHtmlMarked() {
  section('admin.html marks Instant vs Business pipeline chrome');
  const html = fs.readFileSync(path.join(ROOT, 'backend/public/admin.html'), 'utf8');
  assert.ok(html.includes('data-admin-pipeline="instant"'));
  assert.ok(html.includes('data-admin-pipeline="standard"'));
  assert.ok(html.includes('data-admin-pipeline="shared"'));
  assert.ok(html.includes('id="adminPipelineHub"'));
  assert.ok(html.includes('id="adminPipelineSwitcher"'));
  assert.ok(/data-page="deposits"[^>]*data-admin-pipeline="instant"|data-admin-pipeline="instant"[^>]*data-page="deposits"/.test(html));
  assert.ok(/data-page="mmk-withdrawals"[^>]*data-admin-pipeline="instant"/.test(html));
  assert.ok(/data-page="kyc-requests"[^>]*data-admin-pipeline="standard"/.test(html));
  assert.ok(/data-page="transactions"[^>]*data-admin-pipeline="instant"/.test(html));
  assert.ok(html.includes('adminInstantCardIssueBlock'));
  assert.ok(html.includes('adminStandardCardNote'));
  console.log('ok');
}

function testAdminJsIsolation() {
  section('admin.js isolates pipelines and switches routes');
  const js = fs.readFileSync(path.join(ROOT, 'backend/public/admin.js'), 'utf8');
  assert.ok(js.includes('getPipeline'));
  assert.ok(js.includes('applyPipelineIsolation'));
  assert.ok(js.includes('filterPagesForPipeline'));
  assert.ok(js.includes('INSTANT_ADMIN_PAGES'));
  assert.ok(js.includes('STANDARD_ADMIN_PAGES'));
  assert.ok(js.includes('/admin/instant'));
  assert.ok(js.includes('/admin/business'));
  assert.ok(js.includes('pipelineHref'));
  assert.ok(js.includes('renderPipelineHubChooser'));
  assert.ok(js.includes('renderPipelineSwitcher'));
  assert.ok(js.includes('[data-admin-pipeline="standard"]'));
  assert.ok(js.includes('[data-admin-pipeline="instant"]'));
  assert.ok(js.includes('kyc-requests'));
  assert.ok(js.includes('mmk-withdrawals'));
  assert.ok(js.includes('Business Admin'));
  console.log('ok');
}

function testGeneratorAndShells() {
  section('admin portal HTML generator writes isolated shells');
  const writer = fs.readFileSync(path.join(ROOT, 'backend/scripts/write-admin-portal-html.js'), 'utf8');
  assert.ok(writer.includes("writeAdminPipeline('instant'"));
  assert.ok(writer.includes("writeAdminPipeline('standard'"));
  assert.ok(writer.includes('Business Admin'));
  require(path.join(ROOT, 'backend/scripts/write-admin-portal-html.js'));
  const instant = fs.readFileSync(path.join(ROOT, 'backend/public/admin-instant.html'), 'utf8');
  const standard = fs.readFileSync(path.join(ROOT, 'backend/public/admin-standard.html'), 'utf8');
  assert.ok(instant.includes('__EISY_ADMIN_PIPELINE__="instant"') || instant.includes("__EISY_ADMIN_PIPELINE__='instant'"));
  assert.ok(standard.includes('__EISY_ADMIN_PIPELINE__="standard"') || standard.includes("__EISY_ADMIN_PIPELINE__='standard'"));
  assert.ok(instant.includes('data-admin-pipeline="instant"'));
  assert.ok(standard.includes('data-admin-pipeline="standard"'));
  assert.ok(instant.includes('admin.js?v=20260929kripicardBalance') || instant.includes('admin.js?v=20260928adminPipelines'));
  assert.ok(standard.includes('Eisy Myanmar — Business Admin'));
  console.log('ok');
}

function testBuildWiresAdminShells() {
  section('vercel-build / write-portal-html include admin shells');
  const pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  assert.ok(pkg.includes('write-admin-portal-html.js'));
  assert.ok(pkg.includes('test:admin-pipelines'));
  console.log('ok');
}

function main() {
  testServerRoutes();
  testAdminHtmlMarked();
  testAdminJsIsolation();
  testGeneratorAndShells();
  testBuildWiresAdminShells();
  console.log('\nAdmin pipeline checks passed.');
}

main();
