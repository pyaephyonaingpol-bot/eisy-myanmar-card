#!/usr/bin/env node
'use strict';

/**
 * KYC image pre-filter: Laplacian clarity + 2-attempt session limit.
 * Run: node backend/scripts/test-kyc-image-prefilter.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const prefilter = require('../public/src/lib/kycImagePrefilter');

function rgba(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = paint(x, y);
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return data;
}

function boxBlur(src, width, height, radius) {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx));
          const yy = Math.min(height - 1, Math.max(0, y + dy));
          sum += src[(yy * width + xx) * 4];
          n++;
        }
      }
      const v = Math.round(sum / n);
      const i = (y * width + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
  };
}

const width = 80;
const height = 60;
const sharp = rgba(width, height, (x, y) => ((x + y) % 2 === 0 ? 250 : 10));
const soft = boxBlur(sharp, width, height, 4);
const flat = rgba(width, height, () => 128);

const sharpScore = prefilter.laplacianVarianceFromRgba(sharp, width, height);
const softScore = prefilter.laplacianVarianceFromRgba(soft, width, height);
const flatScore = prefilter.laplacianVarianceFromRgba(flat, width, height);

assert.ok(sharpScore >= prefilter.BLUR_VARIANCE_THRESHOLD, 'sharp NRC-like detail passes, score=' + sharpScore);
assert.ok(softScore < prefilter.BLUR_VARIANCE_THRESHOLD, 'blurred photo is below threshold, score=' + softScore);
assert.ok(flatScore < prefilter.BLUR_VARIANCE_THRESHOLD, 'blank photo is below threshold, score=' + flatScore);
assert.strictEqual(prefilter.isBlurryScore(softScore), true);
assert.strictEqual(prefilter.isBlurryScore(sharpScore), false);
assert.strictEqual(prefilter.BLUR_ALERT, 'Photo is too blurry, please take a clearer picture.');
assert.strictEqual(prefilter.MAX_ATTEMPTS, 2);
assert.strictEqual(prefilter.laplacianVarianceFromRgba(new Uint8ClampedArray(8), 2, 2), 0);

const store = memoryStorage();
assert.strictEqual(prefilter.isLocked('user-1', store), false);
assert.strictEqual(prefilter.recordFailedAttempt('user-1', store), 1);
assert.strictEqual(prefilter.isLocked('user-1', store), false);
assert.strictEqual(prefilter.recordFailedAttempt('user-1', store), 2);
assert.strictEqual(prefilter.isLocked('user-1', store), true);
assert.strictEqual(prefilter.readAttempts('user-2', store), 0, 'attempts are per user session key');

const root = path.join(__dirname, '..');
const dash = fs.readFileSync(path.join(root, 'public/dashboard.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const instantHtml = fs.readFileSync(path.join(root, 'public/instant.html'), 'utf8');
const support = fs.readFileSync(path.join(root, 'public/supportChat.js'), 'utf8');

const measureAt = dash.indexOf('measureFile');
const submitAt = dash.indexOf("apiForm('/api/kyc/submit'");
assert.ok(measureAt > 0 && submitAt > measureAt, 'clarity check runs before the KYC submission request');
assert.ok(dash.includes('KYC_PHOTO_BLURRY'), 'blurry photos are rejected in the KYC form');
assert.ok(dash.includes('recordFailedAttempt'), 'failed KYC attempts are counted');
assert.ok(dash.includes('kycManualSupportBtn') || dash.includes('openTicket'), 'locked users are routed to support');
assert.ok(support.includes('openTicket'), 'support module can open a manual ticket');

for (const [name, html] of [['index', indexHtml], ['instant', instantHtml]]) {
  assert.ok(html.includes('kycImagePrefilter.js'), name + ' loads the pre-filter');
  assert.ok(html.includes('id="kycManualSupportBtn"'), name + ' has the manual support button');
  assert.ok(!html.includes('Dev OTP'), name + ' still has no dev OTP banner');
}

console.log('KYC image pre-filter checks passed.');
console.log('  sharp', sharpScore.toFixed(1), 'soft', softScore.toFixed(1), 'flat', flatScore.toFixed(1));
