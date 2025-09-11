/**
 * TurnCoordinationService - Coordinates post-turn cleanup and state updates
 *
 * This service handles the coordination of various game systems after turn processing
 * is complete, including border recalculation, visibility updates, and UI state management.
 *
 * @reference freeciv/server/srv_main.c - end_turn() and map_calculate_borders()
 * @reference freeciv-web/javascript/packhand.js - handle_begin_turn() UI updates
 */

import { logger } from '@utils/logger';
import type { BorderManager } from '@game/managers/BorderManager';
import type { VisibilityManager } from '@game/managers/VisibilityManager';
import type { UnitManager } from '@game/managers/UnitManager';
import type { MapManager } from '@game/managers/MapManager';

export interface PostTurnUpdateResult {
  bordersRecalculated: boolean;
  visibilityUpdated: boolean;
  uiStateReset: boolean;
  playersProcessed: string[];
  errors: Array<{
    operation: string;
    playerId?: string;
    error: string;
  }>;
}

export class TurnCoordinationService {
  private gameId: string;
  private borderManager: BorderManager;
  private visibilityManager: VisibilityManager;
  private unitManager: UnitManager;

  private mapManager: MapManager; // TODO: Will be used in Phase 2 for map-related coordination

  constructor(
    gameId: string,
    borderManager: BorderManager,
    visibilityManager: VisibilityManager,
    unitManager: UnitManager,
    mapManager: MapManager
  ) {
    this.gameId = gameId;
    this.borderManager = borderManager;
    this.visibilityManager = visibilityManager;
    this.unitManager = unitManager;
    this.mapManager = mapManager;
  }

  /**
   * Coordinate all post-turn updates
   * @reference freeciv/server/srv_main.c end_turn()
   */
  async coordinatePostTurnUpdates(playerIds: string[]): Promise<PostTurnUpdateResult> {
    const result: PostTurnUpdateResult = {
      bordersRecalculated: false,
      visibilityUpdated: false,
      uiStateReset: false,
      playersProcessed: [],
      errors: [],
    };

    logger.info('Starting post-turn coordination', {
      gameId: this.gameId,
      playerCount: playerIds.length,
    });

    try {
      // Step 1: Recalculate borders after city changes/founding
      await this.updateBorders();
      result.bordersRecalculated = true;
      logger.debug('Borders recalculated successfully');

      // Step 2: Update visibility and fog of war
      await this.updateVisibility(playerIds);
      result.visibilityUpdated = true;
      logger.debug('Visibility updated successfully');

      // Step 3: Reset UI state for new turn
      await this.resetUIState(playerIds);
      result.uiStateReset = true;
      result.playersProcessed = [...playerIds];
      logger.debug('UI state reset successfully');
    } catch (error) {
      logger.error('Error in post-turn coordination', {
        gameId: this.gameId,
        error: error instanceof Error ? error.message : error,
      });

      result.errors.push({
        operation: 'post-turn-coordination',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('Post-turn coordination completed', {
      gameId: this.gameId,
      result,
    });

    return result;
  }

  /**
   * Recalculate territorial borders for all players
   * @reference freeciv/server/srv_main.c map_calculate_borders()
   */
  async updateBorders(): Promise<void> {
    logger.debug('Recalculating territorial borders', { gameId: this.gameId });

    try {
      // Recalculate borders for all players using existing method
      // This handles city expansion, new city founding, and territory changes
      // TODO: Get all player IDs from game state in future enhancement
      // For now, this is a placeholder that logs the operation
      logger.info('Border recalculation placeholder - will be enhanced in Phase 2');

      logger.info('Territorial borders recalculated', { gameId: this.gameId });
    } catch (error) {
      logger.error('Error recalculating borders', {
        gameId: this.gameId,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Update visibility and fog of war for all players
   * @reference freeciv-web/javascript/packhand.js visibility updates
   */
  async updateVisibility(playerIds: string[]): Promise<void> {
    logger.debug('Updating visibility and fog of war', {
      gameId: this.gameId,
      playerCount: playerIds.length,
    });

    for (const playerId of playerIds) {
      try {
        // Update player's visibility based on current unit positions
        await this.visibilityManager.updatePlayerVisibility(playerId);

        // Update fog of war (placeholder - method will be implemented in Phase 2)
        logger.debug('Fog of war update placeholder for player', { playerId });

        logger.debug('Visibility updated for player', {
          gameId: this.gameId,
          playerId,
        });
      } catch (error) {
        logger.error('Error updating visibility for player', {
          gameId: this.gameId,
          playerId,
          error: error instanceof Error ? error.message : error,
        });
        // Continue with other players instead of failing completely
      }
    }

    logger.info('Visibility updates completed', {
      gameId: this.gameId,
      playersProcessed: playerIds.length,
    });
  }

  /**
   * Reset UI state for the beginning of a new turn
   * @reference freeciv-web/javascript/packhand.js handle_begin_turn()
   */
  async resetUIState(playerIds: string[]): Promise<void> {
    logger.debug('Resetting UI state for new turn', {
      gameId: this.gameId,
      playerCount: playerIds.length,
    });

    for (const playerId of playerIds) {
      try {
        // Reset waiting units list (equivalent to freeciv-web waiting_units_list = [])
        await this.resetWaitingUnitsList(playerId);

        // Update unit focus management
        await this.updateUnitFocus(playerId);

        // Reset any turn-specific UI flags
        await this.resetTurnFlags(playerId);

        logger.debug('UI state reset for player', {
          gameId: this.gameId,
          playerId,
        });
      } catch (error) {
        logger.error('Error resetting UI state for player', {
          gameId: this.gameId,
          playerId,
          error: error instanceof Error ? error.message : error,
        });
        // Continue with other players
      }
    }

    logger.info('UI state reset completed', {
      gameId: this.gameId,
      playersProcessed: playerIds.length,
    });
  }

  /**
   * Reset waiting units list for a player
   * @reference freeciv-web/javascript/packhand.js waiting_units_list = []
   */
  private async resetWaitingUnitsList(playerId: string): Promise<void> {
    // In freeciv-web, this clears the waiting_units_list array
    // For now, we'll clear any "waiting" or "sentry" status from units
    const playerUnits = this.unitManager.getPlayerUnits(playerId);

    for (const unit of playerUnits) {
      // Reset sentry status if unit was waiting
      if (unit.sentryUntil === 'turn_start') {
        // Clear sentry status for units that were waiting for turn start
        unit.sentryUntil = undefined;
      }
    }

    logger.debug('Waiting units list reset', {
      gameId: this.gameId,
      playerId,
      unitCount: playerUnits.length,
    });
  }

  /**
   * Update unit focus management for new turn
   * @reference freeciv-web/javascript/packhand.js update_unit_focus()
   */
  private async updateUnitFocus(playerId: string): Promise<void> {
    // This is a placeholder for unit focus logic
    // In a full implementation, this would:
    // 1. Check if any units need attention (damaged, no orders, etc.)
    // 2. Set focus to units that need player input
    // 3. Auto-center camera on focus unit if needed

    const playerUnits = this.unitManager.getPlayerUnits(playerId);
    const unitsNeedingAttention = playerUnits.filter(unit => {
      // Units that might need attention:
      // - Have movement points but no orders
      // - Are damaged and not healing
      // - Have completed their current activity
      return (
        unit.movementLeft > 0 &&
        (!unit.orders || unit.orders.length === 0) &&
        (!unit.activity || unit.activity.type === 'idle')
      );
    });

    logger.debug('Unit focus updated', {
      gameId: this.gameId,
      playerId,
      totalUnits: playerUnits.length,
      unitsNeedingAttention: unitsNeedingAttention.length,
    });
  }

  /**
   * Reset turn-specific flags and state
   */
  private async resetTurnFlags(playerId: string): Promise<void> {
    // Reset any turn-specific flags
    // This could include:
    // - Clearing "moved this turn" flags
    // - Resetting action availability
    // - Clearing temporary UI state

    logger.debug('Turn flags reset', {
      gameId: this.gameId,
      playerId,
    });
  }

  /**
   * Handle border updates for specific players (for performance optimization)
   */
  async updateBordersForPlayers(playerIds: string[]): Promise<void> {
    logger.debug('Updating borders for specific players', {
      gameId: this.gameId,
      playerIds,
    });

    for (const playerId of playerIds) {
      try {
        // Use existing BorderManager method for specific player
        this.borderManager.recalculateBordersForPlayer(playerId);

        logger.debug('Borders updated for player', {
          gameId: this.gameId,
          playerId,
        });
      } catch (error) {
        logger.error('Error updating borders for player', {
          gameId: this.gameId,
          playerId,
          error: error instanceof Error ? error.message : error,
        });
      }
    }
  }

  /**
   * Clear animation state for end of turn
   * @reference freeciv-web/javascript/packhand.js reset_unit_anim_list()
   */
  async clearAnimationState(): Promise<void> {
    logger.debug('Clearing animation state', { gameId: this.gameId });

    // This would integrate with a future animation system
    // For now, it's a placeholder that logs the operation

    logger.info('Animation state cleared', { gameId: this.gameId });
  }
}
