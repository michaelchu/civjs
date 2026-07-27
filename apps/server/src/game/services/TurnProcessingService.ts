/**
 * TurnProcessingService - Coordinates game mechanics during turn processing
 *
 * This service handles the integration between TurnManager and specific game systems
 * (UnitManager, CityManager, ResearchManager) to execute player actions and
 * automated game processes during each turn.
 *
 * @reference freeciv/server/srv_main.c - begin_turn() and turn processing
 */

import { logger } from '@utils/logger';
import type { UnitManager } from '@game/managers/UnitManager';
import type { CityManager } from '@game/managers/CityManager';
import type { ResearchManager } from '@game/managers/ResearchManager';
import type { EconomicManager } from '@game/systems/Economic/EconomicManager';
import { rulesetBuildingsService } from '@game/services/RulesetBuildingsService';

export interface PlayerAction {
  id: string; // Unique action identifier
  type: 'unit_move' | 'unit_attack' | 'city_production' | 'research_selection' | 'unit_orders';
  playerId: string;
  priority: number; // Action priority (0 = highest, higher numbers = lower priority)
  data: any;
  timestamp: Date;
  dependencies?: string[]; // IDs of actions that must complete before this one
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
}

export interface ActionQueue {
  playerId: string;
  actions: PlayerAction[];
  isProcessing: boolean;
  lastProcessedAt?: Date;
}

export interface TurnProcessingResult {
  actionsProcessed: number;
  unitsProcessed: number;
  citiesProcessed: number;
  researchUpdated: boolean;
  economicsProcessed: boolean;
  errors: Array<{
    playerId: string;
    action: string;
    error: string;
  }>;
}

export class TurnProcessingService {
  private gameId: string;
  private unitManager: UnitManager;
  private cityManager: CityManager;
  private researchManager: ResearchManager;
  private economicManager?: EconomicManager;
  private actionQueues: Map<string, ActionQueue> = new Map(); // playerId -> ActionQueue
  private actionHistory: Map<string, PlayerAction[]> = new Map(); // playerId -> completed actions

  constructor(
    gameId: string,
    unitManager: UnitManager,
    cityManager: CityManager,
    researchManager: ResearchManager,
    economicManager?: EconomicManager
  ) {
    this.gameId = gameId;
    this.unitManager = unitManager;
    this.cityManager = cityManager;
    this.researchManager = researchManager;
    this.economicManager = economicManager;
  }

  /**
   * Initialize action queues for players
   * @reference freeciv turn processing initialization
   */
  initializeActionQueues(playerIds: string[]): void {
    logger.debug('Initializing action queues', {
      gameId: this.gameId,
      playerCount: playerIds.length,
    });

    for (const playerId of playerIds) {
      if (!this.actionQueues.has(playerId)) {
        this.actionQueues.set(playerId, {
          playerId,
          actions: [],
          isProcessing: false,
        });
        this.actionHistory.set(playerId, []);
      }
    }
  }

  /**
   * Queue a player action for processing during turn
   * @reference freeciv action queuing system
   */
  queuePlayerAction(action: Omit<PlayerAction, 'id' | 'status'>): string {
    const actionId = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const playerAction: PlayerAction = {
      ...action,
      id: actionId,
      status: 'queued',
    };

    const queue = this.actionQueues.get(action.playerId);
    if (!queue) {
      throw new Error(`No action queue found for player ${action.playerId}`);
    }

    // Insert action in priority order
    const insertIndex = this.findInsertionIndex(queue.actions, playerAction.priority);
    queue.actions.splice(insertIndex, 0, playerAction);

    logger.debug('Action queued', {
      gameId: this.gameId,
      playerId: action.playerId,
      actionId,
      actionType: action.type,
      priority: action.priority,
      queueLength: queue.actions.length,
    });

    return actionId;
  }

  /**
   * Find the correct insertion index for priority-based insertion
   */
  private findInsertionIndex(actions: PlayerAction[], priority: number): number {
    for (let i = 0; i < actions.length; i++) {
      if (actions[i].priority > priority) {
        return i;
      }
    }
    return actions.length;
  }

  /**
   * Get queued actions for a player
   */
  getPlayerActionQueue(playerId: string): PlayerAction[] {
    const queue = this.actionQueues.get(playerId);
    return queue?.actions.filter(a => a.status === 'queued') || [];
  }

  /**
   * Cancel a queued action
   */
  cancelPlayerAction(playerId: string, actionId: string): boolean {
    const queue = this.actionQueues.get(playerId);
    if (!queue) return false;

    const actionIndex = queue.actions.findIndex(a => a.id === actionId);
    if (actionIndex === -1) return false;

    const action = queue.actions[actionIndex];
    if (action.status === 'processing') {
      return false; // Cannot cancel processing actions
    }

    action.status = 'cancelled';
    logger.debug('Action cancelled', {
      gameId: this.gameId,
      playerId,
      actionId,
      actionType: action.type,
    });

    return true;
  }

  /**
   * Clear all queued actions for a player (e.g., on disconnection)
   */
  clearPlayerActionQueue(playerId: string): number {
    const queue = this.actionQueues.get(playerId);
    if (!queue) return 0;

    const queuedActions = queue.actions.filter(a => a.status === 'queued');
    const cancelledCount = queuedActions.length;

    queuedActions.forEach(action => {
      action.status = 'cancelled';
    });

    logger.debug('Player action queue cleared', {
      gameId: this.gameId,
      playerId,
      cancelledActions: cancelledCount,
    });

    return cancelledCount;
  }

  /**
   * Process all queued player actions from the current turn
   * @reference freeciv-web/javascript/packhand.js handle_begin_turn()
   */
  async processQueuedPlayerActions(): Promise<TurnProcessingResult> {
    const result: TurnProcessingResult = {
      actionsProcessed: 0,
      unitsProcessed: 0,
      citiesProcessed: 0,
      researchUpdated: false,
      economicsProcessed: false,
      errors: [],
    };

    const totalActions = Array.from(this.actionQueues.values()).reduce(
      (sum, queue) => sum + queue.actions.filter(a => a.status === 'queued').length,
      0
    );

    logger.info('Processing queued player actions', {
      gameId: this.gameId,
      totalActions,
      playerCount: this.actionQueues.size,
    });

    // Process actions for each player in priority order
    for (const [playerId, queue] of this.actionQueues) {
      if (queue.isProcessing) {
        continue; // Skip if already processing
      }

      queue.isProcessing = true;
      queue.lastProcessedAt = new Date();

      const queuedActions = queue.actions.filter(a => a.status === 'queued');

      logger.debug('Processing player action queue', {
        gameId: this.gameId,
        playerId,
        actionCount: queuedActions.length,
      });

      for (const action of queuedActions) {
        try {
          // Check dependencies
          if (action.dependencies && !this.checkActionDependencies(action.dependencies)) {
            logger.debug('Action dependencies not met, skipping', {
              gameId: this.gameId,
              actionId: action.id,
              dependencies: action.dependencies,
            });
            continue;
          }

          action.status = 'processing';

          await this.processPlayerAction(action);

          action.status = 'completed';
          result.actionsProcessed++;

          // Move to history
          const history = this.actionHistory.get(playerId) || [];
          history.push(action);
          this.actionHistory.set(playerId, history);
        } catch (error) {
          action.status = 'failed';

          logger.error('Error processing player action', {
            gameId: this.gameId,
            playerId: action.playerId,
            actionId: action.id,
            actionType: action.type,
            error: error instanceof Error ? error.message : error,
          });

          result.errors.push({
            playerId: action.playerId,
            action: action.type,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Clean up completed/failed actions from queue
      queue.actions = queue.actions.filter(a => a.status === 'queued');
      queue.isProcessing = false;
    }

    logger.info('Queued player actions processed', {
      gameId: this.gameId,
      processed: result.actionsProcessed,
      errors: result.errors.length,
    });

    return result;
  }

  /**
   * Legacy method for backward compatibility
   */
  async processPlayerActions(actions: PlayerAction[]): Promise<TurnProcessingResult> {
    // Add actions to queue and process them
    for (const action of actions) {
      this.queuePlayerAction(action);
    }

    return this.processQueuedPlayerActions();
  }

  /**
   * Check if action dependencies are satisfied
   */
  private checkActionDependencies(dependencyIds: string[]): boolean {
    for (const dependencyId of dependencyIds) {
      let found = false;

      for (const history of this.actionHistory.values()) {
        if (history.some(action => action.id === dependencyId && action.status === 'completed')) {
          found = true;
          break;
        }
      }

      if (!found) {
        return false;
      }
    }

    return true;
  }

  /**
   * Process individual player action by delegating to appropriate manager
   */
  private async processPlayerAction(action: PlayerAction): Promise<void> {
    switch (action.type) {
      case 'unit_move':
        await this.processUnitMoveAction(action.playerId, action.data);
        break;

      case 'unit_attack':
        await this.processUnitAttackAction(action.playerId, action.data);
        break;

      case 'city_production':
        await this.processCityProductionAction(action.playerId, action.data);
        break;

      case 'research_selection':
        await this.processResearchSelectionAction(action.playerId, action.data);
        break;

      case 'unit_orders':
        await this.processUnitOrdersAction(action.playerId, action.data);
        break;

      default:
        logger.warn('Unknown action type', {
          gameId: this.gameId,
          playerId: action.playerId,
          actionType: action.type,
        });
    }
  }

  /**
   * Process unit movement action
   * Delegates to UnitManager.moveUnit()
   */
  private async processUnitMoveAction(playerId: string, moveData: any): Promise<void> {
    const { unitId, x, y } = moveData;

    // Validate unit belongs to player
    const unit = this.unitManager.getUnit(unitId);
    if (!unit) {
      throw new Error(`Unit not found: ${unitId}`);
    }

    if (unit.playerId !== playerId) {
      throw new Error(`Unit ${unitId} does not belong to player ${playerId}`);
    }

    // Execute move through UnitManager
    await this.unitManager.moveUnit(unitId, x, y);

    logger.debug('Processed unit move', {
      gameId: this.gameId,
      playerId,
      unitId,
      newPosition: { x, y },
    });
  }

  /**
   * Process unit attack action
   * Delegates to UnitManager.attackUnit()
   */
  private async processUnitAttackAction(playerId: string, attackData: any): Promise<void> {
    const { attackerUnitId, defenderUnitId } = attackData;

    // Validate attacker belongs to player
    const attackerUnit = this.unitManager.getUnit(attackerUnitId);
    if (!attackerUnit) {
      throw new Error(`Attacker unit not found: ${attackerUnitId}`);
    }

    if (attackerUnit.playerId !== playerId) {
      throw new Error(`Attacker unit ${attackerUnitId} does not belong to player ${playerId}`);
    }

    // Execute attack through UnitManager
    const combatResult = await this.unitManager.attackUnit(attackerUnitId, defenderUnitId);

    logger.debug('Processed unit attack', {
      gameId: this.gameId,
      playerId,
      attackerUnitId,
      defenderUnitId,
      result: combatResult,
    });
  }

  /**
   * Process city production change action
   * Delegates to CityManager
   */
  private async processCityProductionAction(playerId: string, productionData: any): Promise<void> {
    const { cityId, production, type } = productionData;

    // Validate city belongs to player
    const city = await this.cityManager.getCity(cityId);
    if (!city) {
      throw new Error(`City not found: ${cityId}`);
    }

    if (city.playerId !== playerId) {
      throw new Error(`City ${cityId} does not belong to player ${playerId}`);
    }

    // Execute production change through CityManager
    await this.cityManager.setCityProduction(cityId, type, production, playerId);

    logger.debug('Processed city production change', {
      gameId: this.gameId,
      playerId,
      cityId,
      production,
      type,
    });
  }

  /**
   * Process research selection action
   * Delegates to ResearchManager
   */
  private async processResearchSelectionAction(playerId: string, researchData: any): Promise<void> {
    const { techId } = researchData;

    // Execute research selection through ResearchManager
    await this.researchManager.setCurrentResearch(playerId, techId);

    logger.debug('Processed research selection', {
      gameId: this.gameId,
      playerId,
      techId,
    });
  }

  /**
   * Process unit orders action (GOTO, patrol, etc.)
   * Delegates to UnitManager
   */
  private async processUnitOrdersAction(playerId: string, ordersData: any): Promise<void> {
    const { unitId, orders } = ordersData;

    // Validate unit belongs to player
    const unit = this.unitManager.getUnit(unitId);
    if (!unit) {
      throw new Error(`Unit not found: ${unitId}`);
    }

    if (unit.playerId !== playerId) {
      throw new Error(`Unit ${unitId} does not belong to player ${playerId}`);
    }

    // Clear existing orders and add new ones
    this.unitManager.clearUnitOrders(unitId);
    for (const order of orders) {
      this.unitManager.addOrderToUnit(unitId, order);
    }

    logger.debug('Processed unit orders', {
      gameId: this.gameId,
      playerId,
      unitId,
      orderCount: orders.length,
    });
  }

  /**
   * Reset movement points for all units of a player
   * Delegates to UnitManager.resetMovement()
   * @reference freeciv/server/srv_main.c begin_turn() - unit movement restoration
   */
  async resetPlayerUnitMovement(playerId: string): Promise<number> {
    logger.debug('Resetting unit movement for player', {
      gameId: this.gameId,
      playerId,
    });

    // Get unit count before reset for reporting
    const playerUnits = this.unitManager.getPlayerUnits(playerId);
    const unitCount = playerUnits.length;

    // Delegate to existing UnitManager method
    await this.unitManager.resetMovement(playerId);

    logger.info('Unit movement reset completed', {
      gameId: this.gameId,
      playerId,
      unitsReset: unitCount,
    });

    return unitCount;
  }

  /**
   * Process automated unit orders (GOTO, patrol, activities)
   * Delegates to UnitManager.processUnitOrders()
   */
  async processUnitOrders(playerId: string): Promise<number> {
    logger.debug('Processing unit orders for player', {
      gameId: this.gameId,
      playerId,
    });

    // Delegate to existing UnitManager method
    await this.unitManager.processUnitOrders(playerId);

    // Count processed units (simplified - could be enhanced)
    const playerUnits = this.unitManager.getPlayerUnits(playerId);
    const unitsWithOrders = playerUnits.filter(unit => unit.orders && unit.orders.length > 0);

    logger.info('Unit orders processed', {
      gameId: this.gameId,
      playerId,
      totalUnits: playerUnits.length,
      unitsWithOrders: unitsWithOrders.length,
    });

    return unitsWithOrders.length;
  }

  /**
   * Process city production for all cities of a player
   * Delegates to CityManager.processProduction()
   */
  async processCityProduction(playerId: string, currentTurn?: number): Promise<number> {
    logger.debug('Processing city production for player', {
      gameId: this.gameId,
      playerId,
      currentTurn,
    });

    // Get all cities for the player
    const playerCities = await this.cityManager.getPlayerCities(playerId);
    let citiesProcessed = 0;
    const failedCities: Array<{ cityId: string; cityName: string; error: string }> = [];
    const CITY_PROCESSING_TIMEOUT = 10000; // 10 second timeout per city

    if (playerCities.length === 0) {
      logger.debug('No cities found for player', { gameId: this.gameId, playerId });
      return 0;
    }

    logger.debug('Processing cities for player', {
      gameId: this.gameId,
      playerId,
      cityCount: playerCities.length,
    });

    for (const city of playerCities) {
      const cityStartTime = Date.now();

      try {
        // Add per-city timeout to prevent individual cities from hanging the entire process
        const timeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`City processing timed out after ${CITY_PROCESSING_TIMEOUT}ms`));
          }, CITY_PROCESSING_TIMEOUT);
        });

        // Race between city processing and timeout
        const processingPromise = this.cityManager.processCityTurn(city.id, currentTurn || 0);

        await Promise.race([processingPromise, timeoutPromise]);
        citiesProcessed++;

        const processingTime = Date.now() - cityStartTime;
        if (processingTime > 1000) {
          // Log slow cities for monitoring
          logger.warn('Slow city processing detected', {
            gameId: this.gameId,
            playerId,
            cityId: city.id,
            cityName: city.name,
            processingTime,
          });
        }
      } catch (error) {
        const processingTime = Date.now() - cityStartTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.error('Error processing city production', {
          gameId: this.gameId,
          playerId,
          cityId: city.id,
          cityName: city.name,
          processingTime,
          error: errorMessage,
          isTimeout: errorMessage.includes('timed out'),
        });

        failedCities.push({
          cityId: city.id,
          cityName: city.name,
          error: errorMessage,
        });

        // Continue processing other cities - don't let one bad city break everything
        continue;
      }
    }

    // Log summary with details about failures
    if (failedCities.length > 0) {
      logger.warn('Some cities failed to process', {
        gameId: this.gameId,
        playerId,
        totalCities: playerCities.length,
        citiesProcessed,
        failedCities: failedCities.length,
        failures: failedCities,
      });
    }

    logger.info('City production processed', {
      gameId: this.gameId,
      playerId,
      totalCities: playerCities.length,
      citiesProcessed,
      failedCities: failedCities.length,
    });

    return citiesProcessed;
  }

  /**
   * Process research progress for a player
   * Delegates to ResearchManager
   */
  async processResearch(playerId: string): Promise<boolean> {
    logger.debug('Processing research for player', {
      gameId: this.gameId,
      playerId,
    });

    try {
      // Each city contributes its science output to the player's research pool.
      // @reference reference/freeciv/server/techtools.c:650-719
      const researchBulbs = this.cityManager
        .getPlayerCities(playerId)
        .reduce((total, city) => total + (city.sciencePerTurn ?? 0), 0);
      const completedTech = await this.researchManager.addResearchPoints(playerId, researchBulbs);

      logger.info('Research processed', {
        gameId: this.gameId,
        playerId,
        bulbsAdded: researchBulbs,
        completedTech,
      });

      return !!completedTech; // Return true if a tech was completed
    } catch (error) {
      logger.error('Error processing research', {
        gameId: this.gameId,
        playerId,
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  /**
   * Process economic calculations for end of turn
   * Integrates with EconomicManager to calculate gold accumulation
   */
  async processPlayerEconomics(playerId: string, turn: number): Promise<boolean> {
    if (!this.economicManager) {
      return false; // Economics not enabled
    }

    try {
      // Get all cities for this player
      const cities = this.cityManager.getCitiesByPlayer(playerId);
      const cityOutputs = [];

      // Calculate economic output for each city
      for (const city of cities) {
        const buildingTypes = rulesetBuildingsService.getBuildingTypes();
        const buildingUpkeep = city.buildings.reduce(
          (total, buildingId) => total + (buildingTypes[buildingId]?.upkeep ?? 0),
          0
        );
        const economicOutput = this.economicManager.calculateCityEconomicOutput(
          city.id,
          playerId,
          city.tradePerTurn || 0, // Raw trade from city
          0, // Direct gold (calculated by CityEconomicService)
          buildingUpkeep,
          city.unitGoldUpkeep ?? 0,
          city.goldPerTurn ?? 0
        );
        cityOutputs.push(economicOutput);
      }

      // Process player turn economics
      await this.economicManager.processTurnEconomics(playerId, cityOutputs, turn);

      logger.debug('Economics processed', {
        gameId: this.gameId,
        playerId,
        turn,
        citiesProcessed: cityOutputs.length,
      });

      return true;
    } catch (error) {
      logger.error('Error processing economics', {
        gameId: this.gameId,
        playerId,
        turn,
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  /**
   * Process all players' economics for end of turn
   */
  async processAllPlayersEconomics(playerIds: string[], turn: number): Promise<boolean> {
    if (!this.economicManager) {
      return false;
    }

    try {
      for (const playerId of playerIds) {
        await this.processPlayerEconomics(playerId, turn);
      }

      logger.info('All players economics processed', {
        gameId: this.gameId,
        turn,
        playerCount: playerIds.length,
      });

      return true;
    } catch (error) {
      logger.error('Error processing all players economics', {
        gameId: this.gameId,
        turn,
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }
}
