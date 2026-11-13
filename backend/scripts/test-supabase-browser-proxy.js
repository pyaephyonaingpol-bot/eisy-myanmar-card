#!/usr/bin/env node
'use strict';

/**
 * Same-origin Supabase proxy for Google OAuth (no Pro custom domain).
 * Run: node backend/scripts/test-supabase-browser-proxy.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

const SUPABASE_ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'PUBLIC_BASE_URL',
  'SUPABASE_BROWSER_PROXY',
  'SUPABASE_BROWSER_PROXY_PATH',
  'VERCEL_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
];

function snapshotEnv(keys) {
  const out = {};
  for (const key of keys) out[key] = process.env[key];
  return out;
}

function restoreEnv(snap) {
  for (const [key, value] of Object.entries(snap)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearEnv() {
  for (const key of SUPABASE_ENV_KEYS) delete process.env[key];
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function withServer(handler, run) {
  const app = express();
  app.use(handler);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const snap = snapshotEnv(SUPABASE_ENV_KEYS);
  const {
    getPublicSupabaseConfig,
    getBrowserSupabaseUrl,
    rewriteSupabaseProxyLocation,
    supabaseBrowserProxyPath,
    resetSupabaseClientForTests,
  } = require('../src/lib/supabase');

  try {
    section('helpers: path + Location rewrite');
    clearEnv();
    resetSupabaseClientForTests();
    assert.strictEqual(supabaseBrowserProxyPath(), '/supabase');
    process.env.SUPABASE_BROWSER_PROXY_PATH = 'auth-proxy/';
    assert.strictEqual(supabaseBrowserProxyPath(), '/auth-proxy');

    const rewritten = rewriteSupabaseProxyLocation(
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fabc.supabase.co%2Fauth%2Fv1%2Fcallback&state=1',
      {
        upstreamOrigin: 'https://abc.supabase.co',
        publicOrigin: 'https://eisymyanmar.com',
        proxyPath: '/supabase',
      }
    );
    assert.ok(rewritten.includes('accounts.google.com'), 'keeps Google host');
    assert.ok(
      rewritten.includes('redirect_uri=https%3A%2F%2Fabc.supabase.co%2Fauth%2Fv1%2Fcallback')
        || rewritten.includes('redirect_uri=https://abc.supabase.co/auth/v1/callback'),
      'keeps Google redirect_uri on *.supabase.co (required for code exchange)'
    );
    assert.ok(!rewritten.includes('eisymyanmar.com/supabase/auth/v1/callback'), 'must not rewrite Google redirect_uri');

    const loc = rewriteSupabaseProxyLocation(
      'https://abc.supabase.co/auth/v1/callback?code=xyz',
      {
        upstreamOrigin: 'https://abc.supabase.co',
        publicOrigin: 'https://eisymyanmar.com',
        proxyPath: '/supabase',
      }
    );
    assert.strictEqual(loc, 'https://abc.supabase.co/auth/v1/callback?code=xyz', 'auth callback stays on supabase.co');

    const other = rewriteSupabaseProxyLocation(
      'https://abc.supabase.co/rest/v1/user_wallets',
      {
        upstreamOrigin: 'https://abc.supabase.co',
        publicOrigin: 'https://eisymyanmar.com',
        proxyPath: '/supabase',
      }
    );
    assert.strictEqual(other, 'https://eisymyanmar.com/supabase/rest/v1/user_wallets');
    console.log('ok');

    section('public config uses PUBLIC_BASE_URL/supabase');
    clearEnv();
    resetSupabaseClientForTests();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_test_anon_key_value_123456';
    process.env.PUBLIC_BASE_URL = 'https://eisymyanmar.com';
    const pub = getPublicSupabaseConfig();
    assert.strictEqual(pub.enabled, true);
    assert.strictEqual(pub.url, 'https://eisymyanmar.com/supabase');
    assert.strictEqual(pub.proxied, true);
    assert.strictEqual(
      getBrowserSupabaseUrl('https://example.supabase.co'),
      'https://eisymyanmar.com/supabase'
    );

    process.env.SUPABASE_BROWSER_PROXY = 'false';
    const direct = getPublicSupabaseConfig();
    assert.strictEqual(direct.url, 'https://example.supabase.co');
    assert.strictEqual(direct.proxied, false);
    console.log('ok');

    section('proxy forwards auth path to upstream');
    clearEnv();
    resetSupabaseClientForTests();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_test_anon_key_value_123456';
    process.env.PUBLIC_BASE_URL = 'https://eisymyanmar.com';

    let seenUrl = '';
    let seenHost = '';
    const upstream = http.createServer((req, res) => {
      seenUrl = req.url;
      seenHost = req.headers.host;
      res.writeHead(302, {
        Location: 'https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fexample.supabase.co%2Fauth%2Fv1%2Fcallback',
      });
      res.end();
    });
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = upstream.address().port;
    process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${upstreamPort}`;

    const proxyRouter = require('../src/routes/supabaseProxy');
    await withServer(proxyRouter, async (port) => {
      const resp = await fetch(
        `http://127.0.0.1:${port}/supabase/auth/v1/authorize?provider=google`,
        { redirect: 'manual' }
      );
      assert.strictEqual(resp.status, 302);
      assert.strictEqual(seenUrl, '/auth/v1/authorize?provider=google');
      assert.strictEqual(seenHost, `127.0.0.1:${upstreamPort}`);
      const location = resp.headers.get('location') || '';
      assert.ok(location.includes('accounts.google.com'), 'forwards Google Location host');
      assert.ok(
        location.includes('example.supabase.co%2Fauth%2Fv1%2Fcallback')
          || location.includes('example.supabase.co/auth/v1/callback')
          || location.includes('127.0.0.1'),
        'preserves upstream Google redirect_uri (no proxy rewrite)'
      );
      assert.ok(!location.includes('eisymyanmar.com/supabase/auth/v1/callback'), 'does not rewrite Google redirect_uri');
      assert.ok(!seenHost.includes('eisymyanmar'), 'does not send site host as upstream Host');
    });
    await new Promise((resolve) => upstream.close(resolve));
    console.log('ok');

    section('wiring: vercel.json + Express mount');
    const rootVercel = fs.readFileSync(path.join(ROOT, '../vercel.json'), 'utf8');
    const backendVercel = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
    assert.ok(rootVercel.includes('"/supabase/(.*)"'), 'root vercel supabase rewrite');
    assert.ok(backendVercel.includes('"/supabase/(.*)"'), 'backend vercel supabase rewrite');
    const indexSrc = fs.readFileSync(path.join(ROOT, 'src/index.js'), 'utf8');
    assert.ok(indexSrc.includes("app.use('/supabase'"), 'Express mounts /supabase proxy');
    assert.ok(indexSrc.includes('supabaseProxy'), 'uses supabaseProxy router');
    const configSrc = fs.readFileSync(path.join(ROOT, 'src/routes/config.js'), 'utf8');
    assert.ok(configSrc.includes('getPublicSupabaseConfig(req)'), 'config passes req for Host origin');
    console.log('ok');
  } finally {
    restoreEnv(snap);
    resetSupabaseClientForTests();
  }

  console.log('\nSupabase browser proxy tests — ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
