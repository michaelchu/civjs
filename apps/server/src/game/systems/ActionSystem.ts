import { logger } from '@utils/logger';
import {
  ActionType,
  ActionDefinition,
  ActionResult,
  ActionProbability,
  ActionCategory,
  ActionTargetType,
  ActionMovesActor,
} from '@app-types/shared/actions';
import { Unit, UnitOrder } from '@game/managers/UnitManager';
import { SINGLE_MOVE } from '@game/constants/MovementConstants';
import { getUnitType } from '@game/constants/UnitConstants';

// Action definitions based on freeciv classic ruleset
// @reference freeciv/common/actions.c
const ACTION_DEFINITIONS = {
  // Basic movement actions
  [ActionType.MOVE]: {
    id: ActionType.MOVE,
    name: 'Move',
    description: 'Move unit to target tile',
    category: ActionCategory.BASIC,
    requirements: [],
    targetType: ActionTargetType.TILE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.MOVES_TO_TARGET,
  },

  [ActionType.ATTACK]: {
    id: ActionType.ATTACK,
    name: 'Attack',
    description: 'Attack enemy unit or city',
    category: ActionCategory.MILITARY,
    requirements: [{ type: 'unit_type', value: ['warriors', 'archers', 'pikemen'], present: true }],
    targetType: ActionTargetType.UNIT,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.FORTIFY]: {
    id: ActionType.FORTIFY,
    name: 'Fortify',
    description: 'Fortify unit for defensive bonus',
    hotkey: 'F',
    category: ActionCategory.BASIC,
    requirements: [{ type: 'unit_type', value: ['warriors', 'archers', 'pikemen'], present: true }],
    targetType: ActionTargetType.NONE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.SENTRY]: {
    id: ActionType.SENTRY,
    name: 'Sentry',
    description: 'Put unit on sentry duty',
    hotkey: 'S',
    category: ActionCategory.BASIC,
    requirements: [],
    targetType: ActionTargetType.NONE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.WAIT]: {
    id: ActionType.WAIT,
    name: 'Wait',
    description: 'Wait and preserve movement points',
    hotkey: 'W',
    category: ActionCategory.BASIC,
    requirements: [],
    targetType: ActionTargetType.NONE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.GOTO]: {
    id: ActionType.GOTO,
    name: 'Go To',
    description: 'Set destination for unit movement',
    hotkey: 'G',
    category: ActionCategory.MOVEMENT,
    requirements: [],
    targetType: ActionTargetType.TILE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.MOVES_TO_TARGET,
  },

  [ActionType.FOUND_CITY]: {
    id: ActionType.FOUND_CITY,
    name: 'Found City',
    description: 'Found a new city at this location',
    hotkey: 'B',
    category: ActionCategory.BUILD,
    requirements: [{ type: 'unit_flag', value: 'canFoundCity', present: true }],
    targetType: ActionTargetType.NONE,
    consumes_actor: true,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.BUILD_ROAD]: {
    id: ActionType.BUILD_ROAD,
    name: 'Build Road',
    description: 'Build a road on this tile',
    hotkey: 'R',
    category: ActionCategory.BUILD,
    requirements: [{ type: 'unit_flag', value: 'canBuildImprovements', present: true }],
    targetType: ActionTargetType.NONE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.BUILD_RAILROAD]: {
    id: ActionType.BUILD_RAILROAD,
    name: 'Build Railroad',
    description: 'Build a railroad on this tile',
    hotkey: 'L',
    category: ActionCategory.BUILD,
    requirements: [{ type: 'unit_flag', value: 'canBuildImprovements', present: true }],
    targetType: ActionTargetType.NONE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.BUILD_IRRIGATION]: {
    id: ActionType.BUILD_IRRIGATION,
    name: 'Build Irrigation',
    description: 'Irrigate this tile to increase food production',
    hotkey: 'I',
    category: ActionCategory.BUILD,
    requirements: [{ type: 'unit_flag', value: 'canBuildImprovements', present: true }],
    targetType: ActionTargetType.NONE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.BUILD_MINE]: {
    id: ActionType.BUILD_MINE,
    name: 'Build Mine',
    description: 'Build a mine on this tile to increase shield production',
    hotkey: 'M',
    category: ActionCategory.BUILD,
    requirements: [{ type: 'unit_flag', value: 'canBuildImprovements', present: true }],
    targetType: ActionTargetType.NONE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.PILLAGE]: {
    id: ActionType.PILLAGE,
    name: 'Pillage',
    description: 'Destroy improvements on this tile',
    hotkey: 'P',
    category: ActionCategory.MILITARY,
    requirements: [{ type: 'unit_flag', value: 'canPillage', present: true }],
    targetType: ActionTargetType.NONE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.TRANSFORM_TERRAIN]: {
    id: ActionType.TRANSFORM_TERRAIN,
    name: 'Transform Terrain',
    description: 'Transform the terrain type (e.g., forest to plains)',
    hotkey: 'O',
    category: ActionCategory.BUILD,
    requirements: [{ type: 'unit_flag', value: 'canBuildImprovements', present: true }],
    targetType: ActionTargetType.NONE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.DISBAND_UNIT]: {
    id: ActionType.DISBAND_UNIT,
    name: 'Disband Unit',
    description: 'Disband this unit',
    hotkey: 'D',
    category: ActionCategory.MANAGEMENT,
    requirements: [],
    targetType: ActionTargetType.SELF,
    consumes_actor: true,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.PATROL]: {
    id: ActionType.PATROL,
    name: 'Patrol',
    description: 'Set up patrol between current position and target',
    hotkey: 'Q',
    category: ActionCategory.MILITARY,
    requirements: [],
    targetType: ActionTargetType.TILE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.ESTABLISH_EMBASSY]: {
    id: ActionType.ESTABLISH_EMBASSY,
    name: 'Establish Embassy',
    description: 'Establish diplomatic relations with target city',
    category: ActionCategory.DIPLOMACY,
    requirements: [{ type: 'unit_type', value: ['diplomat'], present: true }],
    targetType: ActionTargetType.CITY,
    consumes_actor: true,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.INVESTIGATE_CITY]: {
    id: ActionType.INVESTIGATE_CITY,
    name: 'Investigate City',
    description: 'Gather intelligence about target city',
    category: ActionCategory.ESPIONAGE,
    requirements: [{ type: 'unit_type', value: ['diplomat'], present: true }],
    targetType: ActionTargetType.CITY,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.TRADE_ROUTE]: {
    id: ActionType.TRADE_ROUTE,
    name: 'Establish Trade Route',
    description: 'Establish trade route between cities',
    category: ActionCategory.TRADE,
    requirements: [{ type: 'unit_type', value: ['caravan'], present: true }],
    targetType: ActionTargetType.CITY,
    consumes_actor: true,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.AUTO_EXPLORE]: {
    id: ActionType.AUTO_EXPLORE,
    name: 'Auto Explore',
    description: 'Automatically explore unknown areas',
    hotkey: 'X',
    category: ActionCategory.AUTOMATION,
    requirements: [],
    targetType: ActionTargetType.NONE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  // Add placeholder definitions for other actions
  [ActionType.SKIP_TURN]: {
    id: ActionType.SKIP_TURN,
    name: 'Skip Turn',
    description: 'Skip unit turn',
    category: ActionCategory.BASIC,
    requirements: [],
    targetType: ActionTargetType.NONE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  // Simplified definitions for other actions (to be expanded)
  ...Object.fromEntries(
    Object.values(ActionType)
      .filter(
        actionType =>
          ![
            ActionType.MOVE,
            ActionType.ATTACK,
            ActionType.FORTIFY,
            ActionType.SENTRY,
            ActionType.WAIT,
            ActionType.GOTO,
            ActionType.FOUND_CITY,
            ActionType.BUILD_ROAD,
            ActionType.AUTO_EXPLORE,
            ActionType.SKIP_TURN,
          ].includes(actionType)
      )
      .map(actionType => [
        actionType,
        {
          id: actionType,
          name: actionType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          description: `Perform ${actionType.replace(/_/g, ' ').toLowerCase()}`,
          category: ActionCategory.BASIC,
          requirements: [],
          targetType: ActionTargetType.NONE,
          consumes_actor: false,
          moves_actor: ActionMovesActor.STAYS,
        },
      ])
  ),
} as unknown as Record<ActionType, ActionDefinition>;

export class ActionSystem {
  private gameId: string;
  private gameManagerCallback?: {
    foundCity: (
      gameId: string,
      playerId: string,
      name: string,
      x: number,
      y: number
    ) => Promise<string>;
    requestPath: (
      playerId: string,
      unitId: string,
      targetX: number,
      targetY: number
    ) => Promise<{ success: boolean; path?: any; error?: string }>;
  };

  constructor(
    gameId: string,
    gameManagerCallback?: {
      foundCity: (
        gameId: string,
        playerId: string,
        name: string,
        x: number,
        y: number
      ) => Promise<string>;
      requestPath: (
        playerId: string,
        unitId: string,
        targetX: number,
        targetY: number
      ) => Promise<{ success: boolean; path?: any; error?: string }>;
    }
  ) {
    this.gameId = gameId;
    this.gameManagerCallback = gameManagerCallback;
  }

  /**
   * Get action definition by type
   */
  getActionDefinition(actionType: ActionType): ActionDefinition | null {
    return ACTION_DEFINITIONS[actionType] || null;
  }

  /**
   * Check if unit can perform action
   * @reference freeciv/common/actions.c action_prob()
   */
  canUnitPerformAction(
    unit: Unit,
    actionType: ActionType,
    targetX?: number,
    targetY?: number
  ): boolean {
    const actionDef = this.getActionDefinition(actionType);
    if (!actionDef) {
      return false;
    }

    if (!this.checkBasicRequirements(unit, actionDef, targetX, targetY)) {
      return false;
    }

    return this.checkActionSpecificConditions(unit, actionType, targetX, targetY);
  }

  /**
   * Check basic action requirements
   */
  private checkBasicRequirements(
    unit: Unit,
    actionDef: ActionDefinition,
    targetX?: number,
    targetY?: number
  ): boolean {
    for (const req of actionDef.requirements) {
      if (!this.checkRequirement(unit, req, targetX, targetY)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Map of action condition checkers
   */
  private readonly actionConditionCheckers: Map<
    ActionType,
    (unit: Unit, targetX?: number, targetY?: number) => boolean
  > = new Map([
    [ActionType.FORTIFY, unit => this.canFortify(unit)],
    [ActionType.SENTRY, unit => this.canSentry(unit)],
    [ActionType.MOVE, (unit, targetX, targetY) => this.canMove(unit, targetX, targetY)],
    [ActionType.GOTO, (unit, targetX, targetY) => this.canMove(unit, targetX, targetY)],
    [ActionType.FOUND_CITY, unit => this.canFoundCity(unit)],
    [ActionType.BUILD_ROAD, unit => this.canBuildRoad(unit)],
    [ActionType.BUILD_RAILROAD, unit => this.canBuildRailroad(unit)],
    [ActionType.BUILD_IRRIGATION, unit => this.canBuildIrrigation(unit)],
    [ActionType.BUILD_MINE, unit => this.canBuildMine(unit)],
    [ActionType.PILLAGE, unit => this.canPillage(unit)],
    [ActionType.TRANSFORM_TERRAIN, unit => this.canTransformTerrain(unit)],
    [ActionType.DISBAND_UNIT, unit => this.canDisbandUnit(unit)],
    [ActionType.PATROL, (unit, targetX, targetY) => this.canPatrol(unit, targetX, targetY)],
  ]);

  /**
   * Check action-specific conditions
   */
  private checkActionSpecificConditions(
    unit: Unit,
    actionType: ActionType,
    targetX?: number,
    targetY?: number
  ): boolean {
    const checker = this.actionConditionCheckers.get(actionType);
    return checker ? checker(unit, targetX, targetY) : true;
  }

  /**
   * Check if unit can fortify
   */
  private canFortify(unit: Unit): boolean {
    return !unit.fortified && unit.movementLeft > 0;
  }

  /**
   * Check if unit can sentry
   */
  private canSentry(unit: Unit): boolean {
    return unit.movementLeft > 0;
  }

  /**
   * Check if unit can move
   */
  private canMove(unit: Unit, targetX?: number, targetY?: number): boolean {
    const canMove = targetX !== undefined && targetY !== undefined && unit.movementLeft > 0;

    // Add debug logging to help diagnose movement issues
    if (!canMove) {
      logger.debug('Unit movement check failed', {
        unitId: unit.id,
        unitType: unit.unitTypeId,
        targetX,
        targetY,
        movementLeft: unit.movementLeft,
        reason:
          targetX === undefined
            ? 'no targetX'
            : targetY === undefined
              ? 'no targetY'
              : 'no movement left',
      });
    }

    return canMove;
  }

  /**
   * Check if unit can found a city
   */
  private canFoundCity(unit: Unit): boolean {
    const unitType = getUnitType(unit.unitTypeId);

    // Add debug logging for unit type lookup issues
    if (!unitType) {
      logger.warn('Unit type not found during city founding check', {
        unitId: unit.id,
        unitTypeId: unit.unitTypeId,
      });
      return false;
    }

    if (!unitType.canFoundCity || unit.movementLeft <= 0) {
      logger.debug('Unit cannot found city', {
        unitId: unit.id,
        unitType: unit.unitTypeId,
        canFoundCity: unitType.canFoundCity,
        movementLeft: unit.movementLeft,
      });
      return false;
    }

    return this.canFoundCityAtLocation(unit, unit.x, unit.y);
  }

  /**
   * Check if unit can build a road
   * @reference freeciv-web/javascript/unit.js unit activity validation
   */
  private canBuildRoad(unit: Unit): boolean {
    return this.canBuildImprovement(unit) && unit.movementLeft > 0;
  }

  /**
   * Check if unit can build a railroad
   */
  private canBuildRailroad(unit: Unit): boolean {
    return this.canBuildImprovement(unit) && unit.movementLeft > 0;
    // TODO: Check if tile already has road (railroad requires road first)
  }

  /**
   * Check if unit can build irrigation
   * @reference freeciv/server/unittools.c can_unit_do_activity_at()
   */
  private canBuildIrrigation(unit: Unit): boolean {
    if (!this.canBuildImprovement(unit) || unit.movementLeft <= 0) {
      return false;
    }

    // TODO: Check terrain compatibility and water source
    // For now, allow irrigation on grassland, plains, desert
    const validTerrains = ['grassland', 'plains', 'desert'];
    const terrainType = this.getTerrainAt(unit.x, unit.y);
    return validTerrains.includes(terrainType);
  }

  /**
   * Check if unit can build mine
   * @reference freeciv/server/unittools.c can_unit_do_activity_at()
   */
  private canBuildMine(unit: Unit): boolean {
    if (!this.canBuildImprovement(unit) || unit.movementLeft <= 0) {
      return false;
    }

    // TODO: Check terrain compatibility
    // For now, allow mining on hills, mountains, forest
    const validTerrains = ['hills', 'mountains', 'forest'];
    const terrainType = this.getTerrainAt(unit.x, unit.y);
    return validTerrains.includes(terrainType);
  }

  /**
   * Check if unit can pillage
   * @reference freeciv-web/javascript/unit.js get_what_can_unit_pillage_from()
   */
  private canPillage(unit: Unit): boolean {
    if (unit.movementLeft <= 0) {
      return false;
    }

    // TODO: Check if tile has improvements to pillage
    // For now, assume there are always improvements that can be pillaged
    return this.hasPillageableImprovements(unit.x, unit.y);
  }

  /**
   * Get terrain type at coordinates
   */
  private getTerrainAt(_x: number, _y: number): string {
    // TODO: Integrate with MapManager to get actual terrain
    // For now, return a default terrain type
    return 'grassland';
  }

  /**
   * Check if tile has improvements that can be pillaged
   */
  private hasPillageableImprovements(_x: number, _y: number): boolean {
    // TODO: Check with MapManager for tile improvements
    // For now, assume some tiles have improvements
    return Math.random() > 0.5; // 50% chance for testing
  }

  /**
   * Check if unit can transform terrain
   * @reference freeciv/server/unittools.c can_unit_do_activity_at()
   */
  private canTransformTerrain(unit: Unit): boolean {
    if (!this.canBuildImprovement(unit) || unit.movementLeft <= 0) {
      return false;
    }

    // TODO: Check available terrain transformations
    // For now, allow transformation on most terrain types
    const terrainType = this.getTerrainAt(unit.x, unit.y);
    const transformableTerrains = ['forest', 'jungle', 'swamp', 'desert', 'tundra'];
    return transformableTerrains.includes(terrainType);
  }

  /**
   * Check if unit can be disbanded
   */
  private canDisbandUnit(_unit: Unit): boolean {
    return true; // Most units can be disbanded
  }

  /**
   * Check if unit can patrol
   */
  private canPatrol(unit: Unit, targetX?: number, targetY?: number): boolean {
    return targetX !== undefined && targetY !== undefined && unit.movementLeft > 0;
  }

  /**
   * Helper method to check if unit can build improvements
   */
  private canBuildImprovement(unit: Unit): boolean {
    const unitType = getUnitType(unit.unitTypeId);

    if (!unitType) {
      logger.warn('Unit type not found during improvement check', {
        unitId: unit.id,
        unitTypeId: unit.unitTypeId,
      });
      return false;
    }

    return unitType.canBuildImprovements || false;
  }

  /**
   * Get action probability for unit
   */
  getActionProbability(
    unit: Unit,
    actionType: ActionType,
    targetX?: number,
    targetY?: number
  ): ActionProbability {
    if (!this.canUnitPerformAction(unit, actionType, targetX, targetY)) {
      return { min: 0, max: 0 };
    }

    // Most basic actions have 100% success rate
    switch (actionType) {
      case ActionType.FORTIFY:
      case ActionType.SENTRY:
      case ActionType.WAIT:
      case ActionType.GOTO:
      case ActionType.FOUND_CITY:
      case ActionType.BUILD_ROAD:
        return { min: 200, max: 200 }; // 100% in freeciv probability format

      case ActionType.ATTACK:
        // Combat probability would be calculated based on unit strengths
        return { min: 100, max: 150 }; // 50-75% example

      default:
        return { min: 200, max: 200 };
    }
  }

  /**
   * Map of action executors
   */
  private readonly actionExecutors: Map<
    ActionType,
    (unit: Unit, targetX?: number, targetY?: number) => Promise<ActionResult>
  > = new Map([
    [ActionType.FORTIFY, async unit => this.executeFortify(unit)],
    [ActionType.SENTRY, async unit => this.executeSentry(unit)],
    [ActionType.WAIT, async unit => this.executeWait(unit)],
    [ActionType.GOTO, async (unit, targetX, targetY) => this.executeGoto(unit, targetX!, targetY!)],
    [ActionType.FOUND_CITY, async unit => this.executeFoundCity(unit)],
    [ActionType.BUILD_ROAD, async unit => this.executeBuildRoad(unit)],
    [ActionType.BUILD_RAILROAD, async unit => this.executeBuildRailroad(unit)],
    [ActionType.BUILD_IRRIGATION, async unit => this.executeBuildIrrigation(unit)],
    [ActionType.BUILD_MINE, async unit => this.executeBuildMine(unit)],
    [ActionType.PILLAGE, async unit => this.executePillage(unit)],
    [ActionType.TRANSFORM_TERRAIN, async unit => this.executeTransformTerrain(unit)],
    [ActionType.DISBAND_UNIT, async unit => this.executeDisbandUnit(unit)],
    [
      ActionType.PATROL,
      async (unit, targetX, targetY) => this.executePatrol(unit, targetX!, targetY!),
    ],
  ]);

  /**
   * Execute action for unit
   */
  async executeAction(
    unit: Unit,
    actionType: ActionType,
    targetX?: number,
    targetY?: number
  ): Promise<ActionResult> {
    const actionDef = this.getActionDefinition(actionType);
    if (!actionDef) {
      return {
        success: false,
        message: `Unknown action: ${actionType}`,
      };
    }

    if (!this.canUnitPerformAction(unit, actionType, targetX, targetY)) {
      return {
        success: false,
        message: `Unit cannot perform ${actionDef.name}`,
      };
    }

    logger.info(`Executing action ${actionType} for unit ${unit.id}`, {
      unitId: unit.id,
      action: actionType,
      targetX,
      targetY,
    });

    // Execute action-specific logic
    const executor = this.actionExecutors.get(actionType);
    if (executor) {
      return await executor(unit, targetX, targetY);
    }

    return {
      success: false,
      message: `Action ${actionType} not yet implemented`,
    };
  }

  /**
   * Check if a city can be founded at the given location
   */
  private canFoundCityAtLocation(_unit: Unit, _x: number, _y: number): boolean {
    // Basic validation - more detailed checks would require access to MapManager and game state
    // These are the rules that can be checked without external dependencies

    // TODO: Add the following validation rules when we have access to MapManager:
    // 1. Check terrain type (some terrains like ocean cannot have cities)
    // 2. Check minimum distance from other cities (usually 2 tiles in Freeciv)
    // 3. Check if tile is within map bounds
    // 4. Check if tile is owned by another player
    // 5. Check if there are hostile units on the tile

    return true; // Simplified for now
  }

  /**
   * Check if requirement is satisfied
   */
  private checkRequirement(
    unit: Unit,
    requirement: any,
    _targetX?: number,
    _targetY?: number
  ): boolean {
    switch (requirement.type) {
      case 'unit_type': {
        const validTypes = Array.isArray(requirement.value)
          ? requirement.value
          : [requirement.value];
        return requirement.present
          ? validTypes.includes(unit.unitTypeId)
          : !validTypes.includes(unit.unitTypeId);
      }

      case 'unit_flag': {
        // Check unit capabilities from dynamic ruleset data
        const unitType = getUnitType(unit.unitTypeId);
        if (!unitType) {
          logger.warn('Unit type not found during requirement check', {
            unitId: unit.id,
            unitTypeId: unit.unitTypeId,
            requirement: requirement.value,
          });
          return false;
        }

        if (requirement.value === 'canFoundCity') {
          return unitType.canFoundCity;
        }
        if (requirement.value === 'canBuildImprovements') {
          return unitType.canBuildImprovements;
        }
        if (requirement.value === 'canPillage') {
          // Check if unit has military capabilities and is not flagged as NonMil
          return (
            unitType.unitClass === 'military' ||
            (unitType.flags ? !unitType.flags.includes('NonMil') : true)
          );
        }
        return true;
      }

      default:
        return true;
    }
  }

  // Action execution methods
  private async executeFortify(unit: Unit): Promise<ActionResult> {
    // This would be handled by UnitManager
    return {
      success: true,
      message: `${unit.unitTypeId} fortified`,
    };
  }

  private async executeSentry(unit: Unit): Promise<ActionResult> {
    return {
      success: true,
      message: `${unit.unitTypeId} on sentry duty`,
    };
  }

  private async executeWait(unit: Unit): Promise<ActionResult> {
    return {
      success: true,
      message: `${unit.unitTypeId} waiting`,
    };
  }

  /**
   * Execute goto command for a unit - moves unit along pathfinding path
   * Implements freeciv-web style goto with server-side pathfinding
   *
   * @reference freeciv-web/freeciv-web/src/main/webapp/javascript/control.js:do_map_click() - Client goto execution
   * @reference freeciv-web/freeciv/patches/goto_fcweb.patch:handle_web_goto_path_req() - Server goto handling
   * @reference freeciv/server/unithand.c:handle_unit_move_query() - Unit movement validation
   * @compliance Uses pathfinding results and movement cost deduction as per freeciv standards
   */
  private async executeGoto(unit: Unit, targetX: number, targetY: number): Promise<ActionResult> {
    const validation = this.validateGotoInputs(unit, targetX, targetY);
    if (validation) return validation;

    if (!this.gameManagerCallback?.requestPath) {
      return { success: false, message: 'Pathfinding not available' };
    }

    const pathResult = await this.gameManagerCallback.requestPath(
      unit.playerId,
      unit.id,
      targetX,
      targetY
    );

    const validationPath = this.validatePathResult(pathResult, unit, targetX, targetY);
    if (validationPath) return validationPath;

    const { currentX, currentY, remainingMovement, tilesTraversed } = this.traversePath(
      unit,
      pathResult
    );

    if (tilesTraversed === 0) {
      return { success: false, message: 'Insufficient movement points to start moving' };
    }

    const oldX = unit.x;
    const oldY = unit.y;
    const originalMovementLeft = unit.movementLeft;
    const totalMovementCost = originalMovementLeft - remainingMovement;

    // Don't mutate unit object directly - return new state in result for UnitManager to apply

    logger.info('Unit goto executed', {
      gameId: this.gameId,
      unitId: unit.id,
      from: { x: oldX, y: oldY },
      to: { x: currentX, y: currentY },
      targetDestination: { x: targetX, y: targetY },
      tilesTraversed,
      remainingMovement,
    });

    const reachedDestination = currentX === targetX && currentY === targetY;

    // Prepare new orders without mutating unit object
    let newOrders: UnitOrder[] = [];
    if (!reachedDestination) {
      const moveOrder: UnitOrder = {
        type: 'move',
        targetX: targetX,
        targetY: targetY,
      };
      newOrders = [moveOrder];
    }

    return {
      success: true,
      message: reachedDestination
        ? `${unit.unitTypeId} moved to (${targetX}, ${targetY})`
        : `${unit.unitTypeId} moved ${tilesTraversed} tiles toward (${targetX}, ${targetY}). Will continue next turn.`,
      newPosition: { x: currentX, y: currentY },
      newMovementLeft: remainingMovement,
      newOrders: newOrders,
      movementCost: totalMovementCost,
    };
  }

  private async executeFoundCity(unit: Unit): Promise<ActionResult> {
    if (!this.gameManagerCallback) {
      return {
        success: false,
        message: 'City founding not available - game manager callback not set',
      };
    }

    // Validate that the unit can found cities using dynamic ruleset data
    const unitType = getUnitType(unit.unitTypeId);
    if (!unitType || !unitType.canFoundCity) {
      return {
        success: false,
        message: 'This unit cannot found cities',
      };
    }

    // Basic validation - the GameManager will do more detailed checks
    if (unit.movementLeft <= 0) {
      return {
        success: false,
        message: 'Unit has no movement points left',
      };
    }

    // Additional basic checks
    if (!this.canFoundCityAtLocation(unit, unit.x, unit.y)) {
      return {
        success: false,
        message: 'Cannot found city at this location',
      };
    }

    try {
      // Generate a default city name (GameManager could override this)
      const cityName = `New City (${unit.x},${unit.y})`;

      // Call GameManager to actually found the city
      const cityId = await this.gameManagerCallback.foundCity(
        this.gameId,
        unit.playerId,
        cityName,
        unit.x,
        unit.y
      );

      logger.info(`City founded successfully`, {
        cityId,
        unitId: unit.id,
        playerId: unit.playerId,
        position: { x: unit.x, y: unit.y },
      });

      return {
        success: true,
        message: `${unit.unitTypeId} founded ${cityName}`,
        unitDestroyed: true,
        cityId,
      };
    } catch (error: any) {
      logger.error(`Failed to found city`, {
        error: error.message,
        unitId: unit.id,
        playerId: unit.playerId,
        position: { x: unit.x, y: unit.y },
      });

      return {
        success: false,
        message: error.message || 'Failed to found city',
      };
    }
  }

  private validateGotoInputs(unit: Unit, targetX: number, targetY: number): ActionResult | null {
    if (targetX < 0 || targetY < 0 || targetX >= 200 || targetY >= 200) {
      return { success: false, message: 'Invalid target coordinates' };
    }
    if (unit.movementLeft <= 0) {
      return { success: false, message: 'Unit has no movement points left' };
    }
    if (unit.x === targetX && unit.y === targetY) {
      return { success: false, message: 'Unit is already at target position' };
    }
    return null;
  }

  private validatePathResult(
    pathResult: any,
    unit: Unit,
    targetX: number,
    targetY: number
  ): ActionResult | null {
    if (
      !pathResult ||
      !pathResult.success ||
      !pathResult.path ||
      !pathResult.path.tiles ||
      pathResult.path.tiles.length < 2
    ) {
      logger.warn('Pathfinding failed for unit movement', {
        unitId: unit.id,
        from: { x: unit.x, y: unit.y },
        to: { x: targetX, y: targetY },
        error: pathResult?.error,
      });
      return { success: false, message: pathResult?.error || 'No valid path to target' };
    }
    return null;
  }

  private traversePath(
    unit: Unit,
    pathResult: any
  ): { currentX: number; currentY: number; remainingMovement: number; tilesTraversed: number } {
    let currentX = unit.x;
    let currentY = unit.y;
    let remainingMovement = unit.movementLeft;
    let tilesTraversed = 0;

    logger.debug('Starting path traversal', {
      unitId: unit.id,
      startPosition: { x: currentX, y: currentY },
      initialMovement: remainingMovement,
      pathLength: pathResult.path?.tiles?.length || 0,
    });

    if (!pathResult.path?.tiles || pathResult.path.tiles.length <= 1) {
      logger.warn('Invalid path result in traversePath', {
        unitId: unit.id,
        pathResult: pathResult,
      });
      return { currentX, currentY, remainingMovement, tilesTraversed };
    }

    for (let i = 1; i < pathResult.path.tiles.length; i++) {
      const nextTile = pathResult.path.tiles[i];
      const dx = Math.abs(nextTile.x - currentX);
      const dy = Math.abs(nextTile.y - currentY);
      const movementCost = dx === 1 && dy === 1 ? Math.floor(SINGLE_MOVE * 1.5) : SINGLE_MOVE;

      logger.debug('Processing path tile', {
        unitId: unit.id,
        tileIndex: i,
        from: { x: currentX, y: currentY },
        to: { x: nextTile.x, y: nextTile.y },
        movementCost,
        remainingMovement,
      });

      if (remainingMovement < movementCost) {
        logger.debug('Insufficient movement for next tile, stopping', {
          unitId: unit.id,
          needed: movementCost,
          remaining: remainingMovement,
        });
        break;
      }
      currentX = nextTile.x;
      currentY = nextTile.y;
      remainingMovement -= movementCost;
      tilesTraversed++;
    }

    logger.debug('Path traversal complete', {
      unitId: unit.id,
      finalPosition: { x: currentX, y: currentY },
      remainingMovement,
      tilesTraversed,
    });

    return { currentX, currentY, remainingMovement, tilesTraversed };
  }

  private async executeBuildRoad(unit: Unit): Promise<ActionResult> {
    // TODO: Integrate with MapManager to actually add road to tile
    return {
      success: true,
      message: `${unit.unitTypeId} started building road`,
    };
  }

  private async executeBuildRailroad(unit: Unit): Promise<ActionResult> {
    // TODO: Check for existing road, integrate with MapManager
    return {
      success: true,
      message: `${unit.unitTypeId} started building railroad`,
    };
  }

  private async executeBuildIrrigation(unit: Unit): Promise<ActionResult> {
    const terrainType = this.getTerrainAt(unit.x, unit.y);

    // Validate terrain type
    if (!this.canBuildIrrigation(unit)) {
      return {
        success: false,
        message: `Cannot irrigate ${terrainType} terrain`,
      };
    }

    // TODO: Integrate with MapManager to add irrigation improvement
    return {
      success: true,
      message: `${unit.unitTypeId} started irrigation on ${terrainType}`,
    };
  }

  private async executeBuildMine(unit: Unit): Promise<ActionResult> {
    const terrainType = this.getTerrainAt(unit.x, unit.y);

    // Validate terrain type
    if (!this.canBuildMine(unit)) {
      return {
        success: false,
        message: `Cannot build mine on ${terrainType} terrain`,
      };
    }

    // TODO: Integrate with MapManager to add mine improvement
    return {
      success: true,
      message: `${unit.unitTypeId} started building mine on ${terrainType}`,
    };
  }

  private async executePillage(unit: Unit): Promise<ActionResult> {
    if (!this.hasPillageableImprovements(unit.x, unit.y)) {
      return {
        success: false,
        message: 'No improvements to pillage on this tile',
      };
    }

    const improvementTypes = this.getPillageableImprovements(unit.x, unit.y);
    const targetImprovement = improvementTypes[0]; // Pillage first available

    // TODO: Integrate with MapManager to remove improvement
    return {
      success: true,
      message: `${unit.unitTypeId} pillaged ${targetImprovement}`,
    };
  }

  /**
   * Get list of improvements that can be pillaged on a tile
   */
  private getPillageableImprovements(_x: number, _y: number): string[] {
    // TODO: Get from MapManager
    // For now, return mock improvements
    const mockImprovements = ['road', 'irrigation', 'mine', 'railroad'];
    return mockImprovements.filter(() => Math.random() > 0.7); // Random subset
  }

  private async executeTransformTerrain(unit: Unit): Promise<ActionResult> {
    const currentTerrain = this.getTerrainAt(unit.x, unit.y);
    const targetTerrain = this.getTransformationTarget(currentTerrain);

    if (!targetTerrain) {
      return {
        success: false,
        message: `Cannot transform ${currentTerrain} terrain`,
      };
    }

    // TODO: Integrate with MapManager to transform terrain
    return {
      success: true,
      message: `${unit.unitTypeId} started transforming ${currentTerrain} to ${targetTerrain}`,
    };
  }

  /**
   * Get terrain transformation target
   * @reference freeciv/common/terrain.h terrain transformations
   */
  private getTransformationTarget(currentTerrain: string): string | null {
    const transformations: Record<string, string> = {
      forest: 'grassland',
      jungle: 'grassland',
      swamp: 'grassland',
      desert: 'grassland',
      tundra: 'grassland',
      hills: 'grassland',
    };

    return transformations[currentTerrain] || null;
  }

  private async executeDisbandUnit(unit: Unit): Promise<ActionResult> {
    return {
      success: true,
      message: `${unit.unitTypeId} disbanded`,
      unitDestroyed: true,
    };
  }

  private async executePatrol(unit: Unit, targetX: number, targetY: number): Promise<ActionResult> {
    // TODO: Set up patrol orders between current position and target
    return {
      success: true,
      message: `${unit.unitTypeId} started patrolling to (${targetX}, ${targetY})`,
    };
  }
}
