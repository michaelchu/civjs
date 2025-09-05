#!/usr/bin/env node

// Production runtime path resolver for TypeScript path aliases
const moduleAlias = require('module-alias');
const path = require('path');

// Register path aliases for the compiled JavaScript
moduleAlias.addAliases({
  '@game': path.join(__dirname, 'dist/game'),
  '@network': path.join(__dirname, 'dist/network'),
  '@database': path.join(__dirname, 'dist/database'),
  '@app-types': path.join(__dirname, 'dist/types'),
  '@utils': path.join(__dirname, 'dist/utils'),
  '@shared': path.join(__dirname, 'dist/shared'),
  '@config': path.join(__dirname, 'dist/config'),
});

// Start the server
require('./dist/index.js');