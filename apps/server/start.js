#!/usr/bin/env node

// Production runtime path resolver for TypeScript path aliases
const moduleAlias = require('module-alias');
const path = require('path');

// Register path aliases for the compiled JavaScript
// When running from dist/, paths are relative to current directory
moduleAlias.addAliases({
  '@game': path.join(__dirname, 'game'),
  '@network': path.join(__dirname, 'network'),
  '@database': path.join(__dirname, 'database'),
  '@app-types': path.join(__dirname, 'types'),
  '@utils': path.join(__dirname, 'utils'),
  '@shared': path.join(__dirname, 'shared'),
  '@config': path.join(__dirname, 'config'),
});

// Start the server
require('./index.js');