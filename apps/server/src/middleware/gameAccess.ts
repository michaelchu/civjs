import { Request, Response, NextFunction } from 'express';
import { db } from '../database';
import { games } from '../database/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';

// Extend Express Request to include game info
declare module 'express-serve-static-core' {
  interface Request {
    gameId?: string;
    playerId?: string;
    isGameHost?: boolean;
    isGameObserver?: boolean;
  }
}

/**
 * Middleware to verify user has access to a specific game
 * Requires authentication middleware to run first
 */
export async function requireGameAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    const gameId = req.params.gameId || req.params.id;
    if (!gameId) {
      res.status(400).json({
        success: false,
        error: 'Game ID is required',
      });
      return;
    }

    // Find the game
    const game = await db.query.games.findFirst({
      where: eq(games.id, gameId),
      with: {
        players: true,
      },
    });

    if (!game) {
      res.status(404).json({
        success: false,
        error: 'Game not found',
      });
      return;
    }

    // Check if user is a player in this game
    const player = game.players.find(p => p.userId === req.userId);

    if (!player) {
      res.status(403).json({
        success: false,
        error: 'You are not a player in this game',
      });
      return;
    }

    // Attach game info to request
    req.gameId = gameId;
    req.playerId = player.id;
    req.isGameHost = game.hostId === req.userId;
    req.isGameObserver = false; // Players are not observers

    next();
  } catch (error) {
    logger.error('Game access middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify game access',
    });
  }
}

/**
 * Middleware to allow both players and observers to access a game
 */
export async function requireGameAccessOrObserver(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    const gameId = req.params.gameId || req.params.id;
    if (!gameId) {
      res.status(400).json({
        success: false,
        error: 'Game ID is required',
      });
      return;
    }

    // Find the game
    const game = await db.query.games.findFirst({
      where: eq(games.id, gameId),
      with: {
        players: true,
      },
    });

    if (!game) {
      res.status(404).json({
        success: false,
        error: 'Game not found',
      });
      return;
    }

    // Check if user is a player in this game
    const player = game.players.find(p => p.userId === req.userId);

    // Attach game info to request
    req.gameId = gameId;
    req.isGameHost = game.hostId === req.userId;

    if (player) {
      // User is a player
      req.playerId = player.id;
      req.isGameObserver = false;
    } else {
      // User is an observer (not a player but can view the game)
      req.playerId = undefined;
      req.isGameObserver = true;
    }

    next();
  } catch (error) {
    logger.error('Game access or observer middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify game access',
    });
  }
}

/**
 * Middleware to verify user is the host of a game
 */
export async function requireGameHost(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    const gameId = req.params.gameId || req.params.id;
    if (!gameId) {
      res.status(400).json({
        success: false,
        error: 'Game ID is required',
      });
      return;
    }

    // Find the game
    const game = await db.query.games.findFirst({
      where: eq(games.id, gameId),
    });

    if (!game) {
      res.status(404).json({
        success: false,
        error: 'Game not found',
      });
      return;
    }

    if (game.hostId !== req.userId) {
      res.status(403).json({
        success: false,
        error: 'Only the game host can perform this action',
      });
      return;
    }

    // Attach game info to request
    req.gameId = gameId;
    req.isGameHost = true;

    next();
  } catch (error) {
    logger.error('Game host middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify game host access',
    });
  }
}

/**
 * Middleware to verify it's the player's turn (for game actions)
 */
export async function requirePlayerTurn(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.userId || !req.gameId || !req.playerId) {
      res.status(401).json({
        success: false,
        error: 'Authentication and game access required',
      });
    }

    // Find the game to check current player turn
    const game = await db.query.games.findFirst({
      where: eq(games.id, req.gameId!),
      with: {
        players: true,
      },
    });

    if (!game) {
      res.status(404).json({
        success: false,
        error: 'Game not found',
      });
      return;
    }

    if (game.status !== 'playing') {
      res.status(400).json({
        success: false,
        error: `Cannot perform actions when game is ${game.status}`,
      });
      return;
    }

    // For now, skip turn validation - it will be handled by the game logic
    // TODO: Implement proper turn validation once turn system is fully migrated

    next();
  } catch (error) {
    logger.error('Player turn middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify player turn',
    });
  }
}
