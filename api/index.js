/**
 * Vercel entry when the project root is the monorepo (not backend/).
 * Delegates to the Express serverless handler in backend/api.
 */
module.exports = require('../backend/api/index.js');
