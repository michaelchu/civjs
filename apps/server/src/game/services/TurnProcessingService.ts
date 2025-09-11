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

export interface PlayerAction {
  type: 'unit_move' | 'unit_attack' | 'city_production' | 'research_selection' | 'unit_orders';
  playerId: string;
  data: any;
  timestamp: Date;
}

export interface TurnProcessingResult {
  actionsProcessed: number;
  unitsProcessed: number;
  citiesProcessed: number;
  researchUpdated: boolean;
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

  constructor(
    gameId: string,
    unitManager: UnitManager,
    cityManager: CityManager,
    researchManager: ResearchManager
  ) {
    this.gameId = gameId;
    this.unitManager = unitManager;
    this.cityManager = cityManager;
    this.researchManager = researchManager;
  }

  /**
   * Process all queued player actions from the current turn
   * @reference freeciv-web/javascript/packhand.js handle_begin_turn()
   */
  async processPlayerActions(actions: PlayerAction[]): Promise<TurnProcessingResult> {
    const result: TurnProcessingResult = {
      actionsProcessed: 0,
      unitsProcessed: 0,
      citiesProcessed: 0,
      researchUpdated: false,
      errors: [],
    };

    logger.info('Processing player actions', {
      gameId: this.gameId,
      actionCount: actions.length,
    });

    for (const action of actions) {
      try {
        await this.processPlayerAction(action);
        result.actionsProcessed++;
      } catch (error) {
        logger.error('Error processing player action', {
          gameId: this.gameId,
          playerId: action.playerId,
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

    logger.info('Player actions processed', {
      gameId: this.gameId,
      processed: result.actionsProcessed,
      errors: result.errors.length,
    });

    return result;
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
  async processCityProduction(playerId: string): Promise<number> {
    logger.debug('Processing city production for player', {
      gameId: this.gameId,
      playerId,
    });

    // Get all cities for the player
    const playerCities = await this.cityManager.getPlayerCities(playerId);
    let citiesProcessed = 0;

    for (const city of playerCities) {
      try {
        // Process production for this city (method exists in CityManager)
        await this.cityManager.processCityTurn(city.id, 0); // TODO: Pass actual turn number
        citiesProcessed++;
      } catch (error) {
        logger.error('Error processing city production', {
          gameId: this.gameId,
          playerId,
          cityId: city.id,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    logger.info('City production processed', {
      gameId: this.gameId,
      playerId,
      totalCities: playerCities.length,
      citiesProcessed,
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
      // Add research points and check if technology completed
      // TODO: Get actual research bulbs from city science output
      const researchBulbs = 10; // Placeholder - should be calculated from cities
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
}
