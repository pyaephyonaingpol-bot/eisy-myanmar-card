/**
 * Shared error monitor for Next.js App Router / Vercel handlers.
 * Re-exports the Express service so app/api routes use one pipeline.
 *
 *   const { captureError, initErrorMonitor } = require('../lib/errorMonitor');
 *   initErrorMonitor();
 *   try { ... } catch (err) { captureError(err, { source: 'app/api', path: '/api/...' }); throw err; }
 */

'use strict';

const path = require('path');

module.exports = require(path.join(__dirname, '../backend/src/services/errorMonitor'));
