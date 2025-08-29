import { Router, Request, Response } from 'express';
import { authenticateUser } from '../middleware/auth';
import { requireGameAccessOrObserver } from '../middleware/gameAccess';
import { GameManager } from '../game/GameManager';
import { logger } from '../utils/logger';
import { db } from '../database';
import { games } from '../database/schema';
import { eq } from 'drizzle-orm';

// HTTP-only implementation - no Socket.IO needed

const router = Router();

/**
 * GET /api/games/:id/map - Get map data
 */
router.get(
  '/:id/map',
  authenticateUser,
  requireGameAccessOrObserver,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const gameManager = GameManager.getInstance();

      // Try to get game instance, recover if not found
      let gameInstance = gameManager.getGameInstance(req.gameId!);
      if (!gameInstance) {
        logger.info('Game instance not found in memory, attempting recovery', {
          gameId: req.gameId,
        });
        gameInstance = await gameManager.recoverGameInstance(req.gameId!);

        if (!gameInstance) {
          res.status(404).json({
            success: false,
            error: 'Game not found or could not be recovered',
          });
          return;
        }
      }

      if (req.isGameObserver) {
        // Observers can see full map
        const mapData = gameManager.getMapData(req.gameId!);

        const mapTiles = {}; // TODO: Implement getFullMapForObserver method
        res.json({
          success: true,
          mapData: {
            width: mapData.width,
            height: mapData.height,
            tiles: mapTiles,
            xsize: mapData.width,
            ysize: mapData.height,
            topology: 0,
            wrap_id: 0,
          },
        });
      } else {
        // Players see their map view only
        const playerMapView = gameManager.getPlayerMapView(req.gameId!, req.playerId!);

        if (!playerMapView) {
          res.status(404).json({
            success: false,
            error: 'Player map view not found',
          });
          return;
        }

        res.json({
          success: true,
          mapData: playerMapView
            ? {
                width: playerMapView.width,
                height: playerMapView.height,
                tiles: playerMapView.tiles,
                xsize: playerMapView.width,
                ysize: playerMapView.height,
                topology: 0,
                wrap_id: 0,
              }
            : {
                width: 0,
                height: 0,
                tiles: {},
                xsize: 0,
                ysize: 0,
                topology: 0,
                wrap_id: 0,
              },
        });
      }
    } catch (error) {
      logger.error('Error getting map data:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get map data',
      });
      return;
    }
  }
);

/**
 * GET /api/games/:id/tiles - Get visible tiles for player
 */
router.get(
  '/:id/tiles',
  authenticateUser,
  requireGameAccessOrObserver,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.isGameObserver) {
        res.status(403).json({
          success: false,
          error: 'Observers cannot access player-specific tile visibility',
        });
      }

      const gameManager = GameManager.getInstance();
      const visibleTiles = gameManager.getPlayerVisibleTiles(req.gameId!, req.playerId!);

      res.json({
        success: true,
        visibleTiles,
      });
      return;
    } catch (error) {
      logger.error('Error getting visible tiles:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get visible tiles',
      });
      return;
    }
  }
);

/**
 * GET /api/games/:id/units - Get player's units
 */
router.get(
  '/:id/units',
  authenticateUser,
  requireGameAccessOrObserver,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const gameManager = GameManager.getInstance();

      // Try to get game instance, recover if not found
      let gameInstance = gameManager.getGameInstance(req.gameId!);
      if (!gameInstance) {
        logger.info('Game instance not found in memory, attempting recovery', {
          gameId: req.gameId,
        });
        gameInstance = await gameManager.recoverGameInstance(req.gameId!);

        if (!gameInstance) {
          res.status(404).json({
            success: false,
            error: 'Game not found or could not be recovered',
          });
          return;
        }
      }

      let units: any[] = [];

      if (req.isGameObserver) {
        // Observers can see all units - get units from all players
        for (const player of gameInstance.players.values()) {
          const playerUnits = gameInstance.unitManager.getPlayerUnits(player.id);
          units.push(...playerUnits);
        }
      } else {
        // Players see only their units
        units = gameInstance.unitManager.getPlayerUnits(req.playerId!);
      }

      const unitsData = units.map(unit => ({
        id: unit.id,
        type: unit.type,
        x: unit.x,
        y: unit.y,
        playerId: unit.playerId,
        movementLeft: unit.movementLeft,
        maxMovement: unit.maxMovement,
        hitPoints: unit.hitPoints,
        maxHitPoints: unit.maxHitPoints,
        isFortified: unit.isFortified,
        veteranLevel: unit.veteranLevel,
        activity: unit.activity,
      }));

      res.json({
        success: true,
        units: unitsData,
      });
      return;
    } catch (error) {
      logger.error('Error getting units:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get units',
      });
      return;
    }
  }
);

/**
 * GET /api/games/:id/cities - Get player's cities
 */
router.get(
  '/:id/cities',
  authenticateUser,
  requireGameAccessOrObserver,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const gameManager = GameManager.getInstance();

      // Try to get game instance, recover if not found
      let gameInstance = gameManager.getGameInstance(req.gameId!);
      if (!gameInstance) {
        logger.info('Game instance not found in memory, attempting recovery', {
          gameId: req.gameId,
        });
        gameInstance = await gameManager.recoverGameInstance(req.gameId!);

        if (!gameInstance) {
          res.status(404).json({
            success: false,
            error: 'Game not found or could not be recovered',
          });
          return;
        }
      }

      let cities: any[] = [];

      if (req.isGameObserver) {
        // Observers can see all cities - get cities from all players
        for (const player of gameInstance.players.values()) {
          const playerCities = gameInstance.cityManager.getPlayerCities(player.id);
          cities.push(...playerCities);
        }
      } else {
        // Players see only their cities
        cities = gameInstance.cityManager.getPlayerCities(req.playerId!);
      }

      const citiesData = cities.map(city => ({
        id: city.id,
        name: city.name,
        x: city.x,
        y: city.y,
        playerId: city.playerId,
        population: city.population,
        size: city.size,
        foodStock: city.foodStock,
        productionStock: city.productionStock,
        currentProduction: city.currentProduction,
        productionType: city.productionType,
        buildings: city.buildings,
        specialists: city.specialists,
        isCapital: city.isCapital,
      }));

      res.json({
        success: true,
        cities: citiesData,
      });
      return;
    } catch (error) {
      logger.error('Error getting cities:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get cities',
      });
      return;
    }
  }
);

/**
 * GET /api/games/:id/research - Get player's research status
 */
router.get(
  '/:id/research',
  authenticateUser,
  requireGameAccessOrObserver,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.isGameObserver) {
        res.status(403).json({
          success: false,
          error: 'Observers cannot access player-specific research data',
        });
      }

      const gameManager = GameManager.getInstance();

      // Get available technologies
      const availableTechs = gameManager.getAvailableTechnologies(req.gameId!, req.playerId!);

      // Get player research status
      const playerResearch = gameManager.getPlayerResearch(req.gameId!, req.playerId!);

      // Get research progress
      const progress = gameManager.getResearchProgress(req.gameId!, req.playerId!);

      res.json({
        success: true,
        availableTechs: availableTechs.map(tech => ({
          id: tech.id,
          name: tech.name,
          cost: tech.cost,
          requirements: tech.requirements,
          description: tech.description,
        })),
        currentTech: playerResearch?.currentTech,
        techGoal: playerResearch?.techGoal,
        researchedTechs: playerResearch ? Array.from(playerResearch.researchedTechs) : [],
        progress: {
          current: progress?.current || 0,
          required: progress?.required || 0,
          turnsRemaining: progress?.turnsRemaining || -1,
        },
      });
      return;
    } catch (error) {
      logger.error('Error getting research status:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get research status',
      });
      return;
    }
  }
);

/**
 * GET /api/games/:id/visibility/:x/:y - Get tile visibility for specific coordinate
 */
router.get(
  '/:id/visibility/:x/:y',
  authenticateUser,
  requireGameAccessOrObserver,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.isGameObserver) {
        res.status(403).json({
          success: false,
          error: 'Observers cannot access player-specific visibility data',
        });
      }

      const x = parseInt(req.params.x);
      const y = parseInt(req.params.y);

      if (isNaN(x) || isNaN(y)) {
        res.status(400).json({
          success: false,
          error: 'Invalid coordinates',
        });
      }

      const gameManager = GameManager.getInstance();
      const visibility = gameManager.getTileVisibility(req.gameId!, req.playerId!, x, y);

      res.json({
        success: true,
        x,
        y,
        isVisible: visibility.isVisible,
        isExplored: visibility.isExplored,
        lastSeen: visibility.lastSeen,
      });
      return;
    } catch (error) {
      logger.error('Error getting tile visibility:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get tile visibility',
      });
      return;
    }
  }
);

/**
 * GET /api/games/:id/players - Get all players in game
 */
router.get(
  '/:id/players',
  authenticateUser,
  requireGameAccessOrObserver,
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Get game from database to include player info
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

      const playersData = game.players.map(player => ({
        id: player.id,
        userId: player.userId,
        playerNumber: player.playerNumber,
        civilization: player.civilization,
        isReady: player.isReady,
        hasEndedTurn: player.hasEndedTurn,
        isConnected: player.connectionStatus === 'connected',
        // Don't expose userId for other players unless observer or same player
        isYou: player.userId === req.userId,
      }));

      res.json({
        success: true,
        players: playersData,
        currentPlayer: 1, // TODO: Calculate current player from turn logic
        currentTurn: game?.currentTurn || 0,
      });
      return;
    } catch (error) {
      logger.error('Error getting players:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get players',
      });
      return;
    }
  }
);

export default router;
