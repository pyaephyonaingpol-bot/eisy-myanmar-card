/**
 * Client-side KYC image pre-filter.
 *
 * Clarity uses the variance of a Laplacian (the same focus measure as
 * OpenCV's cv2.Laplacian). It runs in the browser before a KYC submission
 * can reach the managed Fyatu/Kolo webhook.
 *
 * A score below BLUR_VARIANCE_THRESHOLD means the NRC/Passport photo is too
 * soft to send. Session attempt tracking is stored in sessionStorage.
 */
(function (root, factory) {
  'use strict';

  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.EisyKycPrefilter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BLUR_ALERT = 'Photo is too blurry, please take a clearer picture.';
  const BLUR_VARIANCE_THRESHOLD = 100;
  const MAX_ATTEMPTS = 2;
  const SESSION_PREFIX = 'eisy.kyc.submitAttempts';
  const SAMPLE_LONG_EDGE = 480;

  function sessionKey(userId) {
    const id = String(userId || 'session').trim() || 'session';
    return SESSION_PREFIX + '.' + id;
  }

  function storageOf(storage) {
    if (storage) return storage;
    try {
      return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    } catch (_) {
      return null;
    }
  }

  function readAttempts(userId, storage) {
    const store = storageOf(storage);
    if (!store) return 0;
    const n = parseInt(store.getItem(sessionKey(userId)) || '0', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function recordFailedAttempt(userId, storage) {
    const store = storageOf(storage);
    const next = readAttempts(userId, store) + 1;
    if (store) store.setItem(sessionKey(userId), String(next));
    return next;
  }

  function isLocked(userId, storage) {
    return readAttempts(userId, storage) >= MAX_ATTEMPTS;
  }

  /**
   * Variance of the 4-neighbour Laplacian over an RGBA buffer.
   * Returns 0 when the image is too small to measure.
   */
  function laplacianVarianceFromRgba(rgba, width, height) {
    const w = width | 0;
    const h = height | 0;
    if (!rgba || w < 3 || h < 3) return 0;

    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = (0.299 * rgba[p]) + (0.587 * rgba[p + 1]) + (0.114 * rgba[p + 2]);
    }

    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const i = row + x;
        const lap = gray[i - w] + gray[i - 1] + gray[i + 1] + gray[i + w] - (4 * gray[i]);
        sum += lap;
        sumSq += lap * lap;
        count++;
      }
    }
    if (!count) return 0;
    const mean = sum / count;
    const variance = (sumSq / count) - (mean * mean);
    return variance > 0 ? variance : 0;
  }

  function isBlurryScore(score) {
    return !(Number(score) >= BLUR_VARIANCE_THRESHOLD);
  }

  function sampleSize(width, height) {
    const longEdge = Math.max(width, height);
    const scale = longEdge > SAMPLE_LONG_EDGE ? SAMPLE_LONG_EDGE / longEdge : 1;
    return {
      width: Math.max(3, Math.round(width * scale)),
      height: Math.max(3, Math.round(height * scale)),
    };
  }

  function assessImageData(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const score = laplacianVarianceFromRgba(imageData.data, width, height);
    return {
      score: score,
      width: width,
      height: height,
      blurry: isBlurryScore(score),
      alert: BLUR_ALERT,
    };
  }

  async function measureFile(file) {
    if (!file) {
      return { score: 0, blurry: true, alert: BLUR_ALERT, unreadable: true };
    }
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
      const err = new Error('Image clarity check is unavailable in this browser');
      err.code = 'KYC_CLARITY_UNAVAILABLE';
      throw err;
    }

    const bitmap = await createImageBitmap(file);
    try {
      const size = sampleSize(bitmap.width, bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);
      const imageData = ctx.getImageData(0, 0, size.width, size.height);
      return assessImageData(imageData);
    } finally {
      if (typeof bitmap.close === 'function') bitmap.close();
    }
  }

  return {
    BLUR_ALERT: BLUR_ALERT,
    BLUR_VARIANCE_THRESHOLD: BLUR_VARIANCE_THRESHOLD,
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    laplacianVarianceFromRgba: laplacianVarianceFromRgba,
    isBlurryScore: isBlurryScore,
    assessImageData: assessImageData,
    measureFile: measureFile,
    readAttempts: readAttempts,
    recordFailedAttempt: recordFailedAttempt,
    isLocked: isLocked,
    sessionKey: sessionKey,
  };
});
