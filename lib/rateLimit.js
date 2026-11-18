/**
 * Shared sliding-window rate limit helper for Next.js / App Router handlers.
 * Re-exports the Express-side implementation so app/api routes can share
 * the same Upstash (or memory) backend.
 *
 * Usage:
 *   const { consumeSlidingWindow } = require('../lib/rateLimit');
 *   const result = await consumeSlidingWindow(ip, { name: 'sweep', limit: 10, windowMs: 60_000 });
 *   if (!result.success) return NextResponse.json({ error: 'Too many requests', code: 'RATE_LIMITED' }, { status: 429 });
 */

'use strict';

const path = require('path');

// Prefer the Express middleware module (CommonJS) — single source of truth.
module.exports = require(path.join(__dirname, '../backend/src/middleware/slidingWindowRateLimit'));
