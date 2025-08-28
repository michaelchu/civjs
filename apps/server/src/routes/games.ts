import { Router, Request, Response } from 'express';
import { authenticateUser } from '../middleware/auth';
import { requireGameAccess, requireGameHost } from '../middleware/gameAccess';
import { GameManager } from '../game/GameManager';
import { logger } from '../utils/logger';

// HTTP-only implementation - no Socket.IO needed

const router = Router();

/**
 * POST /api/games - Create new game
 */
router.post('/', authenticateUser, async (req: Request, res: Response) => {
  try {
    const {
      name,
      maxPlayers = 4,
      mapWidth = 80,
      mapHeight = 50,
      ruleset = 'classic',
      turnTimeLimit,
      victoryConditions = ['conquest', 'science', 'culture'],
      terrainSettings = {
        generator: 'random',
        landmass: 'normal',
        huts: 15,
        temperature: 50,
        wetness: 50,
        rivers: 50,
        resources: 'normal',
      },
    } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Game name is required',
      });
    }

    const gameManager = GameManager.getInstance();

    const gameId = await gameManager.createGame({
      name: name.trim(),
      hostId: req.userId!,
      maxPlayers,
      mapWidth,
      mapHeight,
      ruleset,
      turnTimeLimit,
      victoryConditions,
      terrainSettings,
    });

    // Automatically join the creator as a player
    const playerId = await gameManager.joinGame(gameId, req.userId!, 'random');
    await gameManager.updatePlayerConnection(playerId, true);

    logger.info(`Game created by ${req.username}`, { gameId, hostId: req.userId });

    res.status(201).json({
      success: true,
      gameId,
      playerId,
      name: name.trim(),
      maxPlayers,
      message: 'Game created successfully',
    });
  } catch (error) {
    logger.error('Error creating game:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create game',
    });
  }
});

/**
 * GET /api/games - List available games
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const gameManager = GameManager.getInstance();
    const games = await gameManager.getGameListForLobby();

    const gameList = games.map(game => ({
      id: game.id,
      name: game.name,
      status: game.status,
      currentPlayers: game.currentPlayers,
      maxPlayers: game.maxPlayers,
      currentTurn: game.currentTurn,
      mapSize: `${game.mapSize}`,
      ruleset: 'classic',
      hostName: game.hostName || 'Unknown',
      lastUpdated: new Date().toISOString(),
    }));

    res.json({
      success: true,
      games: gameList,
    });
  } catch (error) {
    logger.error('Error getting game list:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get game list',
      games: [],
    });
  }
});

/**
 * GET /api/games/:id - Get game state and info
 */
router.get('/:id', authenticateUser, async (req: Request, res: Response) => {
  try {
    const gameId = req.params.id;
    const gameManager = GameManager.getInstance();

    // Get game from database
    const game = await gameManager.getGame(gameId);
    if (!game) {
      return res.status(404).json({
        success: false,
        error: 'Game not found',
      });
    }

    // Check if user is a player or can observe
    const players = Array.from(game.players.values());
    const userPlayer = players.find((p: any) => p.userId === req.userId);
    const isHost = game.config.hostId === req.userId;

    // Get current player info
    const currentPlayerNumber = game.turnManager.getCurrentPlayer();
    const currentPlayer = players.find((p: any) => p.playerNumber === currentPlayerNumber);
    const isMyTurn = userPlayer && userPlayer.playerNumber === currentPlayerNumber;

    const gameState = {
      id: gameId,
      name: game.config.name,
      status: game.state,
      currentPlayer: currentPlayer?.id || null,
      currentPlayerNumber: currentPlayerNumber,
      currentTurn: game.currentTurn,
      maxPlayers: game.config.maxPlayers || 4,
      players: players.map((p: any) => ({
        id: p.id,
        userId: p.userId,
        playerNumber: p.playerNumber,
        civilization: p.civilization,
        isReady: p.isReady,
        hasEndedTurn: p.hasEndedTurn,
        isConnected: p.isConnected,
      })),
      isMyTurn: isMyTurn || false,
      isHost,
      canObserve: true, // Allow anyone authenticated to observe
      lastUpdated: new Date().toISOString(),
      year: game.turnManager ? game.turnManager.getCurrentYear() : 4000,
    };

    res.json({
      success: true,
      game: gameState,
    });
  } catch (error) {
    logger.error('Error getting game state:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get game state',
    });
  }
});

/**
 * POST /api/games/:id/join - Join existing game
 */
router.post('/:id/join', authenticateUser, async (req: Request, res: Response) => {
  try {
    const gameId = req.params.id;
    const { civilization = 'random' } = req.body;

    const gameManager = GameManager.getInstance();

    // Check if game exists
    const game = await gameManager.getGame(gameId);
    if (!game) {
      return res.status(404).json({
        success: false,
        error: 'Game not found',
      });
    }

    // Check if user is already in the game
    const players = Array.from(game.players.values());
    const existingPlayer = players.find((p: any) => p.userId === req.userId);

    if (existingPlayer) {
      // User is already in the game, just update connection status
      await gameManager.updatePlayerConnection(existingPlayer.id, true);

      return res.json({
        success: true,
        playerId: existingPlayer.id,
        message: 'Reconnected to existing game',
        isReconnect: true,
      });
    }

    // Join as new player
    const playerId = await gameManager.joinGame(gameId, req.userId!, civilization);
    await gameManager.updatePlayerConnection(playerId, true);

    logger.info(`${req.username} joined game`, { gameId, playerId, userId: req.userId });

    res.json({
      success: true,
      playerId,
      gameId,
      message: 'Joined game successfully',
      isReconnect: false,
    });
  } catch (error) {
    logger.error('Error joining game:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to join game',
    });
  }
});

/**
 * POST /api/games/:id/start - Start game (host only)
 */
router.post(
  '/:id/start',
  authenticateUser,
  requireGameHost,
  async (req: Request, res: Response) => {
    try {
      const gameManager = GameManager.getInstance();

      await gameManager.startGame(req.gameId!, req.userId!);

      logger.info(`Game started by ${req.username}`, { gameId: req.gameId });

      res.json({
        success: true,
        message: 'Game started successfully',
      });
    } catch (error) {
      logger.error('Error starting game:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start game',
      });
    }
  }
);

/**
 * DELETE /api/games/:id/leave - Leave game
 */
router.delete(
  '/:id/leave',
  authenticateUser,
  requireGameAccess,
  async (req: Request, res: Response) => {
    try {
      const gameManager = GameManager.getInstance();

      // Mark player as disconnected
      await gameManager.updatePlayerConnection(req.playerId!, false);

      logger.info(`${req.username} left game`, { gameId: req.gameId, playerId: req.playerId });

      res.json({
        success: true,
        message: 'Left game successfully',
      });
    } catch (error) {
      logger.error('Error leaving game:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to leave game',
      });
    }
  }
);

/**
 * POST /api/games/:id/observe - Start observing game
 */
router.post('/:id/observe', authenticateUser, async (req: Request, res: Response) => {
  try {
    const gameId = req.params.id;
    const gameManager = GameManager.getInstance();

    const game = await gameManager.getGame(gameId);
    if (!game) {
      return res.status(404).json({
        success: false,
        error: 'Game not found',
      });
    }

    logger.info(`${req.username} is now observing game ${gameId}`);

    res.json({
      success: true,
      message: 'Now observing game',
      gameId,
    });
  } catch (error) {
    logger.error('Error observing game:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to observe game',
    });
  }
});

export default router;
