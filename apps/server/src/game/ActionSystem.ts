import { logger } from '../utils/logger';
import {
  ActionType,
  ActionDefinition,
  ActionResult,
  ActionProbability,
  ActionCategory,
  ActionTargetType,
  ActionMovesActor,
} from '../types/shared/actions';
import { Unit } from './UnitManager';

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
    requirements: [{ type: 'unit_type', value: ['warrior', 'archer', 'spearman'], present: true }],
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
    requirements: [{ type: 'unit_type', value: ['warrior', 'archer', 'spearman'], present: true }],
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

  constructor(gameId: string) {
    this.gameId = gameId;
    // Store gameId for future game state validation
    void this.gameId; // Explicitly mark as stored for future use
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

    // Check basic requirements
    for (const req of actionDef.requirements) {
      if (!this.checkRequirement(unit, req, targetX, targetY)) {
        return false;
      }
    }

    // Check action-specific conditions
    switch (actionType) {
      case ActionType.FORTIFY:
        // Can only fortify if not already fortified and has movement
        return !unit.fortified && unit.movementLeft > 0;

      case ActionType.SENTRY:
        // Can sentry if has movement
        return unit.movementLeft > 0;

      case ActionType.MOVE:
      case ActionType.GOTO:
        // Need target coordinates and movement points
        return targetX !== undefined && targetY !== undefined && unit.movementLeft > 0;

      case ActionType.FOUND_CITY:
        // Check if settler and valid location
        return unit.unitTypeId === 'settler';

      case ActionType.BUILD_ROAD:
        // Check if worker
        return unit.unitTypeId === 'worker';

      default:
        return true;
    }
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
    switch (actionType) {
      case ActionType.FORTIFY:
        return await this.executeFortify(unit);

      case ActionType.SENTRY:
        return await this.executeSentry(unit);

      case ActionType.WAIT:
        return await this.executeWait(unit);

      case ActionType.GOTO:
        return await this.executeGoto(unit, targetX!, targetY!);

      case ActionType.FOUND_CITY:
        return await this.executeFoundCity(unit);

      case ActionType.BUILD_ROAD:
        return await this.executeBuildRoad(unit);

      default:
        return {
          success: false,
          message: `Action ${actionType} not yet implemented`,
        };
    }
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

      case 'unit_flag':
        // This would check unit capabilities from ruleset data
        // For now, simplified check based on unit type
        if (requirement.value === 'canFoundCity') {
          return unit.unitTypeId === 'settler';
        }
        if (requirement.value === 'canBuildImprovements') {
          return unit.unitTypeId === 'worker';
        }
        return true;

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

  private async executeGoto(unit: Unit, targetX: number, targetY: number): Promise<ActionResult> {
    return {
      success: true,
      message: `${unit.unitTypeId} moving to (${targetX}, ${targetY})`,
      newPosition: { x: targetX, y: targetY },
    };
  }

  private async executeFoundCity(unit: Unit): Promise<ActionResult> {
    return {
      success: true,
      message: `${unit.unitTypeId} founded city`,
      unitDestroyed: true,
    };
  }

  private async executeBuildRoad(unit: Unit): Promise<ActionResult> {
    return {
      success: true,
      message: `${unit.unitTypeId} building road`,
    };
  }
}
