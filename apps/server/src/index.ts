import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';
import path from 'path';

import config from './config';
import logger from './utils/logger';
import { testConnection, closeConnection } from './database';
import redis from './database/redis';
import { setupSocketHandlers } from './network/socket-handlers';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const httpServer = createServer(app);

// Create Socket.IO server
const io = new Server(httpServer, {
  cors: {
    origin: config.server.corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

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
app.use('/tileset', express.static('public/tilesets'));
app.use('/js', express.static('public/js'));
app.use('/sprites', express.static('public/sprites'));

// Serve client build in production
if (config.server.env === 'production') {
  const clientPath = path.join(__dirname, '..', 'public');
  app.use(express.static(clientPath));
  
  // Handle client-side routing - serve index.html for all non-API routes
  app.get('*', (req, res, next) => {
    // Skip API and health check routes
    if (req.path.startsWith('/api') || req.path === '/health') {
      return next();
    }
    res.sendFile(path.join(clientPath, 'index.html'));
  });
}

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API info endpoint
app.get('/api/info', (_req, res) => {
  res.json({
    name: 'CivJS Game Server',
    version: '1.0.0',
    maxPlayers: config.game.maxPlayersPerGame,
    supportedRulesets: ['classic', 'civ1', 'civ2'],
  });
});

// Socket.IO connection handling
io.on('connection', socket => {
  logger.info(`New client connected: ${socket.id}`);
  setupSocketHandlers(io, socket);
});

// Error handling
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Express error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: config.server.env === 'development' ? err.message : undefined,
  });
});

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down server...');

  // Close Socket.IO connections
  io.close(() => {
    logger.info('Socket.IO server closed');
  });

  // Close HTTP server
  httpServer.close(() => {
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

    // Start HTTP server
    httpServer.listen(config.server.port, () => {
      logger.info(`Server running on port ${config.server.port}`);
      logger.info(`Environment: ${config.server.env}`);
      logger.info(`CORS origin: ${config.server.corsOrigin}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
start();

export { app, io, httpServer };
