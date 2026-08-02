/**
 * @module server/game/systems/ActionSystem
 * Implements the Action System game system.
 */
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
import type { Unit } from '@game/units/UnitTypes';
import { SINGLE_MOVE } from '@game/constants/MovementConstants';
import { type UnitType, rulesetUnitsService } from '@game/services/RulesetUnitsService';
import type { MapManager } from '@game/managers/MapManager';
import type { MapTile, TerrainType } from '@game/map/MapTypes';
import { hasClassicIrrigationSource } from '@game/rules/ClassicIrrigationRules';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { DEFAULT_RULESET } from '@shared/data/rulesets/defaultRuleset';
import { getUniqueCityName } from '@game/constants/CityNames';

type PathResult = { success: boolean; path?: any; error?: string };

// Action definitions based on freeciv classic ruleset
// @reference freeciv/common/actions.c
const ACTION_DEFINITIONS: Partial<Record<ActionType, ActionDefinition>> = {
  [ActionType.FORTIFY]: {
    id: ActionType.FORTIFY,
    name: 'Fortify',
    description: 'Fortify unit for defensive bonus',
    hotkey: 'F',
    category: ActionCategory.BASIC,
    requirements: [],
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

  [ActionType.PATROL]: {
    id: ActionType.PATROL,
    name: 'Patrol',
    description: 'Patrol repeatedly between the current tile and a target tile',
    hotkey: 'P',
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

  [ActionType.CULTIVATE]: {
    id: ActionType.CULTIVATE,
    name: 'Cultivate',
    description: 'Cultivate this tile into its ruleset terrain result',
    category: ActionCategory.BUILD,
    requirements: [{ type: 'unit_flag', value: 'canBuildImprovements', present: true }],
    targetType: ActionTargetType.NONE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.PLANT]: {
    id: ActionType.PLANT,
    name: 'Plant',
    description: 'Plant this tile into its ruleset terrain result',
    category: ActionCategory.BUILD,
    requirements: [{ type: 'unit_flag', value: 'canBuildImprovements', present: true }],
    targetType: ActionTargetType.NONE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.BUILD_FORTRESS]: {
    id: ActionType.BUILD_FORTRESS,
    name: 'Build Fortress',
    description: 'Build a fortress on this tile',
    category: ActionCategory.BUILD,
    requirements: [{ type: 'unit_flag', value: 'canBuildImprovements', present: true }],
    targetType: ActionTargetType.NONE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.BUILD_AIRBASE]: {
    id: ActionType.BUILD_AIRBASE,
    name: 'Build Airbase',
    description: 'Build an airbase on this tile',
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

  [ActionType.CLEAN_POLLUTION]: {
    id: ActionType.CLEAN_POLLUTION,
    name: 'Clean Pollution',
    description: 'Remove pollution from this tile',
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

  [ActionType.DISBAND_UNIT_RECOVER]: {
    id: ActionType.DISBAND_UNIT_RECOVER,
    name: 'Disband and Recover',
    description: 'Disband this unit and add its shields to city production',
    category: ActionCategory.MANAGEMENT,
    requirements: [],
    targetType: ActionTargetType.CITY,
    consumes_actor: true,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.JOIN_CITY]: {
    id: ActionType.JOIN_CITY,
    name: 'Join City',
    description: 'Add this unit population to a friendly city',
    category: ActionCategory.BUILD,
    requirements: [],
    targetType: ActionTargetType.CITY,
    consumes_actor: true,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.CHANGE_HOME_CITY]: {
    id: ActionType.CHANGE_HOME_CITY,
    name: 'Change Home City',
    description: 'Reassign support to the friendly city under this unit',
    category: ActionCategory.MANAGEMENT,
    requirements: [],
    targetType: ActionTargetType.CITY,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.UPGRADE_UNIT]: {
    id: ActionType.UPGRADE_UNIT,
    name: 'Upgrade Unit',
    description: 'Upgrade this unit through its ruleset obsolescence chain',
    category: ActionCategory.MANAGEMENT,
    requirements: [],
    targetType: ActionTargetType.SELF,
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

  [ActionType.MARKETPLACE]: {
    id: ActionType.MARKETPLACE,
    name: 'Enter Marketplace',
    description: 'Sell caravan goods for a one-time gold payment',
    category: ActionCategory.TRADE,
    requirements: [],
    targetType: ActionTargetType.CITY,
    consumes_actor: true,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.HELP_WONDER]: {
    id: ActionType.HELP_WONDER,
    name: 'Help Wonder',
    description: 'Contribute this unit shield value to a Great Wonder',
    category: ActionCategory.TRADE,
    requirements: [],
    targetType: ActionTargetType.CITY,
    consumes_actor: true,
    moves_actor: ActionMovesActor.STAYS,
  },

  [ActionType.LOAD_UNIT]: {
    id: ActionType.LOAD_UNIT,
    name: 'Load Unit',
    description: 'Load this unit onto a compatible transport',
    category: ActionCategory.TRANSPORT,
    requirements: [],
    targetType: ActionTargetType.UNIT,
    consumes_actor: false,
    moves_actor: ActionMovesActor.MOVES_TO_TARGET,
  },

  [ActionType.UNLOAD_UNIT]: {
    id: ActionType.UNLOAD_UNIT,
    name: 'Unload Unit',
    description: 'Unload this unit from its transport',
    category: ActionCategory.TRANSPORT,
    requirements: [],
    targetType: ActionTargetType.TILE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.MOVES_TO_TARGET,
  },

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
  [ActionType.PARADROP]: {
    id: ActionType.PARADROP,
    name: 'Paradrop',
    description: 'Paradrop from a friendly city or airbase',
    category: ActionCategory.MOVEMENT,
    requirements: [{ type: 'unit_flag', value: 'Paratroopers', present: true }],
    targetType: ActionTargetType.TILE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.TELEPORT,
  },
  [ActionType.BOMBARD]: {
    id: ActionType.BOMBARD,
    name: 'Bombard',
    description: 'Bombard enemy units on a target tile',
    category: ActionCategory.MILITARY,
    requirements: [],
    targetType: ActionTargetType.TILE,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },
  [ActionType.NUCLEAR_EXPLOSION]: {
    id: ActionType.NUCLEAR_EXPLOSION,
    name: 'Nuclear Explosion',
    description: 'Detonate a nuclear unit on a target tile',
    category: ActionCategory.MILITARY,
    requirements: [{ type: 'unit_flag', value: 'Nuclear', present: true }],
    targetType: ActionTargetType.TILE,
    consumes_actor: true,
    moves_actor: ActionMovesActor.STAYS,
  },
  [ActionType.COLLECT_RANSOM]: {
    id: ActionType.COLLECT_RANSOM,
    name: 'Collect Ransom',
    description: 'Capture a barbarian stack and collect its ransom',
    category: ActionCategory.MILITARY,
    requirements: [],
    targetType: ActionTargetType.UNIT,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },
  [ActionType.SUICIDE_ATTACK]: {
    id: ActionType.SUICIDE_ATTACK,
    name: 'Suicide Attack',
    description: 'Attack with a missile that is consumed after combat',
    category: ActionCategory.MILITARY,
    requirements: [],
    targetType: ActionTargetType.UNIT,
    consumes_actor: true,
    moves_actor: ActionMovesActor.STAYS,
  },
  [ActionType.AIRLIFT]: {
    id: ActionType.AIRLIFT,
    name: 'Airlift',
    description: 'Airlift between friendly airport cities',
    category: ActionCategory.TRANSPORT,
    requirements: [],
    targetType: ActionTargetType.CITY,
    consumes_actor: false,
    moves_actor: ActionMovesActor.TELEPORT,
  },
  [ActionType.AUTO_EXPLORE]: {
    id: ActionType.AUTO_EXPLORE,
    name: 'Auto Explore',
    description: 'Automatically explore unknown tiles',
    category: ActionCategory.AUTOMATION,
    requirements: [],
    targetType: ActionTargetType.SELF,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },
  [ActionType.AUTO_SETTLER]: {
    id: ActionType.AUTO_SETTLER,
    name: 'Auto Settler',
    description: 'Automatically improve terrain and explore',
    category: ActionCategory.AUTOMATION,
    requirements: [{ type: 'unit_flag', value: 'canBuildImprovements', present: true }],
    targetType: ActionTargetType.SELF,
    consumes_actor: false,
    moves_actor: ActionMovesActor.STAYS,
  },
};

export class ActionSystem {
  private gameId: string;
  private gameManagerCallback?: {
    foundCity: (
      gameId: string,
      playerId: string,
      name: string,
      x: number,
      y: number,
      unitId?: string
    ) => Promise<string>;
    canFoundCityAt?: (x: number, y: number, playerId: string) => boolean;
    requestPath: (
      playerId: string,
      unitId: string,
      targetX: number,
      targetY: number
    ) => Promise<{ success: boolean; path?: any; error?: string }>;
    establishTradeRoute?: (
      playerId: string,
      homeCityId: string,
      targetX: number,
      targetY: number
    ) => Promise<boolean>;
    getCityAt?: (x: number, y: number) => { id: string; playerId: string } | null;
    getCityNames?: () => string[];
    getPlayerNation?: (playerId: string) => string | undefined;
  };

  constructor(
    gameId: string,
    gameManagerCallback?: {
      foundCity: (
        gameId: string,
        playerId: string,
        name: string,
        x: number,
        y: number,
        unitId?: string
      ) => Promise<string>;
      canFoundCityAt?: (x: number, y: number, playerId: string) => boolean;
      requestPath: (
        playerId: string,
        unitId: string,
        targetX: number,
        targetY: number
      ) => Promise<{ success: boolean; path?: any; error?: string }>;
      establishTradeRoute?: (
        playerId: string,
        homeCityId: string,
        targetX: number,
        targetY: number
      ) => Promise<boolean>;
      getCityAt?: (x: number, y: number) => { id: string; playerId: string } | null;
      getCityNames?: () => string[];
      getPlayerNation?: (playerId: string) => string | undefined;
    },
    private readonly mapManager?: Pick<MapManager, 'getTile' | 'getTopology'>,
    private readonly rulesetName: string = DEFAULT_RULESET,
    private readonly unitTypes: Record<string, UnitType> = rulesetUnitsService.getUnitTypes(
      rulesetName
    )
  ) {
    this.gameId = gameId;
    this.gameManagerCallback = gameManagerCallback;
  }

  private getTerrain(terrainType: TerrainType) {
    return rulesetLoader.getTerrain(terrainType, this.rulesetName);
  }

  /**
   * Get action definition by type
   */
  getActionDefinition(actionType: ActionType): ActionDefinition | null {
    // @reference reference/freeciv/data/classic/actions.ruleset
    // Do not expose generated placeholder actions. An action becomes available
    // only when its rules and authoritative execution have been ported.
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
    [ActionType.GOTO, (unit, targetX, targetY) => this.canMove(unit, targetX, targetY)],
    [ActionType.FOUND_CITY, unit => this.canFoundCity(unit)],
    [ActionType.BUILD_ROAD, unit => this.canBuildRoad(unit)],
    [ActionType.BUILD_RAILROAD, unit => this.canBuildRailroad(unit)],
    [ActionType.BUILD_IRRIGATION, unit => this.canBuildIrrigation(unit)],
    [ActionType.BUILD_MINE, unit => this.canBuildMine(unit)],
    [ActionType.CULTIVATE, unit => this.canCultivate(unit)],
    [ActionType.PLANT, unit => this.canPlant(unit)],
    [ActionType.BUILD_FORTRESS, unit => this.canBuildBase(unit, 'Fortress')],
    [ActionType.BUILD_AIRBASE, unit => this.canBuildBase(unit, 'Airbase')],
    [ActionType.PILLAGE, unit => this.canPillage(unit)],
    [ActionType.TRANSFORM_TERRAIN, unit => this.canTransformTerrain(unit)],
    [ActionType.CLEAN_POLLUTION, unit => this.canCleanPollution(unit)],
    [
      ActionType.TRADE_ROUTE,
      (unit, targetX, targetY) =>
        Boolean(
          unit.homeCityId &&
          targetX !== undefined &&
          targetY !== undefined &&
          unit.x === targetX &&
          unit.y === targetY &&
          this.gameManagerCallback?.getCityAt?.(targetX, targetY) &&
          this.gameManagerCallback?.establishTradeRoute
        ),
    ],
    [ActionType.DISBAND_UNIT, unit => this.canDisbandUnit(unit)],
    [ActionType.SKIP_TURN, unit => unit.movementLeft > 0],
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
    const unitType = this.unitTypes[unit.unitTypeId];
    return Boolean(
      unitType?.rulesetUnitClassFlags.includes('CanFortify') &&
      !unitType.flags?.includes('Cant_Fortify') &&
      !unit.fortified &&
      unit.movementLeft > 0
    );
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
    if (targetX === undefined || targetY === undefined || unit.movementLeft <= 0) {
      this.logMovementFailure(unit, targetX, targetY);
      return false;
    }
    const vector = this.mapManager
      ?.getTopology?.()
      .distanceVector(unit.x, unit.y, targetX, targetY);
    const dx = Math.abs(vector?.dx ?? targetX - unit.x);
    const dy = Math.abs(vector?.dy ?? targetY - unit.y);
    return this.canMoveByVector(unit, targetX, targetY, dx, dy);
  }

  private logMovementFailure(unit: Unit, targetX?: number, targetY?: number): void {
    logger.debug('Unit movement check failed', {
      unitId: unit.id,
      unitType: unit.unitTypeId,
      targetX,
      targetY,
      movementLeft: unit.movementLeft,
    });
  }

  private canMoveByVector(
    unit: Unit,
    targetX: number,
    targetY: number,
    dx: number,
    dy: number
  ): boolean {
    const diagonal = dx === 1 && dy === 1;
    const adjacent = (dx === 0 && dy === 1) || (dx === 1 && dy === 0) || diagonal;
    if (!adjacent) return true;
    const required = diagonal ? Math.floor(SINGLE_MOVE * 1.5) : SINGLE_MOVE;
    if (unit.movementLeft < required)
      logger.debug('Unit can move using minimum move rule', {
        unitId: unit.id,
        unitType: unit.unitTypeId,
        from: { x: unit.x, y: unit.y },
        to: { x: targetX, y: targetY },
        isDiagonal: diagonal,
        required,
        available: unit.movementLeft,
      });
    return unit.movementLeft > 0;
  }

  /**
   * Check if unit can found a city
   */
  private canFoundCity(unit: Unit): boolean {
    const unitType = this.unitTypes[unit.unitTypeId];

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
    const tile = this.mapManager?.getTile(unit.x, unit.y);
    const terrain = tile && this.getTerrain(tile.terrain);
    return Boolean(
      this.canBuildImprovement(unit) &&
      unit.movementLeft > 0 &&
      tile &&
      terrain &&
      terrain.roadTime > 0 &&
      !tile.hasRoad
    );
  }

  /**
   * Check if unit can build a railroad
   */
  private canBuildRailroad(unit: Unit): boolean {
    const tile = this.mapManager?.getTile(unit.x, unit.y);
    return Boolean(
      this.canBuildImprovement(unit) && unit.movementLeft > 0 && tile?.hasRoad && !tile.hasRailroad
    );
  }

  /**
   * Check if unit can build irrigation
   * @reference freeciv/server/unittools.c can_unit_do_activity_at()
   */
  private canBuildIrrigation(unit: Unit): boolean {
    if (!this.canBuildImprovement(unit) || unit.movementLeft <= 0) {
      return false;
    }

    const tile = this.mapManager?.getTile(unit.x, unit.y);
    const terrain = tile && this.getTerrain(tile.terrain);
    const cardinalNeighbors = this.getCardinalNeighborTiles(unit);
    return Boolean(
      tile &&
      terrain &&
      terrain.irrigationTime > 0 &&
      !tile.improvements.includes('irrigation') &&
      hasClassicIrrigationSource(cardinalNeighbors)
    );
  }

  private getCardinalNeighborTiles(unit: Unit): MapTile[] {
    const topology = this.mapManager?.getTopology?.();
    if (!topology) return [];
    return topology
      .getCardinalNeighbors(unit.x, unit.y)
      .map(({ x, y }: { x: number; y: number }) => this.mapManager?.getTile(x, y))
      .filter((neighbor: MapTile | null | undefined): neighbor is MapTile => Boolean(neighbor));
  }

  /**
   * Check if unit can build mine
   * @reference freeciv/server/unittools.c can_unit_do_activity_at()
   */
  private canBuildMine(unit: Unit): boolean {
    if (!this.canBuildImprovement(unit) || unit.movementLeft <= 0) {
      return false;
    }

    const tile = this.mapManager?.getTile(unit.x, unit.y);
    const terrain = tile && this.getTerrain(tile.terrain);
    return Boolean(
      tile && terrain && terrain.miningTime > 0 && !tile.improvements.includes('mine')
    );
  }

  private canCultivate(unit: Unit): boolean {
    const tile = this.mapManager?.getTile(unit.x, unit.y);
    const terrain = tile && this.getTerrain(tile.terrain);
    return Boolean(
      this.canBuildImprovement(unit) &&
      unit.movementLeft > 0 &&
      terrain?.cultivateTo &&
      terrain.cultivateTime > 0
    );
  }

  private canPlant(unit: Unit): boolean {
    const tile = this.mapManager?.getTile(unit.x, unit.y);
    const terrain = tile && this.getTerrain(tile.terrain);
    return Boolean(
      this.canBuildImprovement(unit) &&
      unit.movementLeft > 0 &&
      terrain?.plantTo &&
      terrain.plantTime > 0
    );
  }

  private canBuildBase(unit: Unit, extraName: 'Fortress' | 'Airbase'): boolean {
    const tile = this.mapManager?.getTile(unit.x, unit.y);
    const unitType = this.unitTypes[unit.unitTypeId];
    if (!tile || !unitType) return false;
    if (!this.canBuildBaseOnTile(unit, tile, extraName)) return false;
    if (extraName === 'Airbase' && !unitType.flags?.includes('Airbase')) return false;
    return true;
  }

  private canBuildBaseOnTile(unit: Unit, tile: any, extraName: string): boolean {
    if (!this.canBuildImprovement(unit) || unit.movementLeft <= 0) return false;
    if (tile.improvements.some((extra: string) => extra.toLowerCase() === extraName.toLowerCase()))
      return false;
    if (this.gameManagerCallback?.getCityAt?.(unit.x, unit.y)) return false;
    return !['ocean', 'deep_ocean', 'coast', 'lake'].includes(tile.terrain);
  }

  /**
   * Check if unit can pillage
   * @reference freeciv-web/javascript/unit.js get_what_can_unit_pillage_from()
   */
  private canPillage(unit: Unit): boolean {
    if (unit.movementLeft <= 0) {
      return false;
    }

    return this.hasPillageableImprovements(unit.x, unit.y);
  }

  /**
   * Get terrain type at coordinates
   */
  private getTerrainAt(x: number, y: number): string {
    return this.mapManager?.getTile(x, y)?.terrain ?? 'unknown';
  }

  /**
   * Check if tile has improvements that can be pillaged
   */
  private hasPillageableImprovements(x: number, y: number): boolean {
    return this.getPillageableImprovements(x, y).length > 0;
  }

  /**
   * Check if unit can transform terrain
   * @reference freeciv/server/unittools.c can_unit_do_activity_at()
   */
  private canTransformTerrain(unit: Unit): boolean {
    if (!this.canBuildImprovement(unit) || unit.movementLeft <= 0) {
      return false;
    }

    const tile = this.mapManager?.getTile(unit.x, unit.y);
    return Boolean(tile && this.getTerrain(tile.terrain).transformTo);
  }

  private canCleanPollution(unit: Unit): boolean {
    const improvements = this.mapManager?.getTile(unit.x, unit.y)?.improvements ?? [];
    return (
      this.canBuildImprovement(unit) &&
      unit.movementLeft > 0 &&
      improvements.some(extra => ['pollution', 'fallout'].includes(extra.toLowerCase()))
    );
  }

  /**
   * Check if unit can be disbanded
   */
  private canDisbandUnit(_unit: Unit): boolean {
    return true; // Most units can be disbanded
  }

  /**
   * Helper method to check if unit can build improvements
   */
  private canBuildImprovement(unit: Unit): boolean {
    const unitType = this.unitTypes[unit.unitTypeId];

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
    [ActionType.SKIP_TURN, async unit => this.executeSkipTurn(unit)],
    [ActionType.GOTO, async (unit, targetX, targetY) => this.executeGoto(unit, targetX!, targetY!)],
    [ActionType.FOUND_CITY, async unit => this.executeFoundCity(unit)],
    [ActionType.BUILD_ROAD, async unit => this.executeBuildRoad(unit)],
    [ActionType.BUILD_RAILROAD, async unit => this.executeBuildRailroad(unit)],
    [ActionType.BUILD_IRRIGATION, async unit => this.executeBuildIrrigation(unit)],
    [ActionType.BUILD_MINE, async unit => this.executeBuildMine(unit)],
    [ActionType.CULTIVATE, async unit => this.executeWorkerActivity(unit, 'cultivating')],
    [ActionType.PLANT, async unit => this.executeWorkerActivity(unit, 'planting')],
    [ActionType.BUILD_FORTRESS, async unit => this.executeWorkerActivity(unit, 'fortress')],
    [ActionType.BUILD_AIRBASE, async unit => this.executeWorkerActivity(unit, 'airbase')],
    [ActionType.PILLAGE, async unit => this.executePillage(unit)],
    [ActionType.TRANSFORM_TERRAIN, async unit => this.executeTransformTerrain(unit)],
    [ActionType.CLEAN_POLLUTION, async unit => this.executeCleanPollution(unit)],
    [
      ActionType.TRADE_ROUTE,
      async (unit, targetX, targetY) =>
        this.executeTradeRoute(unit, targetX as number, targetY as number),
    ],
    [ActionType.DISBAND_UNIT, async unit => this.executeDisbandUnit(unit)],
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
  private canFoundCityAtLocation(unit: Unit, x: number, y: number): boolean {
    // Freeciv checks the tile-level city_can_be_built_here() predicate before
    // dispatching ACTION_FOUND_CITY. The callback is authoritative and the
    // unit-specific checks remain in this action system.
    return this.gameManagerCallback?.canFoundCityAt?.(x, y, unit.playerId) ?? true;
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
        return this.checkUnitFlagRequirement(unit, requirement.value);
      }

      default:
        return true;
    }
  }

  private checkUnitFlagRequirement(unit: Unit, flag: string): boolean {
    const unitType = this.unitTypes[unit.unitTypeId];
    if (!unitType) {
      logger.warn('Unit type not found during requirement check', {
        unitId: unit.id,
        unitTypeId: unit.unitTypeId,
        requirement: flag,
      });
      return false;
    }
    const flags: Record<string, boolean> = {
      canFoundCity: Boolean(unitType.canFoundCity),
      canBuildImprovements: Boolean(unitType.canBuildImprovements),
      canPillage: unitType.unitClass === 'military' || !unitType.flags?.includes('NonMil'),
    };
    return flags[flag] ?? true;
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

    if (tilesTraversed === 0) return this.noTraversalResult(unit, pathResult);

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

    return this.buildGotoResult(
      unit,
      targetX,
      targetY,
      currentX,
      currentY,
      remainingMovement,
      tilesTraversed,
      totalMovementCost
    );
  }

  private noTraversalResult(unit: Unit, pathResult: PathResult): ActionResult {
    const unitType = this.unitTypes[unit.unitTypeId];
    logger.warn('Unit cannot traverse any tiles', {
      unitId: unit.id,
      unitType: unit.unitTypeId,
      currentMovement: unit.movementLeft,
      expectedMaxMovement: unitType ? unitType.movement * 3 : 'unknown',
      pathLength: pathResult.path?.tiles?.length || 0,
      singleMoveCost: SINGLE_MOVE,
      diagonalMoveCost: Math.floor(SINGLE_MOVE * 1.5),
      unitTypeFound: !!unitType,
    });
    return {
      success: false,
      message:
        unit.movementLeft <= 0 ? 'Unit has no movement points left' : 'Cannot move to target tile',
    };
  }

  private buildGotoResult(
    unit: Unit,
    targetX: number,
    targetY: number,
    currentX: number,
    currentY: number,
    remainingMovement: number,
    tilesTraversed: number,
    movementCost: number
  ): ActionResult {
    const reachedDestination = currentX === targetX && currentY === targetY;
    const newOrders = reachedDestination ? [] : [{ type: 'move' as const, targetX, targetY }];
    return {
      success: true,
      message: reachedDestination
        ? `${unit.unitTypeId} moved to (${targetX}, ${targetY})`
        : `${unit.unitTypeId} moved ${tilesTraversed} tiles toward (${targetX}, ${targetY}). Will continue next turn.`,
      newPosition: { x: currentX, y: currentY },
      newMovementLeft: remainingMovement,
      newOrders,
      movementCost,
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
    const unitType = this.unitTypes[unit.unitTypeId];
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
      const cityName = this.generateCityName(unit.playerId);

      // Call GameManager to actually found the city
      const cityId = await this.gameManagerCallback.foundCity(
        this.gameId,
        unit.playerId,
        cityName,
        unit.x,
        unit.y,
        unit.id
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

  // eslint-disable-next-line complexity
  private generateCityName(playerId: string): string {
    const usedNames = this.gameManagerCallback?.getCityNames?.() ?? [];
    const nationId = this.gameManagerCallback?.getPlayerNation?.(playerId);
    if (nationId) {
      try {
        const nation = rulesetLoader.getNation(nationId, this.rulesetName);
        for (const suggestedName of nation.cities ?? []) {
          const cityName = suggestedName.split(' (')[0]?.trim();
          if (
            cityName &&
            !usedNames.some(name => name.trim().toLowerCase() === cityName.toLowerCase())
          ) {
            return cityName;
          }
        }
      } catch {
        // Fall back to the generic pool for custom or missing nations.
      }
    }
    return getUniqueCityName(usedNames);
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

    const state = { currentX, currentY, remainingMovement, tilesTraversed };
    for (let i = 1; i < pathResult.path.tiles.length; i++) {
      if (!this.advancePathTile(unit, pathResult.path.tiles[i], i, state)) break;
    }
    ({ currentX, currentY, remainingMovement, tilesTraversed } = state);

    logger.debug('Path traversal complete', {
      unitId: unit.id,
      finalPosition: { x: currentX, y: currentY },
      remainingMovement,
      tilesTraversed,
    });

    return { currentX, currentY, remainingMovement, tilesTraversed };
  }

  private advancePathTile(
    unit: Unit,
    nextTile: any,
    index: number,
    state: { currentX: number; currentY: number; remainingMovement: number; tilesTraversed: number }
  ): boolean {
    const movementCost = Number(nextTile.moveCost);
    if (!Number.isFinite(movementCost) || movementCost < 0) return false;
    if (state.remainingMovement <= 0) return false;
    if (state.tilesTraversed > 0 && state.remainingMovement < movementCost) return false;
    logger.debug('Processing path tile', {
      unitId: unit.id,
      tileIndex: index,
      from: { x: state.currentX, y: state.currentY },
      to: { x: nextTile.x, y: nextTile.y },
      movementCost,
      remainingMovement: state.remainingMovement,
      tilesTraversed: state.tilesTraversed,
    });
    state.currentX = nextTile.x;
    state.currentY = nextTile.y;
    state.remainingMovement = Math.max(0, state.remainingMovement - movementCost);
    state.tilesTraversed++;
    return true;
  }

  private async executeBuildRoad(unit: Unit): Promise<ActionResult> {
    // UnitManager queues and completes the authoritative multi-turn activity.
    return {
      success: true,
      message: `${unit.unitTypeId} started building road`,
    };
  }

  private async executeBuildRailroad(unit: Unit): Promise<ActionResult> {
    // UnitManager queues and completes the authoritative multi-turn activity.
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

    // UnitManager queues and completes the authoritative multi-turn activity.
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

    // UnitManager queues and completes the authoritative multi-turn activity.
    return {
      success: true,
      message: `${unit.unitTypeId} started building mine on ${terrainType}`,
    };
  }

  private async executeWorkerActivity(unit: Unit, activity: string): Promise<ActionResult> {
    return {
      success: true,
      message: `${unit.unitTypeId} started ${activity}`,
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

    // UnitManager queues and completes the authoritative multi-turn activity.
    return {
      success: true,
      message: `${unit.unitTypeId} pillaged ${targetImprovement}`,
    };
  }

  /**
   * Get list of improvements that can be pillaged on a tile
   */
  private getPillageableImprovements(x: number, y: number): string[] {
    const tile = this.mapManager?.getTile(x, y);
    if (!tile) return [];
    const extras = [...tile.improvements];
    if (tile.hasRailroad && !extras.includes('railroad')) extras.unshift('railroad');
    if (tile.hasRoad && !extras.includes('road')) extras.push('road');
    return extras;
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

    // UnitManager queues and completes the authoritative multi-turn activity.
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
    try {
      return this.getTerrain(currentTerrain as TerrainType).transformTo ?? null;
    } catch {
      return null;
    }
  }

  private async executeCleanPollution(unit: Unit): Promise<ActionResult> {
    return {
      success: true,
      message: `${unit.unitTypeId} started cleaning pollution`,
    };
  }

  private async executeTradeRoute(
    unit: Unit,
    targetX: number,
    targetY: number
  ): Promise<ActionResult> {
    const established = await this.gameManagerCallback?.establishTradeRoute?.(
      unit.playerId,
      unit.homeCityId!,
      targetX,
      targetY
    );
    return established
      ? {
          success: true,
          message: `${unit.unitTypeId} established a trade route`,
          unitDestroyed: true,
        }
      : {
          success: false,
          message: 'Cannot establish a trade route with that city',
        };
  }

  private async executeDisbandUnit(unit: Unit): Promise<ActionResult> {
    return {
      success: true,
      message: `${unit.unitTypeId} disbanded`,
      unitDestroyed: true,
    };
  }

  private async executeSkipTurn(unit: Unit): Promise<ActionResult> {
    return {
      success: true,
      message: `${unit.unitTypeId} skipped the rest of its turn`,
    };
  }
}
