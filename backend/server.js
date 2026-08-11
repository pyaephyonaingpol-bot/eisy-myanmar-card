#!/usr/bin/env node
/**
 * PM2 / local production entrypoint for Eisy Myanmar backend.
 * On Vercel, traffic goes through api/index.js instead.
 *
 * Usage:
 *   node server.js
 *   pm2 start server.js --name eisy-backend
 */
const { start } = require('./src/index.js');

start().catch((err) => {
  console.error('Failed to start server:', err.message || err);
  process.exit(1);
});
