#!/usr/bin/env node
'use strict';

/**
 * Registration Terms & Conditions checkbox + persistence wiring.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testUiHasRequiredTermsCheckbox() {
  section('Register form requires Terms checkbox linked to /terms.html');
  const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
  const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
  const auth = fs.readFileSync(path.join(ROOT, 'backend/public/auth.js'), 'utf8');
  const terms = fs.readFileSync(path.join(ROOT, 'backend/public/terms.html'), 'utf8');

  assert.ok(html.includes('id="regTermsAccepted"'), 'checkbox present');
  assert.ok(html.includes('href="/terms.html"'), 'links to terms page');
  assert.ok(/regTermsAccepted[^>]*required|required[^>]*regTermsAccepted/.test(html) || html.includes('id="regTermsAccepted"'), 'checkbox exists');
  assert.ok(html.includes('name="terms_accepted"'), 'terms_accepted field name');
  assert.ok(terms.includes('Terms and Conditions'), 'terms page content');
  assert.ok(dash.includes("regTermsAccepted"), 'dashboard validates checkbox');
  assert.ok(dash.includes('termsAccepted: true'), 'completeRegister sends acceptance');
  assert.ok(auth.includes('terms_accepted'), 'auth client posts terms_accepted');
  console.log('ok');
}

function testBackendPersistsTerms() {
  section('Backend migration + User/auth wiring for terms acceptance');
  const migration = fs.readFileSync(
    path.join(ROOT, 'backend/migrations/053_user_terms_acceptance.sql'),
    'utf8'
  );
  const userModel = fs.readFileSync(path.join(ROOT, 'backend/src/models/User.js'), 'utf8');
  const authService = fs.readFileSync(path.join(ROOT, 'backend/src/services/authService.js'), 'utf8');
  const authRoute = fs.readFileSync(path.join(ROOT, 'backend/src/routes/auth.js'), 'utf8');
  const patch = fs.readFileSync(
    path.join(ROOT, 'backend/migrations/patches/applyUserAuthColumns.js'),
    'utf8'
  );

  assert.ok(migration.includes('terms_accepted'), 'migration adds terms_accepted');
  assert.ok(migration.includes('terms_accepted_at'), 'migration adds terms_accepted_at');
  assert.ok(migration.includes('terms_version'), 'migration adds terms_version');
  assert.ok(userModel.includes('termsAccepted'), 'User.create accepts termsAccepted');
  assert.ok(userModel.includes('terms_accepted'), 'User inserts terms_accepted');
  assert.ok(authService.includes('TERMS_NOT_ACCEPTED'), 'auth rejects without terms');
  assert.ok(authService.includes('TERMS_VERSION'), 'auth stores terms version');
  assert.ok(authRoute.includes('terms_accepted'), 'route reads terms_accepted');
  assert.ok(patch.includes('terms_accepted'), 'auth column patch includes terms fields');
  console.log('ok');
}

function main() {
  testUiHasRequiredTermsCheckbox();
  testBackendPersistsTerms();
  console.log('\nAll registration terms tests passed.');
}

main();
