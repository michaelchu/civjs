import express from 'express';
import cors from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';

import config from './config';
import logger from './utils/logger';
import { testConnection, closeConnection } from './database';
import redis from './database/redis';

// Import HTTP routes
import gamesRouter from './routes/games';
import actionsRouter from './routes/actions';
import dataRouter from './routes/data';
import { loginUser, logoutUser } from './middleware/auth';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();

// Middleware
app.use(
  cors({
    origin: config.server.corsOrigin,
    credentials: true,
  })
);
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets
app.use('/tilesets', express.static('public/tilesets'));
app.use('/js', express.static('public/js'));
app.use('/sprites', express.static('public/sprites'));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Authentication endpoints
app.post('/api/auth/login', loginUser);
app.post('/api/auth/logout', logoutUser);

// API info endpoint
app.get('/api/info', (_req, res) => {
  res.json({
    name: 'CivJS Server',
    version: '1.0.0',
    environment: config.server.env,
    timestamp: new Date().toISOString(),
    mode: 'HTTP',
    features: ['multiplayer_http'],
  });
});

// Game API routes
app.use('/api/games', gamesRouter);
app.use('/api/games', actionsRouter);
app.use('/api/games', dataRouter);

// Error handling
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Express error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: config.server.env === 'development' ? err.message : undefined,
  });
});

// Create HTTP server
const server = app.listen(config.server.port);

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down server...');

  // Close HTTP server
  server.close(() => {
    logger.info('HTTP server closed');
  });

  // Close database connections
  await closeConnection();
  await redis.quit();

  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
async function start() {
  try {
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      throw new Error('Failed to connect to database');
    }

    // Server is already started above, just log
    logger.info(`HTTP Server running on port ${config.server.port}`);
    logger.info(`Environment: ${config.server.env}`);
    logger.info(`CORS origin: ${config.server.corsOrigin}`);
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
start();

export { app, server };
