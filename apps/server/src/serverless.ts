import express from 'express';
import cors from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';

import config from './config';
import logger from './utils/logger';
import { testConnection } from './database';

// Load environment variables
dotenv.config();

// Create Express app (without Socket.IO for serverless)
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
app.get('/health', async (_req, res) => {
  try {
    // Test database connection
    const dbConnected = await testConnection();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbConnected ? 'connected' : 'disconnected',
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// API info endpoint
app.get('/api/info', (_req, res) => {
  res.json({
    name: 'CivJS Server',
    version: '1.0.0',
    environment: config.server.env,
    timestamp: new Date().toISOString(),
  });
});

// Error handling
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Express error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: config.server.env === 'development' ? err.message : undefined,
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: 'The requested endpoint does not exist',
  });
});

export { app };
export default app;
