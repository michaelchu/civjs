import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Configuration schema
const ConfigSchema = z.object({
  server: z.object({
    port: z.number().min(1).max(65535),
    env: z.enum(['development', 'production', 'test']),
    corsOrigin: z.string(),
  }),
  game: z.object({
    maxPlayersPerGame: z.number().min(1).max(32),
    turnTimeoutSeconds: z.number().min(30),
    autoSaveIntervalTurns: z.number().min(1),
    minPlayersToStart: z.number().min(1),
    maxGames: z.number().min(1),
  }),
  map: z.object({
    defaultWidth: z.number().min(20).max(200),
    defaultHeight: z.number().min(20).max(200),
    minCityDistance: z.number().min(1).max(5),
  }),
  logging: z.object({
    level: z.enum(['error', 'warn', 'info', 'debug', 'verbose']),
  }),
});

// Parse and validate configuration
const config = ConfigSchema.parse({
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
    corsOrigin: process.env.SOCKET_CORS_ORIGIN || '*',
  },
  game: {
    maxPlayersPerGame: parseInt(process.env.MAX_PLAYERS_PER_GAME || '8', 10),
    turnTimeoutSeconds: parseInt(process.env.TURN_TIMEOUT_SECONDS || '120', 10),
    autoSaveIntervalTurns: parseInt(process.env.AUTO_SAVE_INTERVAL_TURNS || '10', 10),
    minPlayersToStart: parseInt(process.env.MIN_PLAYERS_TO_START || '2', 10),
    maxGames: parseInt(process.env.MAX_GAMES || '100', 10),
  },
  map: {
    defaultWidth: parseInt(process.env.MAP_WIDTH || '80', 10),
    defaultHeight: parseInt(process.env.MAP_HEIGHT || '50', 10),
    minCityDistance: parseInt(process.env.MIN_CITY_DISTANCE || '3', 10),
  },
  logging: {
    level: (process.env.LOG_LEVEL || 'info') as any,
  },
});

export type Config = z.infer<typeof ConfigSchema>;
export default config;
