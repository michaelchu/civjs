import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';
import { testConnection } from './database/supabase';
import { GameService } from './services/gameService';
import gameRoutes from './routes/gameRoutes';

// Load environment variables
dotenv.config();

// Initialize services
const gameService = new GameService();

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
  })
);
app.use(express.json());

// Routes
app.use('/api/games', gameRoutes);

// Basic health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Socket.IO connection handling
io.on('connection', socket => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);

  // Test database connection
  console.log('🔗 Testing database connection...');
  const dbConnected = await testConnection();

  if (dbConnected) {
    console.log('🎮 CivJS server ready!');
  } else {
    console.error(
      '❌ Database connection failed - check your .env configuration'
    );
  }
});
