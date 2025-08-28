// Serverless function entry point for Vercel
const { app } = require('../dist/serverless.js');

// Export the Express app for Vercel
module.exports = app;