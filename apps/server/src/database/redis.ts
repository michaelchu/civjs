import Redis from 'ioredis';
import logger from '../utils/logger';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Create Redis client
export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: times => {
    if (times > 3) {
      logger.error('Redis connection failed after 3 retries');
      return null;
    }
    return Math.min(times * 200, 2000);
  },
});

// Redis event handlers
redis.on('connect', () => {
  logger.info('Redis client connected');
});

redis.on('error', error => {
  logger.error('Redis client error:', error);
});

redis.on('close', () => {
  logger.info('Redis connection closed');
});

// Helper functions for game state caching
export const gameCache = {
  // Get game state from cache
  async getGameState(gameId: string): Promise<any | null> {
    try {
      const data = await redis.get(`game:${gameId}:state`);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error(`Failed to get game state from cache: ${gameId}`, error);
      return null;
    }
  },

  // Set game state in cache with TTL
  async setGameState(gameId: string, state: any, ttl = 3600): Promise<void> {
    try {
      await redis.setex(`game:${gameId}:state`, ttl, JSON.stringify(state));
    } catch (error) {
      logger.error(`Failed to cache game state: ${gameId}`, error);
    }
  },

  // Delete game state from cache
  async deleteGameState(gameId: string): Promise<void> {
    try {
      await redis.del(`game:${gameId}:state`);
    } catch (error) {
      logger.error(`Failed to delete game state from cache: ${gameId}`, error);
    }
  },

  // Get player's active games
  async getPlayerGames(playerId: string): Promise<string[]> {
    try {
      const games = await redis.smembers(`player:${playerId}:games`);
      return games;
    } catch (error) {
      logger.error(`Failed to get player games: ${playerId}`, error);
      return [];
    }
  },

  // Add player to game
  async addPlayerToGame(playerId: string, gameId: string): Promise<void> {
    try {
      await redis.sadd(`player:${playerId}:games`, gameId);
      await redis.sadd(`game:${gameId}:players`, playerId);
    } catch (error) {
      logger.error(`Failed to add player to game: ${playerId} -> ${gameId}`, error);
    }
  },

  // Remove player from game
  async removePlayerFromGame(playerId: string, gameId: string): Promise<void> {
    try {
      await redis.srem(`player:${playerId}:games`, gameId);
      await redis.srem(`game:${gameId}:players`, playerId);
    } catch (error) {
      logger.error(`Failed to remove player from game: ${playerId} -> ${gameId}`, error);
    }
  },
};

// Session management
export const sessionCache = {
  // Store session
  async setSession(sessionId: string, userId: string, ttl = 86400): Promise<void> {
    try {
      await redis.setex(`session:${sessionId}`, ttl, userId);
    } catch (error) {
      logger.error(`Failed to set session: ${sessionId}`, error);
    }
  },

  // Get session
  async getSession(sessionId: string): Promise<string | null> {
    try {
      return await redis.get(`session:${sessionId}`);
    } catch (error) {
      logger.error(`Failed to get session: ${sessionId}`, error);
      return null;
    }
  },

  // Delete session
  async deleteSession(sessionId: string): Promise<void> {
    try {
      await redis.del(`session:${sessionId}`);
    } catch (error) {
      logger.error(`Failed to delete session: ${sessionId}`, error);
    }
  },
};

// Turn queue management
export const turnQueue = {
  // Add action to turn queue
  async addAction(gameId: string, action: any): Promise<void> {
    try {
      await redis.rpush(`game:${gameId}:actions`, JSON.stringify(action));
    } catch (error) {
      logger.error(`Failed to add action to queue: ${gameId}`, error);
    }
  },

  // Get all actions for a turn
  async getActions(gameId: string): Promise<any[]> {
    try {
      const actions = await redis.lrange(`game:${gameId}:actions`, 0, -1);
      return actions.map(a => JSON.parse(a));
    } catch (error) {
      logger.error(`Failed to get actions from queue: ${gameId}`, error);
      return [];
    }
  },

  // Clear action queue
  async clearActions(gameId: string): Promise<void> {
    try {
      await redis.del(`game:${gameId}:actions`);
    } catch (error) {
      logger.error(`Failed to clear action queue: ${gameId}`, error);
    }
  },
};

// Game state management
export const gameState = {
  // Set game state
  async setGameState(gameId: string, state: any): Promise<void> {
    try {
      await redis.hset(`game:${gameId}:state`, state);
    } catch (error) {
      logger.error(`Failed to set game state: ${gameId}`, error);
    }
  },

  // Get game state
  async getGameState(gameId: string): Promise<any> {
    try {
      return await redis.hgetall(`game:${gameId}:state`);
    } catch (error) {
      logger.error(`Failed to get game state: ${gameId}`, error);
      return null;
    }
  },

  // Clear game state
  async clearGameState(gameId: string): Promise<void> {
    try {
      await redis.del(`game:${gameId}:state`);
    } catch (error) {
      logger.error(`Failed to clear game state: ${gameId}`, error);
    }
  },
};

export default redis;
