/**
 * Vercel entry when the Git project root is the monorepo (not backend/).
 * vercel.json rewrites all routes → /api → this file → Express app.
 */
module.exports = require('../backend/api/index.js');
