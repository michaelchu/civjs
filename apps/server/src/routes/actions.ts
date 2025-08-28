import { Router, Request, Response } from 'express';
import { authenticateUser } from '../middleware/auth';
import { requireGameAccess, requirePlayerTurn } from '../middleware/gameAccess';
import { GameManager } from '../game/GameManager';
import { logger } from '../utils/logger';

// HTTP-only implementation - no Socket.IO needed

const router = Router();

/**
 * POST /api/games/:id/actions/move - Move unit
 */
router.post(
  '/:id/actions/move',
  authenticateUser,
  requireGameAccess,
  requirePlayerTurn,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { unitId, toX, toY } = req.body;

      if (!unitId || typeof toX !== 'number' || typeof toY !== 'number') {
        res.status(400).json({
          success: false,
          error: 'unitId, toX, and toY are required',
        });
      }

      const gameManager = GameManager.getInstance();
      const moved = await gameManager.moveUnit(req.gameId!, req.playerId!, unitId, toX, toY);

      if (moved) {
        const game = await gameManager.getGame(req.gameId!);
        const unit = game?.unitManager.getUnit(unitId);

        logger.debug('Unit moved successfully', {
          gameId: req.gameId,
          playerId: req.playerId,
          unitId,
          newPosition: { x: toX, y: toY },
        });

        res.json({
          success: true,
          unitId,
          newX: unit?.x,
          newY: unit?.y,
          movementLeft: unit?.movementLeft,
          message: 'Unit moved successfully',
        });
      } else {
        res.status(400).json({
          success: false,
          error: 'Move failed - invalid move or insufficient movement points',
          unitId,
        });
      }
    } catch (error) {
      logger.error('Error moving unit:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to move unit',
      });
      return;
    }
  }
);

/**
 * POST /api/games/:id/actions/attack - Attack with unit
 */
router.post(
  '/:id/actions/attack',
  authenticateUser,
  requireGameAccess,
  requirePlayerTurn,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { attackerUnitId, defenderUnitId } = req.body;

      if (!attackerUnitId || !defenderUnitId) {
        res.status(400).json({
          success: false,
          error: 'attackerUnitId and defenderUnitId are required',
        });
      }

      const gameManager = GameManager.getInstance();
      const combatResult = await gameManager.attackUnit(
        req.gameId!,
        req.playerId!,
        attackerUnitId,
        defenderUnitId
      );

      logger.debug('Unit attack executed', {
        gameId: req.gameId,
        playerId: req.playerId,
        attackerUnitId,
        defenderUnitId,
        combatResult,
      });

      res.json({
        success: true,
        combatResult,
        message: 'Attack completed',
      });
      return;
    } catch (error) {
      logger.error('Error processing unit attack:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to attack unit',
      });
      return;
    }
  }
);

/**
 * POST /api/games/:id/actions/fortify - Fortify unit
 */
router.post(
  '/:id/actions/fortify',
  authenticateUser,
  requireGameAccess,
  requirePlayerTurn,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { unitId } = req.body;

      if (!unitId) {
        res.status(400).json({
          success: false,
          error: 'unitId is required',
        });
      }

      const gameManager = GameManager.getInstance();
      await gameManager.fortifyUnit(req.gameId!, req.playerId!, unitId);

      logger.debug('Unit fortified', {
        gameId: req.gameId,
        playerId: req.playerId,
        unitId,
      });

      res.json({
        success: true,
        unitId,
        message: 'Unit fortified successfully',
      });
      return;
    } catch (error) {
      logger.error('Error fortifying unit:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fortify unit',
      });
      return;
    }
  }
);

/**
 * POST /api/games/:id/actions/found-city - Found city
 */
router.post(
  '/:id/actions/found-city',
  authenticateUser,
  requireGameAccess,
  requirePlayerTurn,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, x, y } = req.body;

      if (!name || typeof x !== 'number' || typeof y !== 'number') {
        res.status(400).json({
          success: false,
          error: 'name, x, and y are required',
        });
      }

      const gameManager = GameManager.getInstance();
      const cityId = await gameManager.foundCity(req.gameId!, req.playerId!, name, x, y);

      logger.debug('City founded', {
        gameId: req.gameId,
        playerId: req.playerId,
        cityId,
        name,
        position: { x, y },
      });

      res.json({
        success: true,
        cityId,
        name,
        x,
        y,
        message: 'City founded successfully',
      });
      return;
    } catch (error) {
      logger.error('Error founding city:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to found city',
      });
      return;
    }
  }
);

/**
 * POST /api/games/:id/actions/research - Set research
 */
router.post(
  '/:id/actions/research',
  authenticateUser,
  requireGameAccess,
  requirePlayerTurn,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { techId } = req.body;

      if (!techId) {
        res.status(400).json({
          success: false,
          error: 'techId is required',
        });
      }

      const gameManager = GameManager.getInstance();
      await gameManager.setPlayerResearch(req.gameId!, req.playerId!, techId);

      const availableTechs = gameManager.getAvailableTechnologies(req.gameId!, req.playerId!);

      logger.debug('Research set', {
        gameId: req.gameId,
        playerId: req.playerId,
        techId,
      });

      res.json({
        success: true,
        techId,
        availableTechs: availableTechs.map(tech => ({
          id: tech.id,
          name: tech.name,
          cost: tech.cost,
          requirements: tech.requirements,
          description: tech.description,
        })),
        message: 'Research set successfully',
      });
      return;
    } catch (error) {
      logger.error('Error setting research:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set research',
      });
      return;
    }
  }
);

/**
 * POST /api/games/:id/actions/research-goal - Set research goal
 */
router.post(
  '/:id/actions/research-goal',
  authenticateUser,
  requireGameAccess,
  requirePlayerTurn,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { techId } = req.body;

      if (!techId) {
        res.status(400).json({
          success: false,
          error: 'techId is required',
        });
      }

      const gameManager = GameManager.getInstance();
      await gameManager.setResearchGoal(req.gameId!, req.playerId!, techId);

      logger.debug('Research goal set', {
        gameId: req.gameId,
        playerId: req.playerId,
        techGoal: techId,
      });

      res.json({
        success: true,
        techGoal: techId,
        message: 'Research goal set successfully',
      });
      return;
    } catch (error) {
      logger.error('Error setting research goal:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set research goal',
      });
      return;
    }
  }
);

/**
 * POST /api/games/:id/actions/end-turn - End player's turn
 */
router.post(
  '/:id/actions/end-turn',
  authenticateUser,
  requireGameAccess,
  requirePlayerTurn,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const gameManager = GameManager.getInstance();
      const turnAdvanced = await gameManager.endTurn(req.playerId!);
      const game = await gameManager.getGameByPlayerId(req.playerId!);

      logger.debug(`${req.username} ended turn`, {
        gameId: req.gameId,
        playerId: req.playerId,
        turn: game?.currentTurn,
        turnAdvanced,
      });

      const response: any = {
        success: true,
        turnAdvanced,
        message: turnAdvanced ? 'Turn ended and advanced' : 'Turn ended, waiting for other players',
      };

      if (turnAdvanced && game) {
        response.newTurn = game.currentTurn;
        response.year = game.turnManager.getCurrentYear();
        response.currentPlayer = game.turnManager.getCurrentPlayer();
      }

      res.json(response);
    } catch (error) {
      logger.error('Error ending turn:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to end turn',
      });
      return;
    }
  }
);

/**
 * POST /api/games/:id/actions/city-production - Change city production
 */
router.post(
  '/:id/actions/city-production',
  authenticateUser,
  requireGameAccess,
  requirePlayerTurn,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { cityId, production, type } = req.body;

      if (!cityId || !production || !type) {
        res.status(400).json({
          success: false,
          error: 'cityId, production, and type are required',
        });
      }

      const gameManager = GameManager.getInstance();
      await gameManager.setCityProduction(req.gameId!, req.playerId!, cityId, production, type);

      logger.debug('City production changed', {
        gameId: req.gameId,
        playerId: req.playerId,
        cityId,
        production,
        type,
      });

      res.json({
        success: true,
        cityId,
        production,
        type,
        message: 'City production changed successfully',
      });
      return;
    } catch (error) {
      logger.error('Error changing city production:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to change production',
      });
      return;
    }
  }
);

/**
 * POST /api/games/:id/actions/create-unit - Create unit
 */
router.post(
  '/:id/actions/create-unit',
  authenticateUser,
  requireGameAccess,
  requirePlayerTurn,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { unitType, x, y } = req.body;

      if (!unitType || typeof x !== 'number' || typeof y !== 'number') {
        res.status(400).json({
          success: false,
          error: 'unitType, x, and y are required',
        });
      }

      const gameManager = GameManager.getInstance();
      const unitId = await gameManager.createUnit(req.gameId!, req.playerId!, unitType, x, y);

      logger.debug('Unit created', {
        gameId: req.gameId,
        playerId: req.playerId,
        unitId,
        unitType,
        position: { x, y },
      });

      res.json({
        success: true,
        unitId,
        unitType,
        x,
        y,
        message: 'Unit created successfully',
      });
      return;
    } catch (error) {
      logger.error('Error creating unit:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create unit',
      });
      return;
    }
  }
);

export default router;
