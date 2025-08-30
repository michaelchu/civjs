import { Router, Request, Response } from 'express';
import { authenticateUser } from '../middleware/auth';
import { requireGameAccess } from '../middleware/gameAccess';
import { GameManager } from '../game/GameManager';
import { logger } from '../utils/logger';
import { z } from 'zod';

const router = Router();

// Request schema for turn resolution
const TurnResolveSchema = z.object({
  turnVersion: z.number(),
  playerActions: z.array(
    z.object({
      type: z.string(),
      data: z.any(),
      timestamp: z.string().optional(),
    })
  ),
  idempotencyKey: z.string(),
});

/**
 * POST /api/games/:id/turns/resolve - Resolve turn synchronously with SSE streaming
 *
 * This endpoint processes all player actions for a turn in a single batch,
 * streaming progress updates via Server-Sent Events, and returns the final game state.
 */
router.post(
  '/:id/turns/resolve',
  authenticateUser,
  requireGameAccess,
  async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const gameId = req.gameId!;
    const playerId = req.playerId!;

    try {
      // Validate request body
      const parseResult = TurnResolveSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid request format',
          details: parseResult.error.issues,
        });
        return;
      }

      const { turnVersion, playerActions, idempotencyKey } = parseResult.data;
      const requestFull = req.query.full === '1';

      logger.info('Starting turn resolution', {
        gameId,
        playerId,
        turnVersion,
        actionsCount: playerActions.length,
        idempotencyKey,
        requestFull,
      });

      // Set up Server-Sent Events
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
      });

      // Send initial event within 25s to unlock streaming budget
      const sendEvent = (eventType: string, data: any) => {
        res.write(`event: ${eventType}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // Send initialization event
      sendEvent('init', {
        message: 'Turn resolution started',
        turnVersion,
        timestamp: new Date().toISOString(),
      });

      const gameManager = GameManager.getInstance();
      const game = await gameManager.getGame(gameId);

      if (!game) {
        sendEvent('error', {
          error: 'Game not found',
          code: 'GAME_NOT_FOUND',
        });
        res.end();
        return;
      }

      // Check turn version to prevent stale applies
      const currentTurnVersion = game.getCurrentTurn();
      if (turnVersion !== currentTurnVersion) {
        sendEvent('error', {
          error: 'Turn version mismatch',
          code: 'STALE_TURN_VERSION',
          expected: currentTurnVersion,
          received: turnVersion,
        });
        res.end();
        return;
      }

      // Check for duplicate requests using idempotency key
      // TODO: Implement idempotency key checking with Redis/database

      // Process player actions in batch
      sendEvent('progress', {
        stage: 'processing_actions',
        message: `Processing ${playerActions.length} player actions`,
        progress: 0,
      });

      const actionResults = [];
      for (let i = 0; i < playerActions.length; i++) {
        const action = playerActions[i];
        try {
          const result = await processPlayerAction(gameManager, gameId, playerId, action);
          actionResults.push({ action, result, success: true });

          sendEvent('progress', {
            stage: 'processing_actions',
            message: `Processed action ${i + 1}/${playerActions.length}: ${action.type}`,
            progress: ((i + 1) / playerActions.length) * 0.3, // 30% for actions
            actionType: action.type,
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          actionResults.push({ action, error: errorMsg, success: false });

          sendEvent('progress', {
            stage: 'processing_actions',
            message: `Failed action ${i + 1}/${playerActions.length}: ${action.type}`,
            progress: ((i + 1) / playerActions.length) * 0.3,
            actionType: action.type,
            error: errorMsg,
          });
        }
      }

      // Process AI turns (for single-player)
      sendEvent('progress', {
        stage: 'ai_processing',
        message: 'Computing AI player moves',
        progress: 0.3,
      });

      // TODO: Implement AI processing
      await new Promise(resolve => setTimeout(resolve, 100)); // Simulate AI processing

      sendEvent('progress', {
        stage: 'ai_processing',
        message: 'AI processing complete',
        progress: 0.6,
      });

      // Advance turn and update world state
      sendEvent('progress', {
        stage: 'world_update',
        message: 'Updating world state',
        progress: 0.7,
      });

      // Process turn advancement
      await game.turnManager.processTurn();

      sendEvent('progress', {
        stage: 'world_update',
        message: 'World state updated',
        progress: 0.9,
      });

      // Generate response data
      const newTurnVersion = game.getCurrentTurn();
      const updatedGame = await gameManager.getGame(gameId);
      const gameState = updatedGame; // Use the full game object for now

      const response = {
        success: true,
        newTurnVersion,
        turnResolutionTime: Date.now() - startTime,
        actionResults,
        ...(requestFull
          ? { fullState: gameState }
          : { patch: generateStatePatch(turnVersion, gameState) }),
      };

      // Send final result
      sendEvent('complete', {
        ...response,
        message: 'Turn resolution complete',
        progress: 1.0,
      });

      logger.info('Turn resolution completed', {
        gameId,
        playerId,
        oldTurnVersion: turnVersion,
        newTurnVersion,
        processingTime: Date.now() - startTime,
        actionsProcessed: playerActions.length,
        successfulActions: actionResults.filter(r => r.success).length,
      });

      res.end();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Turn resolution failed', {
        gameId,
        playerId,
        error: errorMsg,
        processingTime: Date.now() - startTime,
      });

      const sendEvent = (eventType: string, data: any) => {
        try {
          res.write(`event: ${eventType}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          // Connection may be closed
        }
      };

      sendEvent('error', {
        error: errorMsg,
        code: 'TURN_RESOLUTION_FAILED',
      });

      res.end();
    }
  }
);

/**
 * Helper function to process individual player actions
 */
async function processPlayerAction(
  gameManager: GameManager,
  gameId: string,
  playerId: string,
  action: { type: string; data: any }
): Promise<any> {
  switch (action.type) {
    case 'unit_move':
      return await gameManager.moveUnit(
        gameId,
        playerId,
        action.data.unitId,
        action.data.toX,
        action.data.toY
      );

    case 'unit_attack':
      return await gameManager.attackUnit(
        gameId,
        playerId,
        action.data.attackerUnitId,
        action.data.defenderUnitId
      );

    case 'found_city':
      return await gameManager.foundCity(
        gameId,
        playerId,
        action.data.name,
        action.data.x,
        action.data.y
      );

    case 'research_selection':
      return await gameManager.setResearchGoal(gameId, playerId, action.data.techId);

    case 'end_turn':
      // Turn ending is handled at the batch level, not per action
      return { success: true, message: 'Turn end queued' };

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

/**
 * Generate a state patch by comparing old and new states
 * TODO: Implement efficient state diffing
 */
function generateStatePatch(oldTurnVersion: number, newState: any): any {
  // For now, return full state as patch
  // In production, implement proper diffing for efficiency
  return {
    type: 'full_replace',
    turnVersion: oldTurnVersion,
    changes: newState,
  };
}

export default router;
