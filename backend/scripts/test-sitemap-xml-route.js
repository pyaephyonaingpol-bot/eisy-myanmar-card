#!/usr/bin/env node
/**
 * Smoke-test GET /sitemap.xml: valid XML body + application/xml Content-Type.
 */
'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const { app } = require('../src/index.js');
const { getAllSlugs } = require('../../data/blogs.js');

function request(server, urlPath) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method: 'GET',
        headers: { Accept: 'application/xml,text/xml,*/*' },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    for (const urlPath of ['/sitemap.xml', '/api/sitemap']) {
      const res = await request(server, urlPath);
      assert.strictEqual(res.status, 200, `${urlPath}: expected 200, got ${res.status}`);

      const ct = String(res.headers['content-type'] || '');
      assert.ok(
        ct.includes('application/xml'),
        `${urlPath}: Content-Type must be application/xml, got: ${ct}`
      );
      assert.ok(!ct.includes('text/html'), `${urlPath}: must not be text/html: ${ct}`);
      assert.ok(!ct.includes('text/plain'), `${urlPath}: must not be text/plain: ${ct}`);
      const cache = String(res.headers['cache-control'] || '');
      assert.ok(
        /max-age=0/i.test(cache) || /no-cache/i.test(cache),
        `${urlPath}: Cache-Control must revalidate (max-age=0 or no-cache), got: ${cache}`
      );

      assert.ok(res.body.startsWith('<?xml'), `${urlPath}: XML declaration`);
      assert.ok(
        res.body.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'),
        `${urlPath}: has urlset xmlns`
      );
      assert.ok(res.body.includes('</urlset>'), `${urlPath}: closes </urlset>`);
      assert.ok(res.body.includes('<url>'), `${urlPath}: has <url>`);
      assert.ok(res.body.includes('<loc>'), `${urlPath}: has <loc>`);
      assert.ok(res.body.includes('<lastmod>'), `${urlPath}: has <lastmod>`);
      assert.ok(res.body.includes('<loc>https://eisymyanmar.com/blog</loc>'));

      for (const slug of getAllSlugs()) {
        assert.ok(
          res.body.includes(`<loc>https://eisymyanmar.com/blog/${slug}</loc>`),
          `${urlPath}: missing blog slug ${slug}`
        );
      }

      const tagCount = (res.body.match(/<\/?url>/g) || []).length;
      assert.ok(tagCount >= 2, `${urlPath}: expected <url> tags, found ${tagCount}`);
      console.log(`ok — ${urlPath} ${ct} cache=${cache} (${Buffer.byteLength(res.body, 'utf8')} bytes)`);
    }

    // Dedicated Vercel handler (api/sitemap.js) must also emit valid XML.
    const handler = require('../../api/sitemap.js');
    const fakeReq = { method: 'GET' };
    let statusCode = 0;
    const headers = {};
    let body = '';
    const fakeRes = {
      setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
      end(chunk) { body = String(chunk || ''); },
      set statusCode(v) { statusCode = v; },
      get statusCode() { return statusCode; },
    };
    handler(fakeReq, fakeRes);
    assert.strictEqual(statusCode, 200);
    assert.ok(String(headers['content-type']).includes('application/xml'));
    assert.ok(/max-age=0|no-cache/i.test(String(headers['cache-control'] || '')));
    assert.strictEqual(headers['x-sitemap-handler'], 'api/sitemap');
    assert.ok(body.startsWith('<?xml'));
    assert.ok(body.includes('xml-stylesheet'));
    assert.ok(body.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
    assert.ok(body.includes('<lastmod>'));
    console.log('ok — api/sitemap.js handler application/xml + max-age=0');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
