#!/usr/bin/env node
/**
 * PM2 / production entrypoint for Eisy Myanmar backend.
 * Delegates to src/index.js (Express app + DB init + listen).
 *
 * Usage:
 *   node server.js
 *   pm2 start server.js --name eisy-backend
 */
require('./src/index.js');
