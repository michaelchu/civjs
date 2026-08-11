/**
 * @module server/game/services/TurnCoordinationService
 * TurnCoordinationService - Coordinates post-turn cleanup and state updates
 *
 * This service handles the coordination of various game systems after turn processing
 * is complete, including border recalculation, visibility updates, and UI state management.
 *
 * @reference freeciv/server/srv_main.c - end_turn() and map_calculate_borders()
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/packhand.js - handle_begin_turn() UI updates
 */

import { logger } from '@utils/logger';
import type { BorderManager } from '@game/managers/BorderManager';
import type { VisibilityManager } from '@game/managers/VisibilityManager';
import type { UnitManager } from '@game/managers/UnitManager';
import type { CityManager } from '@game/managers/CityManager';
import type { TurnStatistics } from '@game/managers/TurnManager';

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
  private cityManager: CityManager;

  constructor(
    gameId: string,
    borderManager: BorderManager,
    visibilityManager: VisibilityManager,
    unitManager: UnitManager,
    cityManager: CityManager
  ) {
    this.gameId = gameId;
    this.borderManager = borderManager;
    this.visibilityManager = visibilityManager;
    this.unitManager = unitManager;
    this.cityManager = cityManager;
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
      const playerIds = new Set(this.cityManager.getAllCities().map(city => city.playerId));
      for (const unit of this.unitManager.getAllUnits().values()) {
        playerIds.add(unit.playerId);
      }

      const update = this.borderManager.recalculateAllBorders();

      logger.info('Territorial borders recalculated', {
        gameId: this.gameId,
        playersProcessed: playerIds.size,
        totalPlayers: playerIds.size,
        tilesChanged: update.tiles.length,
      });
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
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/packhand.js visibility updates
   */
  async updateVisibility(playerIds: string[]): Promise<void> {
    logger.debug('Updating visibility and fog of war', {
      gameId: this.gameId,
      playerCount: playerIds.length,
    });

    let playersProcessed = 0;
    for (const playerId of playerIds) {
      try {
        // Update player's visibility based on current unit positions
        // This recalculates what tiles the player can see based on their units and cities
        this.visibilityManager.updatePlayerVisibility(playerId);
        playersProcessed++;

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
      playersProcessed,
      totalPlayers: playerIds.length,
    });
  }

  /**
   * Reset UI state for the beginning of a new turn
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/packhand.js handle_begin_turn()
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
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/packhand.js waiting_units_list = []
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js advance_focus_inactive_units()
   */
  private async resetWaitingUnitsList(playerId: string): Promise<void> {
    // In freeciv-web, this completely clears the waiting_units_list array
    // The waiting_units_list tracks units that have been given orders but are
    // still available for focus cycling (e.g., units that were put on "wait")

    const playerUnits = this.unitManager.getPlayerUnits(playerId);
    let waitingUnitsCleared = 0;

    for (const unit of playerUnits) {
      // Clear any "waiting" status - units start fresh each turn
      if (unit.sentryUntil === 'turn_start') {
        unit.sentryUntil = undefined;
        waitingUnitsCleared++;
      }

      // Fortification is a persistent activity. It is cleared only by an
      // authoritative order, movement, combat, transport, or ownership
      // transition, not by the start of a new turn.

      // Clear any temporary "patrolling" activity from previous turn
      if (unit.activity?.type === 'patrolling') {
        unit.activity = undefined; // Clear the activity
      }
    }

    logger.debug('Waiting units list reset', {
      gameId: this.gameId,
      playerId,
      totalUnits: playerUnits.length,
      waitingUnitsCleared,
    });
  }

  /**
   * Update unit focus management for new turn
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js update_unit_focus()
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js advance_unit_focus()
   */
  private async updateUnitFocus(playerId: string): Promise<void> {
    // Implement freeciv-web's unit focus logic:
    // 1. Clear current focus (units start without focus each turn)
    // 2. Find units that need player attention (movesleft > 0, done_moving = false, ai = false, activity = idle)
    // 3. Set initial focus to first unit needing attention
    // 4. Build urgent focus queue for units requiring immediate action

    const playerUnits = this.unitManager.getPlayerUnits(playerId);

    // In freeciv-web, focus is managed by the client, not the server
    // The server's role is to ensure unit state is properly reset for new turn

    // Find units needing attention (matching freeciv-web's update_unit_focus logic)
    const unitsNeedingAttention = playerUnits.filter(unit => {
      return (
        unit.movementLeft > 0 &&
        !unit.fortified && // Use fortified instead of doneMoving
        (!unit.activity || unit.activity.type === 'idle')
      );
    });

    // Build urgent focus queue for damaged units, units under attack, etc.
    const urgentUnits = playerUnits.filter(unit => {
      return (
        unit.health < 75 || // Damaged units need attention (health is 0-100)
        (unit.sentryUntil && unit.movementLeft > 0) || // Units with sentry conditions
        (unit.orders && unit.orders.length === 0 && unit.movementLeft > 0) // Units that completed orders
      );
    });

    // Log information for client focus management
    let priorityUnit = null;
    if (urgentUnits.length > 0) {
      priorityUnit = urgentUnits[0];
    } else if (unitsNeedingAttention.length > 0) {
      priorityUnit = unitsNeedingAttention[0];
    }

    logger.debug('Unit focus updated', {
      gameId: this.gameId,
      playerId,
      totalUnits: playerUnits.length,
      unitsNeedingAttention: unitsNeedingAttention.length,
      urgentUnits: urgentUnits.length,
      priorityUnit: priorityUnit?.id || null,
    });
  }

  /**
   * Reset turn-specific flags and state
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/packhand.js handle_begin_turn()
   */
  private async resetTurnFlags(playerId: string): Promise<void> {
    // Reset turn-specific flags that need to be cleared at the start of each turn
    const playerUnits = this.unitManager.getPlayerUnits(playerId);
    let flagsReset = 0;

    for (const unit of playerUnits) {
      // Clear any temporary sentry conditions from previous turn
      if (unit.sentryUntil === 'turn_start') {
        unit.sentryUntil = undefined;
        flagsReset++;
      }

      // Reset auto-exploration targets that may have been set
      if (unit.autoExploreTarget) {
        unit.autoExploreTarget = undefined;
        flagsReset++;
      }

      // Clear completed orders (orders that finished previous turn)
      if (unit.orders && unit.orders.length === 0) {
        unit.orders = undefined;
        flagsReset++;
      }
    }

    // Reset player-level turn flags
    // These would be stored in player state or game state
    // Examples: end_turn_info_message_shown = false (from freeciv-web)

    logger.debug('Turn flags reset', {
      gameId: this.gameId,
      playerId,
      unitsProcessed: playerUnits.length,
      flagsReset,
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
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/unit.js reset_unit_anim_list()
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/packhand.js handle_end_turn()
   */
  async clearAnimationState(): Promise<void> {
    logger.debug('Clearing animation state', { gameId: this.gameId });

    // In freeciv-web, reset_unit_anim_list() clears the anim_list property
    // from all units and resets the animation counter
    // This is called at the end of each turn to clean up movement animations

    const allUnitsMap = this.unitManager.getAllUnits();
    const allUnits = Array.from(allUnitsMap.values());
    let animationsClearedCount = 0;

    for (const unit of allUnits) {
      // Clear any ongoing activities that represent animations
      if (unit.activity && unit.activity.type !== 'idle') {
        // Don't clear long-term activities like fortifying or building
        const temporaryActivities = ['patrolling'];
        if (temporaryActivities.includes(unit.activity.type)) {
          unit.activity = undefined;
          animationsClearedCount++;
        }
      }

      // Clear transport animations (units loading/unloading)
      if (unit.transportedBy) {
        // Animation state would be client-side, this is just validation
        // that transport relationships are still valid
        animationsClearedCount++;
      }
    }

    logger.info('Animation state cleared', {
      gameId: this.gameId,
      totalUnits: allUnits.length,
      animationsClearedCount,
    });
  }

  /**
   * Calculate real turn statistics from game managers
   * @reference freeciv/server/srv_main.c turn statistics calculation
   */
  async calculateTurnStatistics(
    turn: number,
    year: number,
    playerIds: string[],
    actionsProcessed: number,
    processingTimeMs: number
  ): Promise<TurnStatistics> {
    logger.debug('Calculating turn statistics', {
      gameId: this.gameId,
      turn,
      year,
      playerCount: playerIds.length,
    });

    try {
      // Get total unit count from all players
      let unitsTotal = 0;
      for (const playerId of playerIds) {
        const playerUnits = this.unitManager.getPlayerUnits(playerId);
        unitsTotal += playerUnits.length;
      }

      // Get total city count from all players
      let citiesTotal = 0;
      for (const playerId of playerIds) {
        try {
          const playerCities = await this.cityManager.getPlayerCities(playerId);
          citiesTotal += playerCities.length;
        } catch (error) {
          logger.warn('Error getting city count for player', {
            gameId: this.gameId,
            playerId,
            error: error instanceof Error ? error.message : error,
          });
        }
      }

      const statistics: TurnStatistics = {
        playersActive: playerIds.length,
        unitsTotal,
        citiesTotal,
        actionsProcessed,
        processingTimeMs,
      };

      logger.info('Turn statistics calculated', {
        gameId: this.gameId,
        turn,
        statistics,
      });

      return statistics;
    } catch (error) {
      logger.error('Error calculating turn statistics', {
        gameId: this.gameId,
        turn,
        error: error instanceof Error ? error.message : error,
      });

      // Return fallback statistics
      return {
        playersActive: playerIds.length,
        unitsTotal: 0,
        citiesTotal: 0,
        actionsProcessed,
        processingTimeMs,
      };
    }
  }
}
