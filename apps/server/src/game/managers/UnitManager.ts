/**
 * @module server/game/managers/UnitManager
 * Coordinates authoritative Unit Manager game state.
 */
import { DatabaseProvider } from '@database';
import { units } from '@database/schema/units';
import { games } from '@database/schema/games';
import { players } from '@database/schema/players';
import { and, eq, sql } from 'drizzle-orm';
import { logger } from '@utils/logger';
import { getRulesetMoveFragments } from '@game/constants/MovementConstants';
import { type UnitType, rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { ActionSystem } from '@game/systems/ActionSystem';
import { ActionType, ActionResult } from '@app-types/shared/actions';
import { EffectsManager, EffectType, type EffectContext } from '@game/managers/EffectsManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { TerrainType } from '@game/map/MapTypes';
import { MapTopology } from '@game/map/MapTopology';
import { randomInt, type RandomSource } from '@game/random/FreecivRandom';
import { FreecivIdentityAllocator } from '@game/random/FreecivIdentityAllocator';
import type { MapManager } from '@game/managers/MapManager';
import { RulesetRequirementEvaluator } from '@game/services/RulesetRequirementEvaluator';
import {
  isWorkerAutomationTask,
  type UnitAutomationMode,
  type WorkerAutomationTask,
} from '@game/automation/WorkerAutomationTypes';
import type { CombatPresentationEvent, NuclearPresentationEvent } from '@app-types/presentation';
import type {
  CombatResult,
  DiplomatActionResolution,
  Unit,
  UnitActivity,
  UnitCombatEvent,
  UnitHitpointRecovery,
  UnitLifecycleEvent,
  UnitOrder,
} from '@game/units/UnitTypes';
import { UnitMovementCostService } from '@game/units/UnitMovementCostService';
import { UnitHutService } from '@game/units/UnitHutService';
import { UnitMapStateRepository } from '@game/units/UnitMapStateRepository';
import { getVeteranLevel, getVeteranLevelCount } from '@game/units/UnitVeterancy';

export type {
  CombatResult,
  DiplomatActionResolution,
  Unit,
  UnitActivity,
  UnitCombatEvent,
  UnitHitpointRecovery,
  UnitLifecycleEvent,
  UnitOrder,
  VeteranLevel,
} from '@game/units/UnitTypes';

interface CityAtLocation {
  id: string;
  playerId: string;
  x?: number;
  y?: number;
  buildings?: string[];
  population?: number;
}

export interface UnitManagerCallbacks {
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
  broadcastUnitMoved: (
    gameId: string,
    unitId: string,
    x: number,
    y: number,
    movementLeft: number
  ) => void;
  broadcastUnitDestroyed?: (gameId: string, unit: Unit) => void;
  broadcastUnitInfo?: (gameId: string, unit: Unit) => void;
  getCityAt?: (x: number, y: number) => CityAtLocation | null;
  applyCityPopulationLoss?: (cityId: string) => Promise<boolean>;
  getCityNames?: () => string[];
  getPlayerNation?: (playerId: string) => string | undefined;
  getPlayerBuildings?: (playerId: string) => string[];
  reserveAirlift?: (
    sourceCityId: string,
    destinationCityId: string,
    playerId: string,
    turn: number
  ) => Promise<boolean>;
  getExploredTiles?: (playerId: string) => Set<string>;
  establishTradeRoute?: (
    playerId: string,
    homeCityId: string,
    targetX: number,
    targetY: number
  ) => Promise<boolean>;
  captureCity?: (cityId: string, playerId: string, unitId: string) => Promise<boolean>;
  executeCityUnitAction?: (
    actionType: ActionType,
    playerId: string,
    unitTypeId: string,
    homeCityId: string | undefined,
    targetX: number,
    targetY: number
  ) => Promise<ActionResult>;
  applyNuclearCityDamage?: (
    centerX: number,
    centerY: number,
    radiusSquared: number,
    attackerPlayerId: string
  ) => Promise<string[]>;
  grantHutTechnology?: (playerId: string) => Promise<string | null>;
  revealHutMap?: (playerId: string, x: number, y: number) => string[];
  spawnHutBarbarians?: (playerId: string, x: number, y: number) => Promise<boolean>;
  broadcastHutEvent?: (gameId: string, playerId: string, message: string) => void;
  updatePlayerStatistic?: (
    playerId: string,
    statistic: 'unitsBuilt' | 'unitsKilled' | 'unitsLost'
  ) => void;
  broadcastMapChanged?: (gameId: string, mapData: unknown) => void;
}

interface CombatSetup {
  attackerId: string;
  defenderId: string;
  attacker: Unit;
  defender: Unit;
  attackerType: UnitType;
  defenderType: UnitType;
  defenderTileUnits: Unit[];
  attackerStrength: number;
  defenderStrength: number;
  attackerVeteranChance: number;
  defenderVeteranChance: number;
}

interface CombatOutcome {
  attackerDamage: number;
  defenderDamage: number;
  attackerDestroyed: boolean;
  defenderDestroyed: boolean;
}

interface MovePlan {
  embarkTransport?: Unit;
  disembarksFromTransport?: boolean;
  effectiveMovementCost: number;
  previousX: number;
  previousY: number;
}

interface RulesetWorkerActionEvaluation {
  allowed: boolean;
  improvementType?: string;
}

export type NuclearSourceAction = 'Explode Nuclear' | 'Nuke City' | 'Nuke Units';

/**
 * Outcome context needed by the game-level diplomatic consequence consumer.
 * The target owner is captured before a nuclear blast mutates the map or city
 * state, matching Freeciv's target-tile consequence lookup.
 */
export interface NuclearActionConsequence {
  actor: Unit;
  action: NuclearSourceAction;
  outcome: 'success' | 'caught';
  targetX: number;
  targetY: number;
  targetPlayerId?: string;
}

const NUCLEAR_ACTION_SETTINGS: Record<
  NuclearSourceAction,
  {
    minRange: string;
    maxRange: string;
    actorConsumingAlways: string;
  }
> = {
  'Explode Nuclear': {
    minRange: 'explode_nuclear_min_range',
    maxRange: 'explode_nuclear_max_range',
    actorConsumingAlways: 'explode_nuclear_consuming_always',
  },
  'Nuke City': {
    minRange: 'nuke_city_min_range',
    maxRange: 'nuke_city_max_range',
    actorConsumingAlways: 'nuke_city_consuming_always',
  },
  'Nuke Units': {
    minRange: 'nuke_units_min_range',
    maxRange: 'nuke_units_max_range',
    actorConsumingAlways: 'nuke_units_consuming_always',
  },
};

export class UnitManager {
  private units: Map<string, Unit> = new Map();
  private gameId: string;
  private databaseProvider: DatabaseProvider;
  private mapWidth: number;
  private mapHeight: number;
  private mapManager: any; // MapManager instance for terrain access
  private readonly rulesetRequirements = new RulesetRequirementEvaluator();
  private readonly movementCosts: UnitMovementCostService;
  private readonly hutService: UnitHutService;
  private readonly mapStateRepository: UnitMapStateRepository;
  private actionSystem: ActionSystem;
  private effectsManager?: EffectsManager;
  private currentTurnProvider?: () => number;
  private gameLossHandler?: (playerId: string) => Promise<void>;
  private gameManagerCallback?: UnitManagerCallbacks;
  private playerTechsProvider: (playerId: string) => Set<string> = () => new Set();
  private playerGovernmentProvider: (playerId: string) => string | undefined = () => undefined;
  private playerAIProvider: (playerId: string) => { isAI: boolean; aiLevel?: string } = () => ({
    isAI: false,
  });
  private hostilityProvider?: (
    attackerPlayerId: string,
    defenderPlayerId: string
  ) => Promise<boolean>;
  private contactProvider?: (firstPlayerId: string, secondPlayerId: string) => Promise<void>;
  private hostilePlayersProvider?: (playerId: string) => ReadonlySet<string>;
  private alliedPlayersProvider?: (playerId: string) => ReadonlySet<string>;
  private sameTeamProvider?: (firstPlayerId: string, secondPlayerId: string) => boolean;
  private diplomaticStateLookup?: (firstPlayerId: string, secondPlayerId: string) => string;
  private tileExtrasChangedCallback?: (change: {
    x: number;
    y: number;
    playerId: string;
    added: string[];
    removed: string[];
  }) => void;
  private unitLifecycleObserver?: (event: UnitLifecycleEvent) => void;
  private combatObserver?: (event: UnitCombatEvent) => void;
  private combatPresentationCallback?: (event: CombatPresentationEvent) => void;
  private nuclearPresentationCallback?: (event: NuclearPresentationEvent) => void;
  private nuclearActionConsequenceCallback?: (event: NuclearActionConsequence) => Promise<void>;
  private diplomatActionExecutor?: (
    playerId: string,
    unitId: string,
    actionType: ActionType,
    targetX: number,
    targetY: number
  ) => Promise<ActionResult>;

  constructor(
    gameId: string,
    databaseProvider: DatabaseProvider,
    mapWidth: number,
    mapHeight: number,
    mapManager?: any,
    gameManagerCallback?: UnitManagerCallbacks,
    effectsManager?: EffectsManager,
    private readonly random: RandomSource = Math.random,
    private readonly unitTypes: Record<string, UnitType> = rulesetUnitsService.getUnitTypes(
      'classic'
    ),
    private readonly identities: FreecivIdentityAllocator = new FreecivIdentityAllocator()
  ) {
    this.gameId = gameId;
    this.databaseProvider = databaseProvider;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.mapManager = mapManager;
    this.gameManagerCallback = gameManagerCallback;
    this.effectsManager = effectsManager ?? new EffectsManager();
    this.movementCosts = new UnitMovementCostService(
      this.unitTypes,
      this.effectsManager,
      () => this.getRulesetName(),
      (x, y) => this.getTerrainAt(x, y),
      (x, y) => this.mapManager?.getTile?.(x, y),
      playerId => this.playerTechsProvider(playerId),
      playerId => this.gameManagerCallback?.getPlayerBuildings?.(playerId) ?? []
    );
    this.mapStateRepository = new UnitMapStateRepository(
      this.gameId,
      this.databaseProvider,
      this.mapManager,
      (changedGameId, mapData) =>
        this.gameManagerCallback?.broadcastMapChanged?.(changedGameId, mapData)
    );
    this.hutService = new UnitHutService(
      this.gameId,
      this.databaseProvider,
      this.mapManager,
      () => this.unitTypes,
      this.random,
      this.gameManagerCallback,
      (x, y) => this.getTerrainAt(x, y),
      playerId => this.playerTechsProvider(playerId),
      (playerId, unitTypeId, x, y, homeCityId) =>
        this.createUnit(playerId, unitTypeId, x, y, homeCityId),
      unitId => this.destroyUnit(unitId),
      unitId => this.units.has(unitId),
      this.mapStateRepository
    );
    this.actionSystem = new ActionSystem(
      gameId,
      gameManagerCallback,
      mapManager,
      this.effectsManager.getRulesetName(),
      this.unitTypes
    );
  }

  public setUnitLifecycleObserver(observer: (event: UnitLifecycleEvent) => void): void {
    this.unitLifecycleObserver = observer;
  }

  public setCombatObserver(observer?: (event: UnitCombatEvent) => void): void {
    this.combatObserver = observer;
  }

  public getMapManager(): MapManager | undefined {
    return this.mapManager;
  }

  private getRulesetName(): string {
    return this.effectsManager?.getRulesetName() ?? 'civ2civ3';
  }

  public setDiplomatActionExecutor(
    executor: (
      playerId: string,
      unitId: string,
      actionType: ActionType,
      targetX: number,
      targetY: number
    ) => Promise<ActionResult>
  ): void {
    this.diplomatActionExecutor = executor;
  }

  private notifyUnitLifecycle(event: UnitLifecycleEvent): void {
    const { unit } = event;
    if (event.type === 'destroyed') {
      try {
        this.gameManagerCallback?.broadcastUnitDestroyed?.(this.gameId, unit);
      } catch (error) {
        logger.error('Failed to broadcast authoritative unit destruction', {
          gameId: this.gameId,
          unitId: unit.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    try {
      this.unitLifecycleObserver?.(event);
    } catch (error) {
      logger.error('Failed to notify unit lifecycle observer', {
        gameId: this.gameId,
        unitId: unit.id,
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public setCurrentTurnProvider(provider: () => number): void {
    this.currentTurnProvider = provider;
  }

  public setGameLossHandler(handler: (playerId: string) => Promise<void>): void {
    this.gameLossHandler = handler;
  }

  public setHostilityProvider(
    provider: (attackerPlayerId: string, defenderPlayerId: string) => Promise<boolean>
  ): void {
    this.hostilityProvider = provider;
  }

  public setContactProvider(
    provider: (firstPlayerId: string, secondPlayerId: string) => Promise<void>
  ): void {
    this.contactProvider = provider;
  }

  public setHostilePlayersProvider(provider: (playerId: string) => ReadonlySet<string>): void {
    this.hostilePlayersProvider = provider;
  }

  public setAlliedPlayersProvider(provider: (playerId: string) => ReadonlySet<string>): void {
    this.alliedPlayersProvider = provider;
  }

  /**
   * Supply the exact team relation for effects whose source requirements
   * distinguish an alliance from a shared Freeciv team.
   */
  public setSameTeamProvider(
    provider: (firstPlayerId: string, secondPlayerId: string) => boolean
  ): void {
    this.sameTeamProvider = provider;
  }

  /**
   * Supply the current relation cache for synchronous action availability
   * checks. The database-backed relation lookup remains the authoritative
   * path for actions that need asynchronous resolution.
   */
  public setDiplomaticStateLookup(
    lookup: (firstPlayerId: string, secondPlayerId: string) => string
  ): void {
    this.diplomaticStateLookup = lookup;
  }

  /** Wake sentried units when a hostile unit enters their visible area. */
  public async wakeSentriesForUnit(unit: Unit): Promise<void> {
    if (!this.hostilePlayersProvider || unit.transportedBy) return;
    const topology = (this.mapManager as Partial<MapManager> | undefined)?.getTopology?.();
    for (const sentry of this.units.values()) {
      if (
        sentry.sentryUntil !== 'enemy_sighted' ||
        sentry.transportedBy ||
        !this.hostilePlayersProvider(sentry.playerId).has(unit.playerId)
      ) {
        continue;
      }
      const distance = topology
        ? topology.mapDistance(sentry.x, sentry.y, unit.x, unit.y)
        : Math.max(Math.abs(sentry.x - unit.x), Math.abs(sentry.y - unit.y));
      const visionRadiusSq = this.unitTypes[sentry.unitTypeId]?.vision_radius_sq ?? 1;
      if (distance * distance > visionRadiusSq) continue;

      sentry.sentryUntil = undefined;
      logger.info(`Unit ${sentry.id} woke from sentry duty after sighting ${unit.id}`);
    }
  }

  public setTileExtrasChangedCallback(
    callback: (change: {
      x: number;
      y: number;
      playerId: string;
      added: string[];
      removed: string[];
    }) => void
  ): void {
    this.tileExtrasChangedCallback = callback;
  }

  public setPlayerTechsProvider(provider: (playerId: string) => Set<string>): void {
    this.playerTechsProvider = provider;
  }

  public setPlayerGovernmentProvider(provider: (playerId: string) => string | undefined): void {
    this.playerGovernmentProvider = provider;
  }

  public setPlayerAIProvider(
    provider: (playerId: string) => { isAI: boolean; aiLevel?: string }
  ): void {
    this.playerAIProvider = provider;
  }

  public setExploredTilesProvider(provider: (playerId: string) => Set<string>): void {
    if (this.gameManagerCallback) {
      this.gameManagerCallback.getExploredTiles = provider;
    }
  }

  public setHutMapRevealProvider(
    provider: (playerId: string, x: number, y: number) => string[]
  ): void {
    if (this.gameManagerCallback) this.gameManagerCallback.revealHutMap = provider;
  }

  public setHutBarbarianProvider(
    provider: (playerId: string, x: number, y: number) => Promise<boolean>
  ): void {
    if (this.gameManagerCallback) this.gameManagerCallback.spawnHutBarbarians = provider;
  }

  /**
   * Create a new unit
   */
  async createUnit(
    playerId: string,
    unitTypeId: string,
    x: number,
    y: number,
    homeCityId?: string,
    transportedBy?: string
  ): Promise<Unit> {
    const unitType = this.unitTypes[unitTypeId];
    if (!unitType) {
      throw new Error(`Unknown unit type: ${unitTypeId}`);
    }

    // Validate position
    if (!this.isValidPosition(x, y)) {
      throw new Error(`Invalid position: ${x}, ${y}`);
    }

    const transport = this.resolveTransportForCreation(transportedBy, unitTypeId);

    const creation = this.getUnitCreationValues(playerId, unitTypeId, unitType, x, y);
    const { veteranLevel, createdTurn, movementPoints } = creation;
    const initialMovementPoints = transportedBy ? 0 : movementPoints;
    const unitId = this.identities.nextUuid();
    // Save to database and get the generated ID
    const [dbUnit] = await this.databaseProvider
      .getDatabase()
      .insert(units)
      .values({
        id: unitId,
        gameId: this.gameId,
        playerId,
        unitType: unitTypeId,
        x,
        y,
        health: 100,
        maxHealth: 100,
        attackStrength: unitType.combat,
        defenseStrength: unitType.combat,
        rangedStrength: unitType.range > 1 ? unitType.combat : 0,
        movementPoints: initialMovementPoints.toString(),
        maxMovementPoints: movementPoints.toString(),
        fuel: unitType.fuel ?? 0,
        veteranLevel,
        homeCityId,
        transportedBy,
        isAutomated: false,
        // @reference reference/freeciv/server/unittools.c:1215-1280
        createdTurn,
      })
      .returning();

    const unit: Unit = {
      id: dbUnit.id,
      gameId: this.gameId,
      playerId,
      unitTypeId,
      x,
      y,
      movementLeft: initialMovementPoints,
      fuel: unitType.fuel ?? 0,
      health: 100,
      veteranLevel,
      experience: 0,
      fortified: false,
      homeCityId,
      createdTurn,
      lastActionTurn: undefined,
      automation: undefined,
      transportedBy,
    };

    if (transport) {
      transport.cargoUnits ??= [];
      transport.cargoUnits.push(unit.id);
      await this.databaseProvider
        .getDatabase()
        .update(units)
        .set({ cargoUnits: transport.cargoUnits })
        .where(eq(units.id, transport.id));
    }

    this.units.set(unit.id, unit);
    await this.recordPlayerStatistic(playerId, 'unitsBuilt');
    this.notifyUnitLifecycle({ type: 'created', unit });
    logger.info(`Created unit ${unit.id} at (${x}, ${y})`);

    return unit;
  }

  /** Seed mutable unit state for deterministic scenario fixtures. */
  public async seedUnitState(
    unitId: string,
    state: {
      health?: number;
      experience?: number;
      veteranLevel?: number;
      fortified?: boolean;
      movementLeft?: number;
      automation?: UnitAutomationMode;
    }
  ): Promise<void> {
    const unit = this.units.get(unitId);
    if (!unit) throw new Error(`Unit ${unitId} not found`);

    if (state.health !== undefined) unit.health = state.health;
    if (state.experience !== undefined) unit.experience = state.experience;
    if (state.veteranLevel !== undefined) unit.veteranLevel = state.veteranLevel;
    if (state.fortified !== undefined) unit.fortified = state.fortified;
    if (state.movementLeft !== undefined) unit.movementLeft = state.movementLeft;
    if (state.automation !== undefined) unit.automation = state.automation;

    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
        health: unit.health,
        experience: unit.experience,
        veteranLevel: unit.veteranLevel,
        isFortified: unit.fortified,
        movementPoints: unit.movementLeft.toString(),
        automationMode: unit.automation ?? null,
        isAutomated: unit.automation !== undefined,
      })
      .where(eq(units.id, unitId));
  }

  async applyRallyPoint(unit: Unit, rallyPoint: { x: number; y: number }): Promise<void> {
    unit.orders = [{ type: 'move', targetX: rallyPoint.x, targetY: rallyPoint.y }];
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ isAutomated: true, orders: unit.orders, currentOrder: 'move' })
      .where(eq(units.id, unit.id));
  }

  private resolveTransportForCreation(
    transportedBy: string | undefined,
    unitTypeId: string
  ): Unit | undefined {
    if (!transportedBy) return undefined;

    const transport = this.units.get(transportedBy);
    if (!transport || this.getTransportCapacityRemaining(transportedBy) <= 0) {
      throw new Error(`Transport ${transportedBy} cannot carry unit ${unitTypeId}`);
    }
    if (!this.isValidTransportCombination(transport.unitTypeId, unitTypeId)) {
      throw new Error(`Transport ${transport.unitTypeId} cannot carry unit ${unitTypeId}`);
    }
    return transport;
  }

  private getUnitCreationValues(
    playerId: string,
    unitTypeId: string,
    unitType: UnitType,
    x: number,
    y: number
  ): { veteranLevel: number; createdTurn: number; movementPoints: number } {
    const city = this.gameManagerCallback?.getCityAt?.(x, y);
    const calculatedVeteranLevel =
      city && city.playerId === playerId && this.effectsManager
        ? this.effectsManager.calculateEffect(EffectType.VETERAN_BUILD, {
            playerId,
            unitType: unitTypeId,
            unitClass: unitType.rulesetUnitClass,
            unitTypeFlags: new Set(unitType.flags),
            cityBuildings: new Set(city.buildings ?? []),
          }).value
        : 0;
    const veteranLevel = Math.min(
      Math.max(0, calculatedVeteranLevel),
      getVeteranLevelCount(unitType) - 1
    );
    return {
      veteranLevel,
      createdTurn: this.currentTurnProvider?.() ?? 1,
      movementPoints: this.getUnitMovementPoints(playerId, unitType, veteranLevel),
    };
  }

  /**
   * Move a unit to a new position
   */
  async moveUnit(unitId: string, newX: number, newY: number): Promise<boolean> {
    const unit = this.units.get(unitId);
    if (!unit) throw new Error(`Unit not found: ${unitId}`);
    const plan = await this.prepareMove(unit, newX, newY);
    await this.commitMove(unit, unitId, newX, newY, plan);
    logger.info(`Unit ${unitId} moved to (${newX}, ${newY})`);
    return true;
  }

  private async prepareMove(unit: Unit, newX: number, newY: number): Promise<MovePlan> {
    this.validateMoveTarget(newX, newY);
    if (this.calculateDistance(unit.x, unit.y, newX, newY) !== 1) {
      throw new Error('Units may only move to an adjacent tile');
    }
    const conquersCityFromTransport = this.canConquerCityFromTransport(unit, newX, newY);
    if (unit.transportedBy && !conquersCityFromTransport) {
      throw new Error('Transported unit must unload before moving');
    }
    await this.validateForeignTerritoryEntry(unit, newX, newY);
    const targetUnit = this.getUnitAt(newX, newY);
    await this.captureMoveTargetIfNeeded(unit, targetUnit, newX, newY);
    this.validateDestination(unit, targetUnit, newX, newY);
    if (!this.canMoveWithZoneOfControl(unit, newX, newY)) {
      throw new Error('Move blocked by enemy zone of control');
    }
    const movementCost = this.calculateTerrainMovementCost(unit, unit.x, unit.y, newX, newY);
    const embarkTransport =
      movementCost < 0 ? this.findAvailableTransportAt(unit, newX, newY) : undefined;
    if (movementCost < 0 && !embarkTransport) {
      throw new Error(`Unit cannot enter terrain at ${newX}, ${newY}`);
    }
    this.ensureSufficientMovement(unit);
    const unitType = this.unitTypes[unit.unitTypeId];
    const conquerActionCost =
      conquersCityFromTransport && unitType
        ? this.getActionSuccessMovementCost(unit, unitType, 'Conquer City Shrink 2', {
            // The source charges this effect after unit_move() has placed the
            // Marine on the captured native city tile.
            // @reference reference/freeciv/server/unithand.c:5610-5642
            unitIsOnNativeTile: this.isUnitOnNativeTile(unitType, newX, newY),
          })
        : 0;
    return {
      embarkTransport,
      disembarksFromTransport: conquersCityFromTransport,
      effectiveMovementCost:
        (embarkTransport ? this.getMoveFragments() : movementCost) + conquerActionCost,
      previousX: unit.x,
      previousY: unit.y,
    };
  }

  /**
   * C2C3 gives Marines a distinct Conquer City Shrink 2 action from a
   * non-livable source tile. It is not an ordinary Transport Disembark:
   * the city must be foreign, undefended, and at war before the passenger
   * leaves its transport to capture it.
   *
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:882-913
   * @reference reference/freeciv/server/unithand.c:5610-5642
   */
  private canConquerCityFromTransport(unit: Unit, targetX: number, targetY: number): boolean {
    if (this.getRulesetName() !== 'civ2civ3' || !unit.transportedBy) return false;
    const unitType = this.unitTypes[unit.unitTypeId];
    const targetCity = this.gameManagerCallback?.getCityAt?.(targetX, targetY);
    if (
      !unitType ||
      !targetCity ||
      targetCity.playerId === unit.playerId ||
      this.alliedPlayersProvider?.(unit.playerId).has(targetCity.playerId) ||
      this.getUnitsAt(targetX, targetY).length > 0
    ) {
      return false;
    }
    if (
      !this.canUnitCaptureCity(unitType) ||
      !unitType.flags?.includes('Marines') ||
      unit.movementLeft <= 0 ||
      this.isUnitOnNativeTile(unitType, unit.x, unit.y) ||
      this.isAnimalKingdom(unit.playerId)
    ) {
      return false;
    }
    return Boolean(this.units.get(unit.transportedBy));
  }

  private isAnimalKingdom(playerId: string): boolean {
    const nation = this.gameManagerCallback?.getPlayerNation?.(playerId)?.toLowerCase();
    return nation === 'animals' || nation === 'animal kingdom';
  }

  private async captureMoveTargetIfNeeded(
    unit: Unit,
    targetUnit: Unit | undefined,
    newX: number,
    newY: number
  ): Promise<void> {
    const targetCity = this.gameManagerCallback?.getCityAt?.(newX, newY);
    if (!this.isCapturableEnemyCity(unit, targetUnit, targetCity)) return;
    await this.contactProvider?.(unit.playerId, targetCity.playerId);
    await this.captureEnemyCity(unit, targetCity);
  }

  private isCapturableEnemyCity(
    unit: Unit,
    targetUnit: Unit | undefined,
    targetCity: CityAtLocation | null | undefined
  ): targetCity is CityAtLocation {
    if (!targetCity || targetUnit || targetCity.playerId === unit.playerId) return false;
    return !this.alliedPlayersProvider?.(unit.playerId).has(targetCity.playerId);
  }

  private async captureEnemyCity(unit: Unit, targetCity: CityAtLocation): Promise<void> {
    if (
      this.hostilityProvider &&
      !(await this.hostilityProvider(unit.playerId, targetCity.playerId))
    ) {
      throw new Error('Cannot capture a city unless its owner is at war');
    }
    const captured =
      (this.getRulesetName() !== 'civ2civ3' || !this.isAnimalKingdom(unit.playerId)) &&
      this.canUnitCaptureCity(this.unitTypes[unit.unitTypeId]) &&
      this.gameManagerCallback?.captureCity
        ? await this.gameManagerCallback.captureCity(targetCity.id, unit.playerId, unit.id)
        : false;
    if (!captured) throw new Error('Cannot capture enemy city with this unit');
  }

  private async commitMove(
    unit: Unit,
    unitId: string,
    newX: number,
    newY: number,
    plan: MovePlan
  ): Promise<void> {
    if (plan.disembarksFromTransport) await this.releaseTransportedUnit(unit);
    unit.x = newX;
    unit.y = newY;
    unit.movementLeft = Math.max(0, unit.movementLeft - plan.effectiveMovementCost);
    unit.fortified = false;
    this.embarkUnit(unit, plan.embarkTransport);
    const cargo = this.moveCargo(unit, newX, newY);
    await this.persistMove(unitId, unit, cargo, plan.embarkTransport, plan.disembarksFromTransport);
    await this.resolveEnteredTile(unit);
    await this.establishAdjacentContacts(unit);
    this.notifyMoveLifecycle(unit, cargo, plan.previousX, plan.previousY);
  }

  private embarkUnit(unit: Unit, transport: Unit | undefined): void {
    if (!transport) return;
    unit.transportedBy = transport.id;
    transport.cargoUnits ??= [];
    transport.cargoUnits.push(unit.id);
  }

  private moveCargo(unit: Unit, x: number, y: number): Unit[] {
    const cargo = (unit.cargoUnits ?? [])
      .map(cargoId => this.units.get(cargoId))
      .filter((cargoUnit): cargoUnit is Unit => Boolean(cargoUnit));
    for (const cargoUnit of cargo) {
      cargoUnit.x = x;
      cargoUnit.y = y;
    }
    return cargo;
  }

  private async persistMove(
    unitId: string,
    unit: Unit,
    cargo: Unit[],
    transport: Unit | undefined,
    disembarkedFromTransport: boolean = false
  ): Promise<void> {
    await this.updateUnitPositionInDb(unitId, unit);
    if (disembarkedFromTransport) {
      await this.databaseProvider
        .getDatabase()
        .update(units)
        .set({ transportedBy: null })
        .where(eq(units.id, unit.id));
    }
    if (transport) {
      await Promise.all([
        this.databaseProvider
          .getDatabase()
          .update(units)
          .set({ transportedBy: transport.id })
          .where(eq(units.id, unit.id)),
        this.databaseProvider
          .getDatabase()
          .update(units)
          .set({ cargoUnits: transport.cargoUnits })
          .where(eq(units.id, transport.id)),
      ]);
    }
    await Promise.all(cargo.map(cargoUnit => this.updateUnitPositionInDb(cargoUnit.id, cargoUnit)));
  }

  private notifyMoveLifecycle(
    unit: Unit,
    cargo: Unit[],
    previousX: number,
    previousY: number
  ): void {
    if (!this.units.has(unit.id)) return;
    this.notifyUnitLifecycle({ type: 'moved', unit, previousX, previousY });
    for (const cargoUnit of cargo) {
      if (this.units.has(cargoUnit.id)) {
        this.notifyUnitLifecycle({ type: 'moved', unit: cargoUnit, previousX, previousY });
      }
    }
  }

  private async establishAdjacentContacts(unit: Unit): Promise<void> {
    if (!this.contactProvider) return;
    const foreignPlayers = new Set(
      [...this.units.values()]
        .filter(
          other =>
            other.playerId !== unit.playerId &&
            this.calculateDistance(unit.x, unit.y, other.x, other.y) <= 1
        )
        .map(other => other.playerId)
    );
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const city = this.gameManagerCallback?.getCityAt?.(unit.x + dx, unit.y + dy);
        if (city && city.playerId !== unit.playerId) foreignPlayers.add(city.playerId);
      }
    }
    for (const otherPlayerId of foreignPlayers) {
      await this.contactProvider(unit.playerId, otherPlayerId);
    }
  }

  /**
   * Hut entry/frighten and extra conquest are movement consequences in
   * classic, rather than separate player orders.
   * @reference reference/freeciv/server/unittools.c:3304-3380
   * @reference reference/freeciv/data/default/default.lua:19-185
   */
  private async resolveEnteredTile(unit: Unit): Promise<void> {
    await this.hutService.resolveEnteredTile(unit);
  }

  public async resolveHutReward(unit: Unit): Promise<void> {
    await this.hutService.resolveReward(unit);
  }

  private async persistMapState(): Promise<void> {
    await this.mapStateRepository.persist();
  }

  private validateMoveTarget(newX: number, newY: number): void {
    if (!this.isValidPosition(newX, newY)) {
      throw new Error(`Invalid position: ${newX}, ${newY}`);
    }
  }

  private ensureSufficientMovement(unit: Unit): void {
    // Freeciv's minimum-move rule permits one adjacent step whenever a unit
    // has any fragments left, even when the terrain cost is higher.
    if (unit.movementLeft <= 0) {
      throw new Error('Not enough movement points');
    }
  }

  private validateDestination(
    unit: Unit,
    targetUnit: Unit | undefined,
    newX: number,
    newY: number
  ): void {
    this.validateUnitDestination(unit, targetUnit);
    this.validateCityDestination(unit, newX, newY);
  }

  private async validateForeignTerritoryEntry(unit: Unit, x: number, y: number): Promise<void> {
    if (!this.canUnitAttackForeignUnit(unit)) return;
    const owner = this.mapManager?.getTile?.(x, y)?.owner;
    if (
      !owner ||
      owner === unit.playerId ||
      this.alliedPlayersProvider?.(unit.playerId).has(owner) ||
      this.hostilePlayersProvider?.(unit.playerId).has(owner)
    ) {
      return;
    }
    if (this.hostilityProvider && (await this.hostilityProvider(unit.playerId, owner))) return;
    throw new Error(`Cannot invade unless you break peace with ${owner} first.`);
  }

  private validateUnitDestination(unit: Unit, targetUnit?: Unit): void {
    if (!targetUnit || targetUnit.playerId === unit.playerId) return;
    if (this.alliedPlayersProvider?.(unit.playerId).has(targetUnit.playerId)) return;
    throw new Error('Cannot move to tile occupied by enemy unit');
  }

  private validateCityDestination(unit: Unit, newX: number, newY: number): void {
    const targetCity = this.gameManagerCallback?.getCityAt?.(newX, newY);
    if (!targetCity || targetCity.playerId === unit.playerId) return;
    if (this.alliedPlayersProvider?.(unit.playerId).has(targetCity.playerId)) return;
    throw new Error('Cannot move to tile occupied by enemy city');
  }

  /**
   * Classic ground units may not move from one enemy-controlled tile directly
   * into another. Friendly stacks, cities, non-ZOC terrain, and IgZOC units
   * are exempt.
   * @reference reference/freeciv/common/movement.c:573-595
   * @reference reference/freeciv/common/unit.c:1443-1510
   */
  private canMoveWithZoneOfControl(unit: Unit, newX: number, newY: number): boolean {
    return this.canMoveWithZoneOfControlFrom(unit, unit.x, unit.y, newX, newY);
  }

  private canMoveWithZoneOfControlFrom(
    unit: Unit,
    fromX: number,
    fromY: number,
    newX: number,
    newY: number
  ): boolean {
    const type = this.unitTypes[unit.unitTypeId];
    const subjectToZoc =
      type?.rulesetUnitClassFlags.includes('ZOC') && !type.flags?.includes('IgZOC');
    if (!subjectToZoc) return true;

    if (this.hasFriendlyStackAt(unit, newX, newY)) return true;
    if (this.hasCityAtEitherEndpoint(fromX, fromY, newX, newY)) return true;
    if (this.hasNoZocTerrain(fromX, fromY, newX, newY)) return true;

    return (
      !this.hasAdjacentEnemyZoc(unit.playerId, fromX, fromY) ||
      !this.hasAdjacentEnemyZoc(unit.playerId, newX, newY)
    );
  }

  private hasFriendlyStackAt(unit: Unit, x: number, y: number): boolean {
    return this.getUnitsAt(x, y).some(candidate => candidate.playerId === unit.playerId);
  }

  private hasCityAtEitherEndpoint(fromX: number, fromY: number, toX: number, toY: number): boolean {
    return Boolean(
      this.gameManagerCallback?.getCityAt?.(fromX, fromY) ||
      this.gameManagerCallback?.getCityAt?.(toX, toY)
    );
  }

  private hasNoZocTerrain(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const noZocTerrains = new Set(['ocean', 'deep_ocean', 'coast', 'lake']);
    return (
      noZocTerrains.has(this.getTerrainAt(fromX, fromY)) ||
      noZocTerrains.has(this.getTerrainAt(toX, toY))
    );
  }

  private hasAdjacentEnemyZoc(playerId: string, x: number, y: number): boolean {
    return [...this.units.values()].some(candidate => {
      if (
        candidate.playerId === playerId ||
        (this.hostilePlayersProvider &&
          !this.hostilePlayersProvider(playerId).has(candidate.playerId)) ||
        candidate.transportedBy ||
        this.calculateDistance(x, y, candidate.x, candidate.y) > 1
      ) {
        return false;
      }
      const type = this.unitTypes[candidate.unitTypeId];
      return Boolean(
        type?.rulesetUnitClassFlags.includes('ZOC') && !type.flags?.includes('HasNoZOC')
      );
    });
  }

  private async updateUnitPositionInDb(unitId: string, unit: Unit): Promise<void> {
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ x: unit.x, y: unit.y, movementPoints: unit.movementLeft.toString() })
      .where(eq(units.id, unitId));
  }

  /**
   * Attack another unit
   */
  async attackUnit(
    attackerId: string,
    defenderId: string,
    action: 'attack' | 'suicide' = 'attack'
  ): Promise<CombatResult> {
    const setup = await this.prepareCombat(attackerId, defenderId, action);
    const attackerBefore = { ...setup.attacker };
    const defenderBefore = { ...setup.defender };
    const collateralBefore = setup.defenderTileUnits.map(unit => ({ ...unit }));
    const outcome = this.resolveCombatRounds(setup);
    const result = await this.finalizeCombat(setup, outcome);
    this.emitCombatPresentation(attackerBefore, defenderBefore, result);
    try {
      const collateralIds = new Set(result.collateralDestroyedIds ?? []);
      this.combatObserver?.({
        attacker: attackerBefore,
        defender: defenderBefore,
        result,
        collateralUnits: collateralBefore.filter(unit => collateralIds.has(unit.id)),
      });
    } catch (error) {
      logger.warn('Failed to notify combat observer after authoritative combat', {
        gameId: this.gameId,
        attackerId: attackerBefore.id,
        defenderId: defenderBefore.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return result;
  }

  setCombatPresentationCallback(callback?: (event: CombatPresentationEvent) => void): void {
    this.combatPresentationCallback = callback;
  }

  hasCombatPresentationCallback(): boolean {
    return Boolean(this.combatPresentationCallback);
  }

  setNuclearPresentationCallback(callback?: (event: NuclearPresentationEvent) => void): void {
    this.nuclearPresentationCallback = callback;
  }

  setNuclearActionConsequenceCallback(
    callback?: (event: NuclearActionConsequence) => Promise<void>
  ): void {
    this.nuclearActionConsequenceCallback = callback;
  }

  hasNuclearPresentationCallback(): boolean {
    return Boolean(this.nuclearPresentationCallback);
  }

  private emitCombatPresentation(
    attackerBefore: Unit,
    defenderBefore: Unit,
    result: CombatResult
  ): void {
    if (!this.combatPresentationCallback) return;
    const winner = result.attackerDestroyed ? defenderBefore : attackerBefore;
    const unitType = this.getUnitType(winner.unitTypeId);
    const identifiers = [winner.unitTypeId, unitType?.name]
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.toLowerCase());
    const preGunpowderUnits = new Set([
      'warriors',
      'phalanx',
      'legion',
      'pikemen',
      'archers',
      'horsemen',
      'chariot',
      'elephants',
      'knights',
      'crusaders',
      'scout',
      'explorer',
      'tribesmen',
      'settlers',
      'workers',
      'trireme',
      'longboat',
      'caravan',
      'war galley',
      'galley',
      'siege ram',
      'caravel',
      'ram ship',
    ]);
    const survivingAttacker = this.units.get(result.attackerId);
    const survivingDefender = this.units.get(result.defenderId);
    try {
      this.combatPresentationCallback({
        eventId: `combat:${this.gameId}:${Date.now()}:${attackerBefore.id}:${defenderBefore.id}`,
        x: defenderBefore.x,
        y: defenderBefore.y,
        style: identifiers.some(identifier => preGunpowderUnits.has(identifier))
          ? 'swords'
          : 'explosion',
        playerIds: [attackerBefore.playerId, defenderBefore.playerId],
        attackerDamage: result.attackerDamage,
        defenderDamage: result.defenderDamage,
        attackerDestroyed: result.attackerDestroyed,
        defenderDestroyed: result.defenderDestroyed,
        combatants: [
          this.toCombatPresentationCombatant(
            attackerBefore,
            'attacker',
            result.attackerDestroyed ? 0 : (survivingAttacker?.health ?? 0),
            result.attackerDestroyed
          ),
          this.toCombatPresentationCombatant(
            defenderBefore,
            'defender',
            result.defenderDestroyed ? 0 : (survivingDefender?.health ?? 0),
            result.defenderDestroyed
          ),
        ],
      });
    } catch (error) {
      logger.warn('Combat presentation callback failed after authoritative combat', error);
    }
  }

  private toCombatPresentationCombatant(
    unit: Unit,
    role: 'attacker' | 'defender',
    hpAfter: number,
    destroyed: boolean
  ) {
    return {
      id: unit.id,
      role,
      playerId: unit.playerId,
      unitTypeId: unit.unitTypeId,
      x: unit.x,
      y: unit.y,
      hpBefore: unit.health,
      hpAfter,
      movesLeft: unit.movementLeft,
      veteranLevel: unit.veteranLevel,
      fortified: unit.fortified,
      activity: unit.activity,
      destroyed,
    };
  }

  private async prepareCombat(
    attackerId: string,
    defenderId: string,
    action: 'attack' | 'suicide'
  ): Promise<CombatSetup> {
    const attacker = this.units.get(attackerId);
    const requestedDefender = this.units.get(defenderId);
    if (!attacker || !requestedDefender) throw new Error('Unit not found');
    if (attacker.playerId === requestedDefender.playerId) {
      throw new Error('Cannot attack a friendly unit');
    }
    const hostilePlayers = await this.getHostilePlayers(attacker, requestedDefender);
    if (!hostilePlayers.has(requestedDefender.playerId)) {
      throw new Error('Cannot attack a player unless at war');
    }
    const defender = this.selectBestDefender(
      attacker,
      requestedDefender.x,
      requestedDefender.y,
      hostilePlayers
    );
    if (!defender) throw new Error('No eligible defender on target tile');
    const attackerType = this.unitTypes[attacker.unitTypeId];
    const defenderType = this.unitTypes[defender.unitTypeId];
    this.validateCombatRange(attacker, defender, attackerType, action);
    const attackerStrength = this.calculateAttackStrength(attacker, attackerType);
    const defenderStrength = this.calculateCombatStrength(
      defender,
      defenderType,
      attacker,
      attackerType
    );
    const firepower = this.calculateModifiedFirepower(
      attacker,
      defender,
      attackerType,
      defenderType
    );
    const attackerCombatStrength = attackerStrength * attacker.health * firepower.attacker;
    const defenderCombatStrength = defenderStrength * defender.health * firepower.defender;
    const totalCombatStrength = attackerCombatStrength + defenderCombatStrength;

    return {
      attackerId,
      defenderId: defender.id,
      attacker,
      defender,
      attackerType,
      defenderType,
      defenderTileUnits: this.getUnitsAt(defender.x, defender.y).filter(
        unit => unit.playerId === defender.playerId && unit.id !== defender.id
      ),
      attackerStrength,
      defenderStrength,
      attackerVeteranChance:
        totalCombatStrength > 0
          ? Math.floor((defenderCombatStrength * 200) / totalCombatStrength)
          : 0,
      defenderVeteranChance:
        totalCombatStrength > 0
          ? Math.floor((attackerCombatStrength * 200) / totalCombatStrength)
          : 0,
    };
  }

  private async getHostilePlayers(attacker: Unit, defender: Unit): Promise<Set<string>> {
    const players = new Set(this.getUnitsAt(defender.x, defender.y).map(unit => unit.playerId));
    const hostilePlayers = new Set<string>();
    const attackerIsBarbarian = await this.isBarbarianPlayer(attacker.playerId);
    for (const playerId of players) {
      if (
        playerId !== attacker.playerId &&
        (attackerIsBarbarian ||
          !this.hostilityProvider ||
          (await this.hostilityProvider(attacker.playerId, playerId)))
      ) {
        hostilePlayers.add(playerId);
      }
    }
    return hostilePlayers;
  }

  private async isBarbarianPlayer(playerId: string): Promise<boolean> {
    const player = await this.databaseProvider.getDatabase().query.players.findFirst({
      where: eq(players.id, playerId),
    });
    return this.isBarbarianRecord(player);
  }

  private isBarbarianRecord(
    player: { nation?: string | null; civilization?: string | null } | undefined
  ): boolean {
    return Boolean(
      player?.nation?.toLowerCase() === 'barbarian' ||
      player?.civilization?.toLowerCase().startsWith('barbarian')
    );
  }

  // eslint-disable-next-line complexity
  private validateCombatRange(
    attacker: Unit,
    defender: Unit,
    attackerType: UnitType,
    action: 'attack' | 'suicide'
  ): void {
    if (
      defender.transportedBy ||
      (attacker.transportedBy && !this.canAttackFromTransport(attackerType))
    ) {
      throw new Error('Transported units cannot directly participate in combat');
    }
    if ((attackerType.attack ?? 0) <= 0) throw new Error('Unit has no attack strength');
    if (attacker.movementLeft <= 0) {
      throw new Error('No movement points remaining');
    }
    if (attackerType.flags?.includes('NonMil')) {
      throw new Error('Non-military units cannot attack');
    }
    if (action === 'attack') {
      if (attackerType.rulesetUnitClassFlags.includes('Missile')) {
        throw new Error('Missile units must use a suicide attack');
      }
      const sourceTerrain = this.getTerrainAt(attacker.x, attacker.y);
      const canAttackFromNonNative =
        attackerType.flags?.includes('Marines') ||
        attackerType.rulesetUnitClassFlags.includes('AttFromNonNative');
      if (!this.canUnitEnterTerrain(sourceTerrain, attackerType.id) && !canAttackFromNonNative) {
        throw new Error('Unit cannot attack from a non-native tile');
      }
    }
    if (
      this.calculateDistance(attacker.x, attacker.y, defender.x, defender.y) > attackerType.range
    ) {
      throw new Error('Target out of range');
    }
    const targetTerrain = this.getTerrainAt(defender.x, defender.y);
    const targetIsNonNative = !this.canUnitEnterTerrain(targetTerrain, attackerType.id);
    const onlyNativeAttack = attackerType.flags?.includes('Only_Native_Attack') ?? false;
    if (
      targetIsNonNative &&
      (onlyNativeAttack ||
        (!attackerType.rulesetUnitClassFlags.includes('AttackNonNative') &&
          !attackerType.flags?.includes('AttackNonNative')))
    ) {
      throw new Error('Unit cannot attack a non-native target tile');
    }
  }

  private resolveCombatRounds(setup: CombatSetup): CombatOutcome {
    const firepower = this.calculateModifiedFirepower(
      setup.attacker,
      setup.defender,
      setup.attackerType,
      setup.defenderType
    );
    const damagePerAttackerWin = Math.max(
      1,
      Math.round((firepower.attacker * 100) / (setup.defenderType.hitpoints ?? 10))
    );
    const damagePerDefenderWin = Math.max(
      1,
      Math.round((firepower.defender * 100) / (setup.attackerType.hitpoints ?? 10))
    );
    const attackerStartingHealth = setup.attacker.health;
    const defenderStartingHealth = setup.defender.health;
    while (setup.attacker.health > 0 && setup.defender.health > 0) {
      if (
        randomInt(
          this.random,
          Math.max(1, Math.floor(setup.attackerStrength + setup.defenderStrength))
        ) >= setup.defenderStrength
      ) {
        setup.defender.health -= damagePerAttackerWin;
      } else {
        setup.attacker.health -= damagePerDefenderWin;
      }
    }
    setup.attacker.health = Math.max(0, setup.attacker.health);
    setup.defender.health = Math.max(0, setup.defender.health);
    const moveCost = this.getActionSuccessMovementCost(
      setup.attacker,
      setup.attackerType,
      'Attack'
    );
    setup.attacker.movementLeft = Math.max(0, setup.attacker.movementLeft - moveCost);
    return {
      attackerDamage: attackerStartingHealth - setup.attacker.health,
      defenderDamage: defenderStartingHealth - setup.defender.health,
      attackerDestroyed: setup.attacker.health <= 0,
      defenderDestroyed: setup.defender.health <= 0,
    };
  }

  private async finalizeCombat(setup: CombatSetup, outcome: CombatOutcome): Promise<CombatResult> {
    const promotions = await this.applyCombatOutcome(setup, outcome);
    const collateralDestroyedIds = outcome.defenderDestroyed
      ? await this.resolveDefenderDestruction(setup, outcome.attackerDestroyed)
      : undefined;
    const result: CombatResult = {
      attackerId: setup.attackerId,
      defenderId: setup.defenderId,
      attackerDamage: outcome.attackerDamage,
      defenderDamage: outcome.defenderDamage,
      attackerDestroyed: outcome.attackerDestroyed,
      defenderDestroyed: outcome.defenderDestroyed,
      collateralDestroyedIds,
      experienceGained: promotions,
    };
    logger.info(`Combat: ${setup.attackerId} vs ${setup.defenderId}`, result);
    return result;
  }

  private async applyCombatOutcome(
    setup: CombatSetup,
    outcome: CombatOutcome
  ): Promise<{ attacker: number; defender: number }> {
    const attackerPromoted = outcome.defenderDestroyed
      ? await this.maybePromoteAfterCombat(
          setup.attacker,
          setup.attackerVeteranChance,
          setup.attackerStrength,
          setup.defenderStrength
        )
      : false;
    const defenderPromoted = outcome.attackerDestroyed
      ? await this.maybePromoteAfterCombat(
          setup.defender,
          setup.defenderVeteranChance,
          setup.defenderStrength,
          setup.attackerStrength
        )
      : false;
    if (outcome.attackerDestroyed) await this.destroyUnit(setup.attackerId);
    else await this.persistCombatUnit(setup.attackerId, setup.attacker, true);
    if (!outcome.defenderDestroyed)
      await this.persistCombatUnit(setup.defenderId, setup.defender, false);
    return { attacker: attackerPromoted ? 1 : 0, defender: defenderPromoted ? 1 : 0 };
  }

  private async persistCombatUnit(unitId: string, unit: Unit, attacker: boolean): Promise<void> {
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set(
        attacker
          ? { health: unit.health, movementPoints: String(unit.movementLeft) }
          : { health: unit.health }
      )
      .where(eq(units.id, unitId));
  }

  private getActionSuccessMovementCost(
    unit: Unit,
    unitType: UnitType,
    action: string,
    context: Partial<EffectContext> = {}
  ): number {
    const result = this.effectsManager?.calculateEffect(EffectType.ACTION_SUCCESS_ACTOR_MOVE_COST, {
      ...this.getUnitEffectContext(unit, unitType, action),
      ...context,
    });
    if (result?.effects.length) return Math.max(0, result.value);
    // These combat alternatives have Freeciv fallback costs even if a caller
    // has no loaded effects manager. Other actions must opt into a
    // source-defined effect; using a combat fallback for them would fabricate
    // a cost.
    if (action === 'Capture Units') return 6;
    return ['Attack', 'Collect Ransom'].includes(action)
      ? unitType.flags?.includes('OneAttack')
        ? 65535
        : 6
      : 0;
  }

  private async resolveDefenderDestruction(
    setup: CombatSetup,
    attackerDestroyed: boolean
  ): Promise<string[]> {
    await this.recordPlayerStatistic(setup.attacker.playerId, 'unitsKilled');
    await this.destroyUnit(setup.defenderId);
    const collateralDestroyedIds = await this.destroyCollateralUnits(setup);
    const targetCity = this.gameManagerCallback?.getCityAt?.(setup.defender.x, setup.defender.y);
    await this.applyCivilianCasualty(
      setup.attacker,
      setup.attackerType,
      targetCity,
      setup.defender.x,
      setup.defender.y
    );
    const canOccupy = await this.canOccupyAfterCombat(setup, targetCity, attackerDestroyed);
    if (canOccupy)
      await this.moveAttackerAfterCombat(setup.attackerId, setup.attacker, setup.defender);
    return collateralDestroyedIds;
  }

  private async recordPlayerStatistic(
    playerId: string,
    statistic: 'unitsBuilt' | 'unitsKilled' | 'unitsLost'
  ): Promise<void> {
    const column = players[statistic];
    if (!column) {
      throw new Error(`Unknown player statistic: ${statistic}`);
    }

    await this.databaseProvider
      .getDatabase()
      .update(players)
      // Drizzle update keys use the schema property name (e.g. unitsLost),
      // while the SQL expression references the underlying column object.
      .set({ [statistic]: sql`${column} + 1` } as any)
      .where(eq(players.id, playerId));
    this.gameManagerCallback?.updatePlayerStatistic?.(playerId, statistic);
  }

  private async applyCivilianCasualty(
    attacker: Unit,
    attackerType: UnitType,
    targetCity: CityAtLocation | null | undefined,
    targetX: number,
    targetY: number
  ): Promise<void> {
    if (
      !targetCity ||
      !this.gameManagerCallback?.applyCityPopulationLoss ||
      !attackerType.rulesetUnitClassFlags.includes('KillCitizen') ||
      (targetCity.population ?? 2) <= 1
    ) {
      return;
    }

    const noPopulationLoss = this.effectsManager?.calculateEffect(EffectType.UNIT_NO_LOSE_POP, {
      cityId: targetCity.id,
      tileX: targetX,
      tileY: targetY,
      cityBuildings: new Set(targetCity.buildings ?? []),
      cityPopulation: targetCity.population,
      tileIsCityCenter: true,
      unitId: attacker.id,
      unitType: attackerType.id,
      unitClass: attackerType.rulesetUnitClass,
      unitClassFlags: new Set(attackerType.rulesetUnitClassFlags),
      unitTypeFlags: new Set(attackerType.flags ?? []),
    }).value;
    if ((noPopulationLoss ?? 0) > 0) return;

    await this.gameManagerCallback.applyCityPopulationLoss(targetCity.id);
  }

  private async destroyCollateralUnits(setup: CombatSetup): Promise<string[]> {
    if (this.isStackProtected(setup.defender)) return [];
    const destroyed: string[] = [];
    for (const unit of setup.defenderTileUnits) {
      await this.destroyUnit(unit.id);
      destroyed.push(unit.id);
    }
    return destroyed;
  }

  private isStackProtected(defender: Unit): boolean {
    const city = this.gameManagerCallback?.getCityAt?.(defender.x, defender.y);
    const tile = this.mapManager?.getTile(defender.x, defender.y);
    return Boolean(
      city ||
      tile?.improvements?.some((extra: string) => extra === 'fortress' || extra === 'airbase')
    );
  }

  private async canOccupyAfterCombat(
    setup: CombatSetup,
    targetCity: CityAtLocation | null | undefined,
    attackerDestroyed: boolean
  ): Promise<boolean> {
    if (attackerDestroyed || setup.attackerType.range !== 1) return false;
    if (
      this.getUnitsAt(setup.defender.x, setup.defender.y).some(
        unit => unit.playerId === setup.defender.playerId
      )
    ) {
      return false;
    }
    if (!targetCity || targetCity.playerId === setup.attacker.playerId) return true;
    if (!this.canUnitCaptureCity(setup.attackerType)) return false;
    return (
      (await this.gameManagerCallback?.captureCity?.(
        targetCity.id,
        setup.attacker.playerId,
        setup.attacker.id
      )) === true
    );
  }

  private async moveAttackerAfterCombat(
    attackerId: string,
    attacker: Unit,
    defender: Unit
  ): Promise<void> {
    if (attacker.transportedBy) {
      const transport = this.units.get(attacker.transportedBy);
      if (transport) await this.detachCargoFromTransport(attacker, transport);
      attacker.transportedBy = undefined;
    }
    attacker.x = defender.x;
    attacker.y = defender.y;
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ x: attacker.x, y: attacker.y })
      .where(eq(units.id, attackerId));
  }

  private canAttackFromTransport(attackerType: UnitType): boolean {
    return attackerType.flags?.includes('Marines') === true;
  }

  private canUnitCaptureCity(unitType: UnitType): boolean {
    return (
      unitType.rulesetUnitClassFlags.includes('CanOccupyCity') &&
      !unitType.flags?.includes('NonMil')
    );
  }

  /**
   * Freeciv attacks a tile and lets the server choose the best eligible
   * defender. Do not allow a client-supplied unit id to bypass a stronger
   * member of the stack.
   */
  private selectBestDefender(
    attacker: Unit,
    x: number,
    y: number,
    hostilePlayers?: ReadonlySet<string>
  ): Unit | undefined {
    return this.getUnitsAt(x, y)
      .filter(
        candidate =>
          candidate.playerId !== attacker.playerId &&
          !candidate.transportedBy &&
          this.canUnitTargetUnit(attacker, candidate) &&
          (!hostilePlayers || hostilePlayers.has(candidate.playerId))
      )
      .sort((left, right) => {
        const leftType = this.unitTypes[left.unitTypeId];
        const rightType = this.unitTypes[right.unitTypeId];
        const leftScore =
          this.calculateCombatStrength(
            left,
            leftType,
            attacker,
            this.unitTypes[attacker.unitTypeId]
          ) *
          Math.max(1, left.health) *
          Math.max(1, leftType.firepower ?? 1);
        const rightScore =
          this.calculateCombatStrength(
            right,
            rightType,
            attacker,
            this.unitTypes[attacker.unitTypeId]
          ) *
          Math.max(1, right.health) *
          Math.max(1, rightType.firepower ?? 1);
        return rightScore - leftScore || left.id.localeCompare(right.id);
      })[0];
  }

  /**
   * Apply classic's situational firepower overrides before combat rounds.
   * @reference reference/freeciv/common/combat.c:411-470 get_modified_firepower()
   */
  private calculateModifiedFirepower(
    attacker: Unit,
    defender: Unit,
    attackerType: UnitType,
    defenderType: UnitType
  ): { attacker: number; defender: number } {
    const rules = rulesetLoader.getCombatRules(this.getRulesetName());
    const city = this.gameManagerCallback?.getCityAt?.(defender.x, defender.y);
    const firepower = {
      attacker: attackerType.firepower ?? 1,
      defender: defenderType.firepower ?? 1,
    };
    this.applyCityFirepower(firepower, city, attacker, defender, attackerType, defenderType, rules);
    this.applyCombatBonusFirepower(firepower, attackerType, defenderType, rules);
    this.applyNonNativeFirepower(firepower, attacker, defender, attackerType, defenderType, rules);
    return firepower;
  }

  private applyCityFirepower(
    firepower: { attacker: number; defender: number },
    city: CityAtLocation | null | undefined,
    attacker: Unit,
    defender: Unit,
    attackerType: UnitType,
    defenderType: UnitType,
    rules: ReturnType<typeof rulesetLoader.getCombatRules>
  ): void {
    if (!city) return;
    if (attackerType.flags?.includes('CityBuster')) firepower.attacker *= 2;
    if (
      attackerType.flags?.includes('BadWallAttacker') &&
      this.calculateAttackSpecificCityDefenseBonus(attacker, attackerType, defender) > 0
    ) {
      firepower.attacker = Math.min(firepower.attacker, rules.low_firepower_badwallattacker);
    }
    if (defenderType.flags?.includes('BadCityDefender')) {
      firepower.attacker *= 2;
      firepower.defender = Math.min(firepower.defender, rules.low_firepower_pearl_harbor);
    }
  }

  private applyCombatBonusFirepower(
    firepower: { attacker: number; defender: number },
    attackerType: UnitType,
    defenderType: UnitType,
    rules: ReturnType<typeof rulesetLoader.getCombatRules>
  ): void {
    const hasLowFirepowerBonus = attackerType.combatBonuses?.some(
      bonus => bonus.type === 'LowFirepower' && defenderType.flags?.includes(bonus.flag)
    );
    if (hasLowFirepowerBonus) {
      firepower.defender = Math.min(firepower.defender, rules.low_firepower_combat_bonus);
    }
  }

  private applyNonNativeFirepower(
    firepower: { attacker: number; defender: number },
    attacker: Unit,
    defender: Unit,
    attackerType: UnitType,
    defenderType: UnitType,
    rules: ReturnType<typeof rulesetLoader.getCombatRules>
  ): void {
    const attackerTerrain = this.getTerrainAt(attacker.x, attacker.y);
    const defenderTerrain = this.getTerrainAt(defender.x, defender.y);
    const nonNativeTarget = defenderType.rulesetUnitClassFlags.includes('NonNatBombardTgt');
    const cannotEnterTarget = !this.canUnitEnterTerrain(defenderTerrain, attackerType.id);
    const cannotEnterAttackerTerrain =
      !this.canUnitEnterTerrain(attackerTerrain, defenderType.id) ||
      !this.canUnitEnterTerrain(attackerTerrain, attackerType.id);
    if (nonNativeTarget && cannotEnterTarget && cannotEnterAttackerTerrain) {
      firepower.attacker = Math.min(firepower.attacker, rules.low_firepower_nonnat_bombard);
      firepower.defender = Math.min(firepower.defender, rules.low_firepower_nonnat_bombard);
    }
  }

  private calculateAttackSpecificCityDefenseBonus(
    attacker: Unit,
    attackerType: UnitType,
    defender: Unit
  ): number {
    return this.calculateCityDefenseBonusAgainst(attacker, attackerType, defender.x, defender.y);
  }

  /**
   * Freeciv uses the active unit's own veteran system, then applies effects
   * such as c2c3 Tribalism and Magellan's Expedition to combat odds.
   * @reference reference/freeciv/server/unittools.c:219-278
   * @reference reference/freeciv/data/civ2civ3/units.ruleset:70-88
   */
  private async maybePromoteAfterCombat(
    unit: Unit,
    combatOdds: number,
    ownStrength: number,
    opponentStrength: number
  ): Promise<boolean> {
    const rules = rulesetLoader.getCombatRules(this.getRulesetName());
    if (rules.only_real_fight_makes_veteran && (opponentStrength <= 0 || ownStrength <= 0)) {
      return false;
    }
    const scale = rules.combat_odds_scaled_veterancy ? combatOdds : 100;
    return this.maybeGainVeteranLevel(unit, scale, false);
  }

  /**
   * Applies Freeciv's ACTION_GAIN_VETERANCY gate and source-derived chance
   * calculation for either combat or useful worker activity.
   * @reference reference/freeciv/server/unittools.c:238-278
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1430-1435
   */
  private async maybeGainVeteranLevel(
    unit: Unit,
    baseChance: number,
    worker: boolean
  ): Promise<boolean> {
    const unitType = this.unitTypes[unit.unitTypeId];
    if (
      !unitType ||
      unit.veteranLevel + 1 >= getVeteranLevelCount(unitType) ||
      unitType.flags?.includes('NoVeteran') ||
      (worker && !unitType.flags?.includes('Workers'))
    ) {
      return false;
    }

    const veteranLevel = getVeteranLevel(unitType, unit.veteranLevel);
    const raiseChance = worker ? veteranLevel.workRaiseChance : veteranLevel.baseRaiseChance;
    const effectType = worker ? EffectType.VETERAN_WORK : EffectType.VETERAN_COMBAT;
    const effectBonus =
      this.effectsManager?.calculateEffect(
        effectType,
        this.getVeterancyEffectContext(unit, unitType)
      ).value ?? 0;
    const modifier = baseChance + effectBonus;
    const chance = Math.trunc((raiseChance * modifier) / 100);
    if (chance <= 0 || randomInt(this.random, 100) >= chance) return false;

    unit.veteranLevel += 1;
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ veteranLevel: unit.veteranLevel })
      .where(eq(units.id, unit.id));
    return true;
  }

  private async maybePromoteAfterWork(unit: Unit): Promise<boolean> {
    return this.maybeGainVeteranLevel(unit, 100, true);
  }

  /**
   * A diplomatic unit that survives an aggressive mission gets the same
   * source-defined, effect-adjusted veterancy opportunity as Freeciv.
   * @reference reference/freeciv/server/diplomats.c:2414-2426
   */
  async maybePromoteAfterDiplomaticAction(
    unitId: string,
    baseChance: number = 100
  ): Promise<boolean> {
    const unit = this.units.get(unitId);
    return unit ? this.maybeGainVeteranLevel(unit, baseChance, false) : false;
  }

  private getVeterancyEffectContext(unit: Unit, unitType: UnitType): EffectContext {
    const city = this.gameManagerCallback?.getCityAt?.(unit.x, unit.y);
    const playerAI = this.playerAIProvider(unit.playerId);
    return {
      playerId: unit.playerId,
      playerIsAI: playerAI.isAI,
      aiLevel: playerAI.aiLevel,
      government: this.playerGovernmentProvider(unit.playerId),
      action: 'Gain Veterancy',
      unitId: unit.id,
      unitType: unitType.id,
      unitClass: unitType.rulesetUnitClass,
      unitClassFlags: new Set(unitType.rulesetUnitClassFlags),
      unitTypeFlags: new Set(unitType.flags ?? []),
      playerTechs: this.playerTechsProvider(unit.playerId),
      playerBuildings: new Set(this.gameManagerCallback?.getPlayerBuildings?.(unit.playerId) ?? []),
      cityBuildings: new Set(city?.buildings ?? []),
      tileIsCityCenter: Boolean(city),
    };
  }

  /**
   * Fortify a unit (increases defense)
   */
  async fortifyUnit(unitId: string): Promise<void> {
    const unit = this.units.get(unitId);
    if (!unit) {
      throw new Error(`Unit not found: ${unitId}`);
    }
    const result = await this.executeUnitAction(
      unitId,
      ActionType.FORTIFY,
      undefined,
      undefined,
      unit.playerId
    );
    if (!result.success) throw new Error(result.message);
  }

  /**
   * Heal a unit
   */
  async healUnit(unitId: string, amount: number): Promise<void> {
    const unit = this.units.get(unitId);
    if (!unit) {
      throw new Error(`Unit not found: ${unitId}`);
    }

    unit.health = Math.min(100, unit.health + amount);

    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ health: unit.health })
      .where(eq(units.id, unitId));
  }

  /**
   * Reset movement for all units (called at turn start)
   * @reference freeciv/server/unithand.c unit_restore_movepoints()
   */
  async resetMovement(playerId: string): Promise<void> {
    await this.retireEligibleUnits(playerId);
    await this.applyAutomaticUpgrades(playerId);
    for (const unit of [...this.units.values()]) {
      if (unit.playerId === playerId) {
        const unitType = this.unitTypes[unit.unitTypeId];
        if (!(await this.restoreUnitFuel(unit, unitType))) {
          continue;
        }
        // Restore full movement points in fragments
        unit.movementLeft = this.getUnitMovementPoints(
          unit.playerId,
          unitType,
          unit.veteranLevel,
          unit.health
        );

        if (this.effectsManager && unit.health < 100) {
          const { gain } = this.calculateUnitHitpointRecovery(unit);
          unit.health = Math.min(100, unit.health + Math.max(0, gain));
        }
      }
    }

    // Update database for all player units
    for (const unit of this.units.values()) {
      if (unit.playerId === playerId) {
        await this.databaseProvider
          .getDatabase()
          .update(units)
          .set({
            movementPoints: unit.movementLeft.toString(),
            health: unit.health,
            fuel: unit.fuel,
          })
          .where(eq(units.id, unit.id));
      }
    }
  }

  public calculateUnitHitpointRecovery(
    unit: Unit,
    x: number = unit.x,
    y: number = unit.y
  ): UnitHitpointRecovery {
    if (!this.effectsManager) {
      return { regeneration: 0, minimum: 0, secondary: 0, gain: 0 };
    }
    const unitType = this.unitTypes[unit.unitTypeId];
    if (!unitType) return { regeneration: 0, minimum: 0, secondary: 0, gain: 0 };
    const context = this.createHitpointRecoveryContext(unit, unitType, x, y);
    const regeneration = this.effectsManager.calculateEffect(EffectType.HP_REGEN, context).value;
    const minimum = this.effectsManager.calculateEffect(EffectType.MIN_HP_PCT, context).value;
    const secondary = this.effectsManager.calculateEffect(EffectType.HP_REGEN_2, context).value;
    return {
      regeneration,
      minimum,
      secondary,
      gain: Math.max(regeneration, minimum) + secondary,
    };
  }

  private createHitpointRecoveryContext(
    unit: Unit,
    unitType: UnitType,
    x: number,
    y: number
  ): EffectContext {
    const city = this.gameManagerCallback?.getCityAt?.(x, y);
    const tile = this.mapManager?.getTile?.(x, y);
    return {
      playerId: unit.playerId,
      unitType: unit.unitTypeId,
      unitClass: unitType.rulesetUnitClass,
      unitClassFlags: new Set(unitType.rulesetUnitClassFlags),
      unitActivity: unit.fortified ? 'Fortified' : 'Idle',
      tileIsCityCenter: city !== undefined,
      tileExtras: new Set<string>((tile?.improvements ?? []) as string[]),
      cityBuildings: new Set(city?.buildings ?? []),
    };
  }

  /**
   * Consume one turn of fuel and refuel in a friendly city, on a native
   * Refuel extra, or while loaded on a carrier. Fueled units that reach zero
   * away from a refuel point are destroyed.
   * @reference reference/freeciv/server/unittools.c:516-617
   */
  private async restoreUnitFuel(unit: Unit, unitType: UnitType): Promise<boolean> {
    const maximum = unitType.fuel ?? 0;
    if (maximum <= 0) {
      unit.fuel = 0;
      return true;
    }

    unit.fuel = Math.max(0, (unit.fuel ?? maximum) - 1);
    if (this.isUnitBeingRefueled(unit)) {
      unit.fuel = maximum;
      return true;
    }
    if (unit.fuel > 0) return true;

    await this.destroyUnit(unit.id);
    logger.info(`Unit ${unit.id} destroyed after running out of fuel`);
    return false;
  }

  private isUnitBeingRefueled(unit: Unit): boolean {
    if (unit.transportedBy) return true;
    return this.isFriendlyCityRefueling(unit) || this.isAirbaseRefueling(unit);
  }

  private isFriendlyCityRefueling(unit: Unit): boolean {
    const city = this.gameManagerCallback?.getCityAt?.(unit.x, unit.y);
    if (!city || city.playerId === unit.playerId) return Boolean(city);
    return Boolean(this.alliedPlayersProvider?.(unit.playerId).has(city.playerId));
  }

  private isAirbaseRefueling(unit: Unit): boolean {
    const tile = this.mapManager?.getTile?.(unit.x, unit.y);
    const extras = new Set<string>(
      ((tile?.improvements ?? []) as string[]).map(extra => extra.toLowerCase())
    );
    return extras.has('airbase');
  }

  /**
   * Retire idle units using ruleset probability effects.
   * @reference reference/freeciv/server/srv_main.c:1206-1220
   * @reference reference/freeciv/server/unittools.c:5092-5108
   */
  private async retireEligibleUnits(playerId: string): Promise<void> {
    const currentTurn = this.currentTurnProvider?.();
    if (!this.effectsManager || currentTurn === undefined) return;
    const nationGroups = await this.getPlayerNationGroups(playerId);

    for (const unit of [...this.units.values()]) {
      if (unit.playerId !== playerId || this.hasForeignUnitOrCityNearby(unit, 3)) continue;
      await this.retireUnitIfEligible(unit, playerId, currentTurn, nationGroups);
    }
  }

  private async retireUnitIfEligible(
    unit: Unit,
    playerId: string,
    currentTurn: number,
    nationGroups: Set<string>
  ): Promise<void> {
    const tile = this.mapManager?.getTile?.(unit.x, unit.y);
    const city = this.gameManagerCallback?.getCityAt?.(unit.x, unit.y);
    const adjacentTerrainClasses = this.getAdjacentTerrainClasses(unit);
    const retirementChance = this.effectsManager!.calculateEffect(EffectType.RETIRE_PCT, {
      playerId,
      unitId: unit.id,
      unitType: unit.unitTypeId,
      age: currentTurn - (unit.createdTurn ?? currentTurn),
      playerNationGroups: nationGroups,
      tileTerrain: tile?.terrain,
      tileTerrainClass: tile ? this.getTerrainClass(tile.terrain) : undefined,
      adjacentTerrainClasses,
      tileIsCityCenter: Boolean(city),
      maxUnitsOnTile: this.getUnitsAt(unit.x, unit.y).filter(candidate => !candidate.transportedBy)
        .length,
    }).value;
    if (retirementChance > 0 && randomInt(this.random, 100) < retirementChance) {
      await this.destroyUnit(unit.id);
    }
  }

  private getAdjacentTerrainClasses(unit: Unit): Set<string> {
    const classes = new Set<string>();
    for (const position of this.getMapTopology().getNeighbors(unit.x, unit.y)) {
      const adjacent = this.mapManager?.getTile?.(position.x, position.y);
      if (adjacent) classes.add(this.getTerrainClass(adjacent.terrain));
    }
    return classes;
  }

  private hasForeignUnitOrCityNearby(unit: Unit, radius: number): boolean {
    const positions = this.getMapTopology().getPositionsWithinRadius(unit.x, unit.y, radius);
    for (const { x, y } of positions) {
      const city = this.gameManagerCallback?.getCityAt?.(x, y);
      if (city && city.playerId !== unit.playerId) return true;
      if (this.getUnitsAt(x, y).some(candidate => candidate.playerId !== unit.playerId)) {
        return true;
      }
    }
    return false;
  }

  private getTerrainClass(terrain: TerrainType): string {
    return rulesetLoader.getTerrain(terrain, this.getRulesetName()).properties?.MG_OCEAN_DEPTH !==
      undefined
      ? 'Oceanic'
      : 'Land';
  }

  private async getPlayerNationGroups(playerId: string): Promise<Set<string>> {
    const playersQuery = (this.databaseProvider.getDatabase() as any).query?.players;
    if (typeof playersQuery?.findFirst !== 'function') return new Set();
    const player = await playersQuery.findFirst({ where: eq(players.id, playerId) });
    if (!player?.nation) return new Set();
    try {
      const nation = rulesetLoader.getNation(player.nation);
      return new Set([nation.class, ...(nation.groups ?? [])]);
    } catch {
      return new Set();
    }
  }

  /**
   * Get all units for a player
   */
  getPlayerUnits(playerId: string): Unit[] {
    return Array.from(this.units.values()).filter(u => u.playerId === playerId);
  }

  /**
   * Reconcile units when a city changes owner.
   *
   * @reference reference/freeciv/server/citytools.c:721-820
   * Units on the transferred city tile change owner. Units supported by the
   * city are rehomed when they are in another friendly city, transferred when
   * they are nearby, and removed when they are outside the transfer radius.
   */
  async reconcileCityOwnership(
    city: { id: string; x: number; y: number },
    oldPlayerId: string,
    newPlayerId: string
  ): Promise<void> {
    if (oldPlayerId === newPlayerId) return;

    const candidates = this.getPlayerUnits(oldPlayerId).filter(
      unit => (unit.x === city.x && unit.y === city.y) || unit.homeCityId === city.id
    );
    const tileUnits = candidates
      .filter(unit => unit.x === city.x && unit.y === city.y)
      .sort(
        (left, right) => Number(Boolean(left.transportedBy)) - Number(Boolean(right.transportedBy))
      );

    for (const unit of tileUnits) {
      if (!this.units.has(unit.id) || unit.playerId !== oldPlayerId) continue;
      await this.bribeUnit(unit.id, newPlayerId, unit.homeCityId ? city.id : undefined);
      for (const cargoId of unit.cargoUnits ?? []) {
        const cargo = this.units.get(cargoId);
        if (!cargo || cargo.playerId !== oldPlayerId) continue;
        await this.bribeUnit(cargo.id, newPlayerId, cargo.homeCityId ? city.id : undefined);
      }
    }

    for (const unit of candidates) {
      if (!this.units.has(unit.id) || unit.playerId !== oldPlayerId) continue;
      if (unit.homeCityId !== city.id) continue;

      const localCity = this.gameManagerCallback?.getCityAt?.(unit.x, unit.y);
      if (localCity && localCity.id !== city.id && localCity.playerId === oldPlayerId) {
        await this.rehomeUnit(unit, localCity.id);
        continue;
      }

      if (this.getRealDistance(unit.x, unit.y, city.x, city.y) <= 1) {
        await this.bribeUnit(unit.id, newPlayerId, city.id);
      } else {
        await this.removeUnit(unit.id);
      }
    }
  }

  /** Place ruleset Partisan units around a conquered city. */
  async createPartisans(
    playerId: string,
    city: { x: number; y: number },
    count: number,
    radius: number
  ): Promise<Unit[]> {
    const partisanType = this.unitTypes.partisan;
    if (!partisanType || count <= 0) return [];

    const candidates: Array<{ x: number; y: number }> = [];
    for (let y = city.y - radius; y <= city.y + radius; y += 1) {
      for (let x = city.x - radius; x <= city.x + radius; x += 1) {
        if ((x === city.x && y === city.y) || !this.isValidPosition(x, y)) continue;
        if (!this.canUnitEnterTerrain(this.getTerrainAt(x, y), partisanType.id)) continue;
        if (this.gameManagerCallback?.getCityAt?.(x, y)) continue;
        candidates.push({ x, y });
      }
    }

    const created: Unit[] = [];
    while (created.length < count && candidates.length > 0) {
      const index = randomInt(this.random, candidates.length);
      const [position] = candidates.splice(index, 1);
      if (!position) break;
      created.push(await this.createUnit(playerId, partisanType.id, position.x, position.y));
    }
    return created;
  }

  private async rehomeUnit(unit: Unit, homeCityId: string): Promise<void> {
    unit.homeCityId = homeCityId;
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ homeCityId })
      .where(eq(units.id, unit.id));
  }

  private getRealDistance(x1: number, y1: number, x2: number, y2: number): number {
    return (
      this.mapManager?.getTopology?.().realDistance(x1, y1, x2, y2) ??
      Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2))
    );
  }

  /**
   * Get unit at specific position
   */
  getUnitAt(x: number, y: number): Unit | undefined {
    return Array.from(this.units.values()).find(u => u.x === x && u.y === y);
  }

  /**
   * Get all units at specific position (for stacking)
   */
  getUnitsAt(x: number, y: number): Unit[] {
    return Array.from(this.units.values()).filter(u => u.x === x && u.y === y);
  }

  async setWorkerAutomationTask(
    unitId: string,
    task: WorkerAutomationTask | undefined
  ): Promise<void> {
    const unit = this.units.get(unitId);
    if (!unit || unit.automation !== 'worker') return;
    const previousTask = unit.automationTask;
    unit.automationTask = task;
    if (!task && previousTask && this.ordersBelongToWorkerTask(unit, previousTask)) {
      unit.orders = [{ type: 'autoSettler' }];
      unit.activity = { type: 'idle', turnsRemaining: 0, totalTurns: 0 };
    }
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
        automationMode: 'worker',
        automationTask: task ?? null,
        isAutomated: true,
        orders: unit.orders ?? [],
        currentOrder: unit.orders?.[0]?.type ?? null,
      })
      .where(eq(units.id, unit.id));
  }

  async clearPlayerAutomation(playerId: string): Promise<void> {
    for (const unit of this.getPlayerUnits(playerId)) {
      if (unit.automation) await this.clearAutomation(unit);
    }
  }

  broadcastUnitInfo(unitId: string): void {
    const unit = this.units.get(unitId);
    if (unit) this.gameManagerCallback?.broadcastUnitInfo?.(this.gameId, unit);
  }

  private ordersBelongToWorkerTask(unit: Unit, task: WorkerAutomationTask): boolean {
    const first = unit.orders?.[0];
    if (!first || first.type === 'autoSettler') return false;
    if (first.type === 'move') {
      return first.targetX === task.targetX && first.targetY === task.targetY;
    }
    const orderByAction: Partial<Record<ActionType, UnitOrder['type']>> = {
      [ActionType.BUILD_ROAD]: 'road',
      [ActionType.BUILD_RAILROAD]: 'railroad',
      [ActionType.BUILD_IRRIGATION]: 'irrigate',
      [ActionType.BUILD_MINE]: 'mine',
      [ActionType.CULTIVATE]: 'cultivate',
      [ActionType.PLANT]: 'plant',
      [ActionType.TRANSFORM_TERRAIN]: 'transform',
      [ActionType.CLEAN_POLLUTION]: 'cleanPollution',
    };
    return orderByAction[task.action] === first.type;
  }

  /**
   * Load units from database
   */
  async loadUnits(): Promise<void> {
    const dbUnits = await this.databaseProvider
      .getDatabase()
      .select()
      .from(units)
      .where(eq(units.gameId, this.gameId));

    for (const dbUnit of dbUnits) {
      const unitType = this.unitTypes[dbUnit.unitType];
      if (!unitType) {
        logger.warn(`Unknown unit type: ${dbUnit.unitType} for unit ${dbUnit.id}`);
        continue; // Skip invalid unit types
      }
      const unit = this.createLoadedUnit(dbUnit, unitType);
      this.units.set(unit.id, unit);
    }

    logger.info(`Loaded ${this.units.size} units for game ${this.gameId}`);
  }

  private createLoadedUnit(dbUnit: typeof units.$inferSelect, unitType: UnitType): Unit {
    return {
      id: dbUnit.id,
      gameId: dbUnit.gameId,
      playerId: dbUnit.playerId,
      unitTypeId: dbUnit.unitType,
      x: dbUnit.x,
      y: dbUnit.y,
      movementLeft: Math.min(
        parseFloat(dbUnit.movementPoints) || 0,
        this.getUnitMovementPoints(dbUnit.playerId, unitType, dbUnit.veteranLevel, dbUnit.health)
      ),
      fuel: this.getLoadedFuel(dbUnit.fuel, unitType),
      health: dbUnit.health,
      veteranLevel: dbUnit.veteranLevel,
      experience: dbUnit.experience || 0,
      fortified: dbUnit.isFortified,
      orders: this.parseLoadedOrders(dbUnit.orders),
      transportedBy: dbUnit.transportedBy ?? undefined,
      cargoUnits: Array.isArray(dbUnit.cargoUnits) ? (dbUnit.cargoUnits as string[]) : [],
      homeCityId: dbUnit.homeCityId ?? undefined,
      createdTurn: dbUnit.createdTurn,
      lastActionTurn: dbUnit.lastActionTurn ?? undefined,
      automation: this.getLoadedAutomation(
        dbUnit.automationMode,
        dbUnit.isAutomated,
        dbUnit.currentOrder,
        this.parseLoadedOrders(dbUnit.orders)
      ),
      automationTask: isWorkerAutomationTask(dbUnit.automationTask)
        ? dbUnit.automationTask
        : undefined,
    };
  }

  private getLoadedFuel(fuel: number | null, unitType: UnitType): number {
    return Math.min(fuel ?? unitType.fuel ?? 0, unitType.fuel ?? 0);
  }

  private getLoadedAutomation(
    automationMode: string | null,
    isAutomated: boolean,
    currentOrder: string | null,
    orders: UnitOrder[]
  ): UnitAutomationMode | undefined {
    if (automationMode === 'explore' || automationMode === 'worker') return automationMode;
    if (automationMode === 'settler') return 'worker';
    if (!isAutomated) return undefined;
    if (currentOrder === 'autoSettler' || orders.some(order => order.type === 'autoSettler')) {
      return 'worker';
    }
    if (currentOrder === 'autoExplore' || orders.some(order => order.type === 'autoExplore')) {
      return 'explore';
    }
    return undefined;
  }

  private parseLoadedOrders(orders: unknown): UnitOrder[] {
    if (Array.isArray(orders)) return orders as UnitOrder[];
    if (typeof orders === 'string' && orders.trim()) return JSON.parse(orders) as UnitOrder[];
    return [];
  }

  /**
   * Calculate attack power with veteran bonuses.
   * @reference reference/freeciv/common/combat.c:608-647
   */
  private calculateAttackStrength(unit: Unit, unitType: UnitType): number {
    const veteranLevel = getVeteranLevel(unitType, unit.veteranLevel);
    let strength = Math.floor((unitType.attack ?? unitType.combat) * veteranLevel.powerFactor);
    const combatRules = rulesetLoader.getCombatRules(this.getRulesetName());
    const moveFragments = this.getMoveFragments();
    if (combatRules.tired_attack && unit.movementLeft < moveFragments) {
      strength = Math.floor((strength * Math.max(0, unit.movementLeft)) / moveFragments);
    }
    return Math.max(0, strength);
  }

  /**
   * Calculate defense power with veteran, terrain, fortify, and city bonuses.
   * Kept under the established name because focused ruleset tests exercise it.
   * @reference reference/freeciv/common/combat.c:650-708
   * @reference freeciv/common/combat.c defense_multiplication() / EFT_FORTIFY_DEFENSE_BONUS
   */
  private calculateCombatStrength(
    unit: Unit,
    unitType: UnitType,
    attacker?: Unit,
    attackerType?: UnitType
  ): number {
    let strength = unitType.defense ?? unitType.combat;

    const veteranLevel = getVeteranLevel(unitType, unit.veteranLevel);
    strength = Math.floor(strength * veteranLevel.powerFactor);

    strength = this.applyCombatBonusStrength(strength, unitType, attackerType);
    strength = this.applyTerrainAndFortressStrength(strength, unit, unitType);
    strength = this.applyDefensiveStrengthBonuses(strength, unit, unitType, attacker, attackerType);
    return Math.max(0, strength);
  }

  private applyCombatBonusStrength(
    strength: number,
    unitType: UnitType,
    attackerType?: UnitType
  ): number {
    if (!attackerType) return strength;
    const defenseMultiplier =
      1 +
      (unitType.combatBonuses ?? [])
        .filter(
          bonus => bonus.type === 'DefenseMultiplier' && attackerType.flags?.includes(bonus.flag)
        )
        .reduce((sum, bonus) => sum + bonus.value, 0);
    const defenseDivider =
      1 +
      (attackerType.combatBonuses ?? [])
        .filter(bonus => bonus.type === 'DefenseDivider' && unitType.flags?.includes(bonus.flag))
        .reduce((sum, bonus) => sum + bonus.value, 0);
    return Math.floor((strength * defenseMultiplier) / Math.max(1, defenseDivider));
  }

  private applyTerrainAndFortressStrength(
    strength: number,
    unit: Unit,
    unitType: UnitType
  ): number {
    strength = this.applyTerrainDefenseStrength(strength, unit, unitType);
    return this.applyFortressStrength(strength, unit, unitType);
  }

  private applyTerrainDefenseStrength(strength: number, unit: Unit, unitType: UnitType): number {
    if (!unitType.rulesetUnitClassFlags.includes('TerrainDefense')) return strength;
    const terrainDefense = rulesetLoader.getTerrain(
      this.getTerrainAt(unit.x, unit.y),
      this.getRulesetName()
    ).defense;
    return Math.floor((strength * (100 + terrainDefense)) / 100);
  }

  private applyFortressStrength(strength: number, unit: Unit, unitType: UnitType): number {
    if (!this.isFortressDefender(unit, unitType)) return strength;
    const fortressDefense = Number(
      rulesetLoader.getExtra('Fortress', this.effectsManager?.getRulesetName() ?? 'classic')
        ?.defense_bonus ?? 0
    );
    return Math.floor((strength * (100 + fortressDefense)) / 100);
  }

  private isFortressDefender(unit: Unit, unitType: UnitType): boolean {
    const improvements = this.mapManager?.getTile?.(unit.x, unit.y)?.improvements ?? [];
    return unitType.rulesetUnitClass === 'Land' && improvements.includes('fortress');
  }

  private applyDefensiveStrengthBonuses(
    strength: number,
    unit: Unit,
    unitType: UnitType,
    attacker?: Unit,
    attackerType?: UnitType
  ): number {
    const fortified = this.calculateFortifyDefenseBonus(unit, unitType);
    const withFortify = Math.floor((strength * (100 + fortified)) / 100);
    const city = this.calculateCityDefenseBonus(unit, unitType, attacker, attackerType);
    return Math.floor((withFortify * (100 + city)) / 100);
  }

  /**
   * Classic Fortify_Defense_Bonus for fortified units and city-center land defenders.
   * @reference reference/freeciv/data/classic/effects.ruleset:157-173
   * @reference reference/freeciv/common/combat.c:697-708
   */
  private calculateFortifyDefenseBonus(unit: Unit, unitType: UnitType): number {
    const effectsManager = this.effectsManager;
    if (!effectsManager) return 0;

    const city = this.gameManagerCallback?.getCityAt?.(unit.x, unit.y);
    const tileIsCityCenter = Boolean(city && city.playerId === unit.playerId);

    return this.calculateFortifyEffect(
      unit,
      unitType,
      city ?? undefined,
      tileIsCityCenter,
      effectsManager
    );
  }

  private calculateFortifyEffect(
    unit: Unit,
    unitType: UnitType,
    city: CityAtLocation | undefined,
    tileIsCityCenter: boolean,
    effectsManager: EffectsManager
  ): number {
    return effectsManager.calculateEffect(EffectType.FORTIFY_DEFENSE_BONUS, {
      playerId: unit.playerId,
      unitId: unit.id,
      unitType: unit.unitTypeId,
      unitClass: unitType.rulesetUnitClass,
      unitClassFlags: new Set(unitType.rulesetUnitClassFlags ?? []),
      unitTypeFlags: new Set(unitType.flags),
      unitActivity: unit.fortified ? 'Fortified' : 'Idle',
      tileX: unit.x,
      tileY: unit.y,
      tileIsCityCenter,
      cityBuildings: new Set(city?.buildings ?? []),
      playerBuildings: new Set(this.gameManagerCallback?.getPlayerBuildings?.(unit.playerId) ?? []),
    }).value;
  }

  private calculateCityDefenseBonus(
    unit: Unit,
    unitType: UnitType,
    attacker?: Unit,
    attackerType?: UnitType
  ): number {
    const effectsManager = this.effectsManager;
    const city = this.gameManagerCallback?.getCityAt?.(unit.x, unit.y);
    if (!city || city.playerId !== unit.playerId || !effectsManager) return 0;

    return this.calculateCityDefenseEffect(
      unit,
      unitType,
      attacker,
      attackerType,
      city,
      effectsManager
    );
  }

  private calculateCityDefenseEffect(
    unit: Unit,
    unitType: UnitType,
    attacker: Unit | undefined,
    attackerType: UnitType | undefined,
    city: CityAtLocation,
    effectsManager: EffectsManager
  ): number {
    const combatUnit = attacker ?? unit;
    const combatType = attackerType ?? unitType;
    return effectsManager.calculateEffect(EffectType.DEFEND_BONUS, {
      playerId: unit.playerId,
      unitId: combatUnit.id,
      unitType: combatUnit.unitTypeId,
      unitClass: combatType.rulesetUnitClass,
      unitClassFlags: new Set(combatType.rulesetUnitClassFlags),
      unitTypeFlags: new Set(combatType.flags),
      tileX: unit.x,
      tileY: unit.y,
      tileIsCityCenter: true,
      cityBuildings: new Set(city.buildings ?? []),
      playerBuildings: new Set(this.gameManagerCallback?.getPlayerBuildings?.(unit.playerId) ?? []),
    }).value;
  }

  /**
   * Expose the authoritative combat ratings used by AI advisors. Keeping
   * these here prevents planning from drifting from terrain, fortification,
   * city, veteran, hit-point, and firepower rules used by real combat.
   */
  calculateUnitAttackRating(unit: Unit): number {
    const type = this.unitTypes[unit.unitTypeId];
    if (!type) return 0;
    const hitpoints = Math.max(1, type.hitpoints ?? 10) * Math.max(0.01, unit.health / 100);
    return this.calculateAttackStrength(unit, type) * hitpoints * Math.max(1, type.firepower ?? 1);
  }

  calculateUnitDefenseRating(unit: Unit, attacker?: Unit): number {
    const type = this.unitTypes[unit.unitTypeId];
    if (!type) return 0;
    const attackerType = attacker ? this.unitTypes[attacker.unitTypeId] : undefined;
    const hitpoints = Math.max(1, type.hitpoints ?? 10) * Math.max(0.01, unit.health / 100);
    const firepower =
      attacker && attackerType
        ? this.calculateModifiedFirepower(attacker, unit, attackerType, type).defender
        : Math.max(1, type.firepower ?? 1);
    return this.calculateCombatStrength(unit, type, attacker, attackerType) * hitpoints * firepower;
  }

  /**
   * Exact classic repeated-round combat win probability, using the same
   * authoritative powers and situational firepower as real combat.
   *
   * @reference reference/freeciv/common/combat.c:334-401 win_chance
   * @reference reference/freeciv/common/combat.c:480-497 unit_win_chance
   */
  calculateUnitWinChance(attacker: Unit, defender: Unit): number {
    const attackerType = this.unitTypes[attacker.unitTypeId];
    const defenderType = this.unitTypes[defender.unitTypeId];
    if (!attackerType || !defenderType) return 0;
    const attack = this.calculateAttackStrength(attacker, attackerType);
    const defense = this.calculateCombatStrength(defender, defenderType, attacker, attackerType);
    const firepower = this.calculateModifiedFirepower(
      attacker,
      defender,
      attackerType,
      defenderType
    );
    const attackerHp = Math.max(
      1,
      Math.ceil((Math.max(1, attackerType.hitpoints ?? 10) * attacker.health) / 100)
    );
    const defenderHp = Math.max(
      1,
      Math.ceil((Math.max(1, defenderType.hitpoints ?? 10) * defender.health) / 100)
    );
    const attackerLossRounds = Math.ceil(attackerHp / Math.max(1, firepower.defender));
    const defenderLossRounds = Math.ceil(defenderHp / Math.max(1, firepower.attacker));
    const attackerRoundLoss = attack + defense === 0 ? 0.5 : defense / (attack + defense);
    const defenderRoundLoss = 1 - attackerRoundLoss;
    let term = Math.pow(defenderRoundLoss, defenderLossRounds - 1);
    let probability = term;
    for (let lostRounds = 1; lostRounds < attackerLossRounds; lostRounds++) {
      term *= (lostRounds + defenderLossRounds - 1) / lostRounds;
      term *= attackerRoundLoss;
      probability += term;
    }
    return Math.max(0, Math.min(1, probability * defenderRoundLoss));
  }

  /**
   * Resolve Freeciv's reachable-unit-class targeting. Classes without the
   * Unreachable flag are implicit targets; unreachable classes require an
   * explicit target entry unless the defender is in a city or native base.
   *
   * @reference reference/freeciv/server/ruleset/ruleload.c:2314-2387
   * @reference reference/freeciv/common/aicore/pf_tools.c:50-81
   */
  canUnitTargetUnit(attacker: Unit, defender: Unit): boolean {
    const attackerType = this.unitTypes[attacker.unitTypeId];
    const defenderType = this.unitTypes[defender.unitTypeId];
    if (!attackerType || !defenderType) return false;
    if (!defenderType.rulesetUnitClassFlags.includes('Unreachable')) return true;
    if (attackerType.targetClasses?.includes(defenderType.rulesetUnitClass ?? '')) return true;
    return this.canTargetUnreachableDefender(defender, defenderType);
  }

  private canTargetUnreachableDefender(defender: Unit, defenderType: UnitType): boolean {
    if (this.gameManagerCallback?.getCityAt?.(defender.x, defender.y)) return true;
    const extras = new Set(
      ((this.mapManager?.getTile?.(defender.x, defender.y)?.improvements ?? []) as string[]).map(
        extra => extra.toLowerCase()
      )
    );
    return defenderType.unitClass === 'air' && extras.has('airbase');
  }

  calculateCityDefenseBonusAgainst(
    attacker: Unit,
    attackerType: UnitType,
    cityX: number,
    cityY: number
  ): number {
    const city = this.gameManagerCallback?.getCityAt?.(cityX, cityY);
    if (!city || !this.effectsManager) return 0;
    return this.effectsManager.calculateEffect(EffectType.DEFEND_BONUS, {
      playerId: city.playerId,
      unitId: attacker.id,
      unitType: attacker.unitTypeId,
      unitClass: attackerType.rulesetUnitClass,
      unitClassFlags: new Set(attackerType.rulesetUnitClassFlags),
      unitTypeFlags: new Set(attackerType.flags),
      tileX: cityX,
      tileY: cityY,
      tileIsCityCenter: true,
      cityBuildings: new Set(city.buildings ?? []),
      playerBuildings: new Set(this.gameManagerCallback?.getPlayerBuildings?.(city.playerId) ?? []),
    }).value;
  }

  /**
   * Retain experience bookkeeping for clients that display it. Freeciv does
   * not promote from an accumulated experience table: authoritative combat,
   * worker, and diplomatic opportunities call maybeGainVeteranLevel().
   * @reference reference/freeciv/server/unittools.c:238-278
   */
  async awardExperience(unitId: string, experiencePoints: number): Promise<boolean> {
    const unit = this.units.get(unitId);
    if (!unit) {
      return false;
    }

    unit.experience += experiencePoints;
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ experience: unit.experience })
      .where(eq(units.id, unitId));
    return false;
  }

  /**
   * Calculate experience gained from combat
   * @reference freeciv/server/unittools.c unit_versus_unit()
   */
  calculateCombatExperience(attacker: Unit, defender: Unit, attackerWon: boolean): number {
    const attackerType = this.unitTypes[attacker.unitTypeId];
    const defenderType = this.unitTypes[defender.unitTypeId];

    if (!attackerType || !defenderType) {
      return 0;
    }

    // Base experience depends on relative unit strength
    const attackerStr = attackerType.combat;
    const defenderStr = defenderType.combat;

    let baseExp: number;

    if (attackerWon) {
      // Winner gets more experience for defeating stronger units
      if (defenderStr >= attackerStr) {
        baseExp = 2 + Math.floor(defenderStr / attackerStr);
      } else {
        baseExp = 1;
      }
    } else {
      // Loser gets minimal experience for surviving
      baseExp = 1;
    }

    // Bonus for veteran level difference
    const levelDiff = defender.veteranLevel - attacker.veteranLevel;
    if (levelDiff > 0) {
      baseExp += levelDiff;
    }

    return Math.max(1, Math.min(10, baseExp)); // Cap at 10 experience points
  }

  /**
   * Calculate distance between two points
   */
  private calculateDistance(x1: number, y1: number, x2: number, y2: number): number {
    return this.getMapTopology().realDistance(x1, y1, x2, y2);
  }

  private getMapTopology(): MapTopology {
    const topology = this.mapManager?.getTopology?.();
    if (topology) return topology;

    const mapData = this.mapManager?.getMapData?.();
    return new MapTopology(this.mapWidth, this.mapHeight, {
      topologyId: mapData?.topologyId,
      wrapId: mapData?.wrapId,
    });
  }

  /**
   * Get terrain at specific coordinates
   * @param x X coordinate
   * @param y Y coordinate
   * @returns terrain type string
   */
  private getTerrainAt(x: number, y: number): TerrainType {
    if (!this.mapManager) {
      return 'plains'; // Default terrain if no map manager
    }

    try {
      const tile = this.mapManager.getTile(x, y);
      return (tile?.terrain as TerrainType | undefined) || 'plains';
    } catch (error) {
      logger.warn(`Failed to get terrain at (${x}, ${y}):`, error);
      return 'plains';
    }
  }

  /**
   * Calculate movement cost between two positions in movement fragments
   * @reference freeciv/common/movement.c map_move_cost_unit()
   */
  private calculateTerrainMovementCost(
    unit: Unit,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ): number {
    return this.movementCosts.calculateTerrainCost(unit, fromX, fromY, toX, toY);
  }

  private canUnitEnterTerrain(terrain: TerrainType, unitTypeId: string): boolean {
    return this.movementCosts.canEnterTerrain(terrain, unitTypeId);
  }

  /** @reference reference/freeciv/data/civ2civ3/terrain.ruleset:74-79 */
  getMoveFragments(): number {
    return getRulesetMoveFragments(this.getRulesetName());
  }

  /**
   * Get unit type maximum movement points
   */
  private getUnitMovementPoints(
    playerId: string,
    unitType: UnitType,
    veteranLevel: number = 0,
    health: number = 100
  ): number {
    return this.movementCosts.getMaximumMovement(playerId, unitType, veteranLevel, health);
  }

  getUnitMaxMovement(unitTypeId: string): number {
    const unitType = this.unitTypes[unitTypeId];
    return (unitType?.movement ?? 1) * this.getMoveFragments();
  }

  getPathStepCost(
    unit: Unit,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    isDestination: boolean
  ): number {
    // Freeciv's peaceful-border restriction applies to military units only;
    // civilian units such as settlers may cross foreign territory.
    // @reference reference/freeciv/common/movement.c:764-767
    if (
      !this.isCivilianUnit(unit) &&
      this.isPeacefulForeignTerritory(unit, toX, toY) &&
      !(isDestination && this.hasHostileCityAt(unit, toX, toY))
    ) {
      return -1;
    }
    if (
      this.hasHostileUnitAt(unit, toX, toY) &&
      !(isDestination && this.canUnitAttackForeignUnit(unit))
    )
      return -1;
    // A military Go To may end on a foreign city. The actual move still
    // performs the diplomatic/war validation, but the path preview must be
    // able to reach the city and let the player see why it is blocked.
    if (
      this.hasHostileCityAt(unit, toX, toY) &&
      !(isDestination && this.canUnitCaptureCity(this.unitTypes[unit.unitTypeId]))
    ) {
      return -1;
    }
    if (!this.canMoveWithZoneOfControlFrom(unit, fromX, fromY, toX, toY)) return -1;

    const movementCost = this.calculateTerrainMovementCost(unit, fromX, fromY, toX, toY);
    if (movementCost >= 0) return movementCost;

    // Embarkation is a valid final path step. Continuing beyond it would
    // require modelling the transport's own route rather than the cargo's.
    return isDestination && this.findAvailableTransportAt(unit, toX, toY)
      ? this.getMoveFragments()
      : -1;
  }

  private hasHostileUnitAt(unit: Unit, x: number, y: number): boolean {
    return this.getUnitsAt(x, y).some(
      candidate =>
        candidate.playerId !== unit.playerId &&
        !this.alliedPlayersProvider?.(unit.playerId).has(candidate.playerId)
    );
  }

  private hasHostileCityAt(unit: Unit, x: number, y: number): boolean {
    const city = this.gameManagerCallback?.getCityAt?.(x, y);
    return Boolean(
      city &&
      city.playerId !== unit.playerId &&
      !this.alliedPlayersProvider?.(unit.playerId).has(city.playerId)
    );
  }

  private isPeacefulForeignTerritory(unit: Unit, x: number, y: number): boolean {
    const owner = this.mapManager?.getTile?.(x, y)?.owner;
    return Boolean(
      owner &&
      owner !== unit.playerId &&
      !this.alliedPlayersProvider?.(unit.playerId).has(owner) &&
      !this.hostilePlayersProvider?.(unit.playerId).has(owner)
    );
  }

  private isCivilianUnit(unit: Unit): boolean {
    const type = this.unitTypes[unit.unitTypeId];
    return type?.unitClass === 'civilian' || type?.flags?.includes('NonMil') === true;
  }

  private canUnitAttackForeignUnit(unit: Unit): boolean {
    const type = this.unitTypes[unit.unitTypeId];
    return Boolean(type && !this.isCivilianUnit(unit) && (type.attack ?? type.combat) > 0);
  }

  canContinuePathFrom(unit: Unit, x: number, y: number): boolean {
    return this.calculateTerrainMovementCost(unit, x, y, x, y) >= 0;
  }

  /**
   * Check if position is valid
   */
  private isValidPosition(x: number, y: number): boolean {
    return (
      this.mapManager?.getTopology?.().isValidCoordinate(x, y) ??
      (x >= 0 && x < this.mapWidth && y >= 0 && y < this.mapHeight)
    );
  }

  /**
   * Destroy a unit
   */
  private async destroyUnit(unitId: string): Promise<void> {
    const unit = this.units.get(unitId);
    if (!unit) return;

    const cargo = [...(unit.cargoUnits ?? [])]
      .map(cargoId => this.units.get(cargoId))
      .filter((cargoUnit): cargoUnit is Unit => Boolean(cargoUnit));
    if (cargo.length > 0) {
      await this.resolveTransportLoss(unit, cargo);
    }
    for (const cargoUnit of cargo) {
      if (this.units.has(cargoUnit.id) && cargoUnit.transportedBy === unit.id) {
        await this.destroyUnit(cargoUnit.id);
      }
    }
    if (unit.cargoUnits?.length) {
      unit.cargoUnits = [];
    }
    if (unit.transportedBy) {
      const transport = this.units.get(unit.transportedBy);
      if (transport) {
        transport.cargoUnits = (transport.cargoUnits ?? []).filter(id => id !== unitId);
        await this.databaseProvider
          .getDatabase()
          .update(units)
          .set({ cargoUnits: transport.cargoUnits })
          .where(eq(units.id, transport.id));
      }
    }
    await this.recordPlayerStatistic(unit.playerId, 'unitsLost');
    this.units.delete(unitId);
    await this.databaseProvider.getDatabase().delete(units).where(eq(units.id, unitId));
    this.identities.releaseUuid(unitId);
    // All authoritative removals, including combat collateral and cargo loss,
    // pass through this method. Notify once here so clients and AI lifecycle
    // state cannot miss a path or receive duplicate path-specific events.
    this.notifyUnitLifecycle({ type: 'destroyed', unit });
    if (this.isGameLossUnit(unit)) await this.gameLossHandler?.(unit.playerId);
    logger.info(`Unit ${unitId} destroyed`);
  }

  private isGameLossUnit(unit: Unit): boolean {
    const unitType = this.unitTypes[unit.unitTypeId];
    return Boolean(
      unitType?.rulesetUnitClassFlags.includes('GameLoss') || unitType?.flags?.includes('GameLoss')
    );
  }

  private async resolveTransportLoss(transport: Unit, cargo: Unit[]): Promise<void> {
    const orderedCargo = [...cargo].sort((left, right) => {
      const priority = (unit: Unit): number => {
        const unitType = this.unitTypes[unit.unitTypeId];
        const flags = [...(unitType?.rulesetUnitClassFlags ?? []), ...(unitType?.flags ?? [])];
        return flags.includes('GameLoss') ? 0 : flags.includes('EvacuateFirst') ? 1 : 2;
      };
      return priority(left) - priority(right) || left.id.localeCompare(right.id);
    });

    for (const cargoUnit of orderedCargo) {
      await this.tryRescueCargo(transport, cargoUnit);
    }
  }

  private async tryRescueCargo(transport: Unit, cargo: Unit): Promise<boolean> {
    const transportDestination = this.findCargoRescueTransport(transport, cargo);
    if (transportDestination) {
      await this.detachCargoFromTransport(cargo, transport);
      cargo.transportedBy = transportDestination.id;
      cargo.x = transportDestination.x;
      cargo.y = transportDestination.y;
      cargo.movementLeft = 0;
      transportDestination.cargoUnits ??= [];
      transportDestination.cargoUnits.push(cargo.id);
      await this.databaseProvider
        .getDatabase()
        .update(units)
        .set({
          transportedBy: transportDestination.id,
          x: cargo.x,
          y: cargo.y,
          movementPoints: '0',
        })
        .where(eq(units.id, cargo.id));
      await this.databaseProvider
        .getDatabase()
        .update(units)
        .set({ cargoUnits: transportDestination.cargoUnits })
        .where(eq(units.id, transportDestination.id));
      this.notifyUnitLifecycle({
        type: 'moved',
        unit: cargo,
        previousX: transport.x,
        previousY: transport.y,
      });
      return true;
    }

    const destination = this.findCargoRescueTile(transport, cargo);
    if (!destination) return false;
    await this.detachCargoFromTransport(cargo, transport);
    cargo.transportedBy = undefined;
    cargo.x = destination.x;
    cargo.y = destination.y;
    cargo.movementLeft = 0;
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ transportedBy: null, x: cargo.x, y: cargo.y, movementPoints: '0' })
      .where(eq(units.id, cargo.id));
    this.notifyUnitLifecycle({
      type: 'moved',
      unit: cargo,
      previousX: transport.x,
      previousY: transport.y,
    });
    return true;
  }

  private findCargoRescueTransport(transport: Unit, cargo: Unit): Unit | undefined {
    return [...this.units.values()]
      .filter(candidate => {
        if (
          candidate.id === transport.id ||
          candidate.id === cargo.id ||
          candidate.playerId !== cargo.playerId ||
          candidate.transportedBy ||
          this.getTransportCapacityRemaining(candidate.id) <= 0
        ) {
          return false;
        }
        if (this.calculateDistance(transport.x, transport.y, candidate.x, candidate.y) > 1) {
          return false;
        }
        return this.isValidTransportCombination(candidate.unitTypeId, cargo.unitTypeId);
      })
      .sort(
        (left, right) =>
          this.calculateDistance(transport.x, transport.y, left.x, left.y) -
            this.calculateDistance(transport.x, transport.y, right.x, right.y) ||
          left.id.localeCompare(right.id)
      )[0];
  }

  private findCargoRescueTile(transport: Unit, cargo: Unit): { x: number; y: number } | undefined {
    const positions = [
      { x: transport.x, y: transport.y },
      ...this.getMapTopology().getNeighbors(transport.x, transport.y),
    ];
    return positions.find(position => {
      if (!this.isValidPosition(position.x, position.y)) return false;
      if (!this.canUnitEnterTerrain(this.getTerrainAt(position.x, position.y), cargo.unitTypeId)) {
        return false;
      }
      if (
        this.getUnitsAt(position.x, position.y).some(
          candidate => candidate.playerId !== cargo.playerId
        )
      ) {
        return false;
      }
      const city = this.gameManagerCallback?.getCityAt?.(position.x, position.y);
      return !city || city.playerId === cargo.playerId;
    });
  }

  private async detachCargoFromTransport(cargo: Unit, transport: Unit): Promise<void> {
    transport.cargoUnits = (transport.cargoUnits ?? []).filter(id => id !== cargo.id);
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ cargoUnits: transport.cargoUnits })
      .where(eq(units.id, transport.id));
  }

  /**
   * Freeciv's unit_move() automatically unloads a passenger before moving it
   * by a non-transport action, including paradrop and airlift.
   * @reference reference/freeciv/server/unittools.c:4083-4122
   */
  private async releaseTransportedUnit(unit: Unit): Promise<void> {
    if (!unit.transportedBy) return;
    const transport = this.units.get(unit.transportedBy);
    if (transport) await this.detachCargoFromTransport(unit, transport);
    unit.transportedBy = undefined;
  }

  /**
   * Remove a unit from the game
   * @reference freeciv/server/unittools.c server_remove_unit()
   * @param unitId The ID of the unit to remove
   */
  async removeUnit(unitId: string): Promise<void> {
    const unit = this.units.get(unitId);
    if (!unit) {
      logger.warn(`Attempted to remove non-existent unit: ${unitId}`);
      return;
    }

    logger.info(`Removing unit ${unitId} (${unit.unitTypeId}) at (${unit.x}, ${unit.y})`);
    await this.destroyUnit(unitId);
  }

  /**
   * Transfer a bribed unit to its new owner and persist the authoritative
   * owner/order state.
   * @reference reference/freeciv/server/diplomats.c:650-760
   */
  async bribeUnit(unitId: string, newPlayerId: string, homeCityId?: string): Promise<Unit> {
    const unit = this.units.get(unitId);
    if (!unit) throw new Error('Target unit not found');
    const previousPlayerId = unit.playerId;
    unit.playerId = newPlayerId;
    unit.homeCityId = homeCityId;
    unit.orders = [];
    unit.automation = undefined;
    unit.automationTask = undefined;
    unit.movementLeft = 0;
    unit.fortified = false;
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
        playerId: newPlayerId,
        homeCityId: homeCityId ?? null,
        orders: [],
        currentOrder: null,
        isAutomated: false,
        automationMode: null,
        automationTask: null,
        movementPoints: '0',
        isFortified: false,
      })
      .where(eq(units.id, unitId));
    if (previousPlayerId !== newPlayerId) {
      this.notifyUnitLifecycle({ type: 'owner_changed', unit, previousPlayerId });
    }
    return unit;
  }

  /**
   * Classic sabotage removes half of the target's remaining hit points.
   * @reference reference/freeciv/server/diplomats.c:549-635
   */
  async sabotageUnit(unitId: string): Promise<{ unit?: Unit; destroyed: boolean }> {
    const unit = this.units.get(unitId);
    if (!unit) throw new Error('Target unit not found');
    if (unit.health < 2) {
      await this.destroyUnit(unitId);
      return { destroyed: true };
    }
    unit.health = Math.floor(unit.health / 2);
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ health: unit.health })
      .where(eq(units.id, unitId));
    return { unit, destroyed: false };
  }

  /**
   * Finish a surviving diplomat-family action using its source action's
   * movement cost when available. Legacy callers without a source action
   * retain the historical full-movement finish.
   *
   * @reference reference/freeciv/common/unit.c:2199-2223
   * @reference reference/freeciv/server/actiontools.c:63-75
   */
  async finishDiplomatMission(unitId: string, sourceAction?: string): Promise<void> {
    const unit = this.units.get(unitId);
    if (!unit) return;
    const unitType = this.unitTypes[unit.unitTypeId];
    const movementCost =
      sourceAction && unitType
        ? this.getActionSuccessMovementCost(unit, unitType, sourceAction)
        : unit.movementLeft;
    unit.movementLeft = Math.max(0, unit.movementLeft - movementCost);
    unit.orders = [];
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ movementPoints: String(unit.movementLeft), orders: [], currentOrder: null })
      .where(eq(units.id, unitId));
  }

  /**
   * Spy Attack stays on the actor tile but a won diplomatic battle spends a
   * single movement fragment. Unlike escape missions, it neither teleports
   * nor exhausts the actor.
   *
   * @reference reference/freeciv/common/actions.c:696-699
   * @reference reference/freeciv/server/diplomats.c:2187-2300
   */
  async finishSpyAttack(unitId: string): Promise<void> {
    const unit = this.units.get(unitId);
    if (!unit) return;
    unit.movementLeft = Math.max(0, unit.movementLeft - this.getMoveFragments());
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
        movementPoints: String(unit.movementLeft),
        lastActionTurn: this.currentTurnProvider?.() ?? 1,
      })
      .where(eq(units.id, unitId));
  }

  /**
   * Complete C2C3 Bribe Unit's forced move after the target has changed
   * ownership. The action itself spends all movement rather than relying on
   * the general terrain move path.
   *
   * @reference reference/freeciv/common/actions.c:128-137
   * @reference reference/freeciv/server/diplomats.c:750-786
   */
  async finishBribeMission(unitId: string, targetX: number, targetY: number): Promise<void> {
    const unit = this.units.get(unitId);
    if (!unit) return;
    const previousX = unit.x;
    const previousY = unit.y;
    unit.x = targetX;
    unit.y = targetY;
    unit.movementLeft = 0;
    unit.orders = [];
    unit.fortified = false;
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
        x: targetX,
        y: targetY,
        movementPoints: '0',
        orders: [],
        currentOrder: null,
        isFortified: false,
      })
      .where(eq(units.id, unitId));
    this.notifyUnitLifecycle({ type: 'moved', unit, previousX, previousY });
  }

  /**
   * Get unit by ID
   */
  getUnit(unitId: string): Unit | undefined {
    return this.units.get(unitId);
  }

  /**
   * Get all units in the game
   */
  getAllUnits(): Map<string, Unit> {
    return this.units;
  }

  /**
   * Return worker actions that are executable at the unit's current tile.
   * The client uses this as a presentation projection only; executeUnitAction
   * still re-evaluates the action against authoritative state.
   */
  getAvailableWorkerActions(unitId: string): ActionType[] {
    const worker = this.units.get(unitId);
    if (!worker) return [];

    const workerActions = [
      ActionType.BUILD_ROAD,
      ActionType.BUILD_RAILROAD,
      ActionType.BUILD_IRRIGATION,
      ActionType.BUILD_MINE,
      ActionType.CULTIVATE,
      ActionType.PLANT,
      ActionType.BUILD_FORTRESS,
      ActionType.BUILD_AIRBASE,
      ActionType.TRANSFORM_TERRAIN,
      ActionType.CLEAN_POLLUTION,
    ];
    return workerActions.filter(action => this.canUnitPerformAction(unitId, action));
  }

  /**
   * Return units whose ruleset class requires random movement processing.
   * @reference reference/freeciv/common/unit.c:unit_type_has_flag
   */
  getUnitsWithRandomMovement(playerId: string): Unit[] {
    return [...this.units.values()].filter(unit => {
      if (unit.playerId !== playerId || unit.transportedBy || unit.movementLeft <= 0) {
        return false;
      }
      return this.unitTypes[unit.unitTypeId]?.flags?.includes('RandomMovement') ?? false;
    });
  }

  /**
   * Move one random-movement unit to a legal adjacent tile.
   * @reference reference/freeciv/server/srv_main.c:random_movements
   */
  async executeRandomMovement(unitId: string): Promise<{
    success: boolean;
    fromTile: { x: number; y: number };
    toTile?: { x: number; y: number };
    movementPointsUsed: number;
  }> {
    const unit = this.units.get(unitId);
    const fromTile = unit ? { x: unit.x, y: unit.y } : { x: 0, y: 0 };
    if (
      !unit ||
      !this.getUnitsWithRandomMovement(unit.playerId).some(candidate => candidate.id === unitId)
    ) {
      return { success: false, fromTile, movementPointsUsed: 0 };
    }

    const candidates = this.getMapTopology().getNeighbors(unit.x, unit.y);
    for (let index = candidates.length - 1; index > 0; index--) {
      const randomIndex = randomInt(this.random, index + 1);
      [candidates[index], candidates[randomIndex]] = [candidates[randomIndex]!, candidates[index]!];
    }

    for (const candidate of candidates) {
      const stepCost = this.getPathStepCost(unit, unit.x, unit.y, candidate.x, candidate.y, true);
      if (stepCost < 0 || stepCost > unit.movementLeft) continue;
      try {
        await this.moveUnit(unit.id, candidate.x, candidate.y);
        return {
          success: true,
          fromTile,
          toTile: { x: unit.x, y: unit.y },
          movementPointsUsed: fromTile.x === unit.x && fromTile.y === unit.y ? 0 : stepCost,
        };
      } catch {
        // A candidate can become illegal after a preceding unit moves; try the
        // next legal neighbor rather than aborting the random-events phase.
      }
    }

    return { success: false, fromTile, movementPointsUsed: 0 };
  }

  /** The immutable unit catalogue selected for this game instance. */
  getUnitTypes(): Readonly<Record<string, UnitType>> {
    return this.unitTypes;
  }

  /**
   * Return the final researched upgrade target and authoritative upgrade cost
   * for an owner-visible unit menu.
   *
   * @reference reference/freeciv-web/javascript/control.js:2096-2124
   */
  getUnitUpgradeInfo(
    unitId: string
  ): { unitTypeId: string; name: string; cost: number } | undefined {
    const unit = this.units.get(unitId);
    const upgrade = unit ? this.getUpgradeTarget(unit) : undefined;
    if (!unit || !upgrade) return undefined;

    return {
      unitTypeId: upgrade.to.id,
      name: upgrade.to.name,
      cost: this.getUpgradeGoldCost(unit, upgrade.from, upgrade.to),
    };
  }

  /**
   * Get unit type definition by ID
   */
  getUnitType(unitTypeId: string): UnitType | undefined {
    return this.unitTypes[unitTypeId];
  }

  /**
   * Resolve the action-specific diplomatic contest and, for spies, the
   * separate escape check. Validation and the action's state mutation remain
   * with GameManager.
   * @reference reference/freeciv/server/diplomats.c
   */
  resolveDiplomatAction(
    actorId: string,
    actionType: ActionType,
    defenderId?: string,
    theftCount = 0,
    sourceAction?: string
  ): DiplomatActionResolution {
    const actor = this.units.get(actorId);
    if (!actor) {
      return { success: false, actorSurvives: false, successChance: 0, escapeChance: 0 };
    }

    const defender = defenderId ? this.units.get(defenderId) : undefined;
    const odds = this.calculateDiplomatActionOdds(
      actor,
      actionType,
      defender,
      theftCount,
      sourceAction
    );
    const success = randomInt(this.random, 100) < odds.successChance * 100;
    const actorSurvives =
      success && odds.escapeChance > 0 && randomInt(this.random, 100) < odds.escapeChance * 100;
    return {
      success,
      actorSurvives,
      successChance: odds.successChance * 100,
      escapeChance: odds.escapeChance * 100,
    };
  }

  /**
   * Pure action-specific diplomatic contest and escape odds for advisors.
   * Resolution consumes randomness separately in resolveDiplomatAction().
   */
  // eslint-disable-next-line complexity
  calculateDiplomatActionOdds(
    actor: Unit,
    actionType: ActionType,
    defender?: Unit,
    theftCount = 0,
    sourceAction?: string
  ): { successChance: number; escapeChance: number } {
    const actorType = this.unitTypes[actor.unitTypeId];
    const isSpy = actorType.flags?.includes('Spy') ?? false;
    const guaranteedActions = new Set([
      ActionType.ESTABLISH_EMBASSY,
      ActionType.INVESTIGATE_CITY,
      ActionType.BRIBE_UNIT,
      ActionType.INCITE_CITY,
    ]);
    let successChance = guaranteedActions.has(actionType) ? 100 : isSpy ? 75 : 50;
    successChance += actor.veteranLevel * 5;
    let defenderIsSuperSpy = false;

    if (defender) {
      const defenderType = this.unitTypes[defender.unitTypeId];
      defenderIsSuperSpy = defenderType.flags?.includes('SuperSpy') ?? false;
      const actorIsSuperSpy = actorType.flags?.includes('SuperSpy') ?? false;
      if (defenderIsSuperSpy) {
        successChance = 0;
      } else if (actorIsSuperSpy) {
        successChance = 100;
      } else if (defenderType.flags?.includes('Diplomat')) {
        successChance -= 20 + defender.veteranLevel * 5;
      }
    }
    // Freeciv makes repeated missions against the same city progressively
    // harder. Keep the penalty deterministic and bounded so spies remain
    // useful while repeated thefts are not free attempts.
    successChance -= Math.max(0, theftCount) * 10;
    successChance = Math.max(5, Math.min(100, successChance));
    if (sourceAction) {
      const actionOddsPct =
        this.effectsManager?.calculateEffect(EffectType.ACTION_ODDS_PCT, {
          ...this.getUnitEffectContext(actor, actorType, sourceAction),
        }).value ?? 0;
      // Freeciv adjusts the action's initial odds in one integer calculation,
      // rather than performing a second independent roll.
      // @reference reference/freeciv/common/actions.c:5612-5655
      successChance += Math.trunc((successChance * actionOddsPct) / 100);
      successChance = Math.max(0, Math.min(100, successChance));
    }
    if (defenderIsSuperSpy) successChance = 0;
    const escapeActions = new Set([
      ActionType.STEAL_TECH,
      ActionType.SABOTAGE_CITY,
      ActionType.SABOTAGE_UNIT,
      ActionType.SPY_ATTACK,
      ActionType.POISON_WATER,
    ]);
    const escapeChancePercent = isSpy
      ? escapeActions.has(actionType)
        ? Math.min(95, 75 + actor.veteranLevel * 5)
        : 100
      : 0;
    return {
      successChance: successChance / 100,
      escapeChance: escapeChancePercent / 100,
    };
  }

  /**
   * Execute action for unit using ActionSystem
   */
  async executeUnitAction(
    unitId: string,
    actionType: ActionType,
    targetX?: number,
    targetY?: number,
    actingPlayerId?: string,
    options?: { preserveAutomation?: boolean; persistGotoOrder?: boolean }
  ): Promise<ActionResult> {
    const unit = this.units.get(unitId);
    if (!unit) {
      return {
        success: false,
        message: `Unit not found: ${unitId}`,
      };
    }
    if (actingPlayerId && unit.playerId !== actingPlayerId) {
      return {
        success: false,
        message: `Unit ${unitId} does not belong to player ${actingPlayerId}`,
      };
    }

    if (
      !options?.preserveAutomation &&
      ![ActionType.AUTO_EXPLORE, ActionType.AUTO_SETTLER].includes(actionType)
    ) {
      await this.clearAutomation(unit);
    }
    // AI movement follows a freshly planned path for the current turn. Keep
    // the persistent order for player-issued GOTO actions, but let AI callers
    // opt into the reference behavior where an invalid path is simply
    // replanned on the next turn.
    if (actionType === ActionType.GOTO && options?.persistGotoOrder === false) {
      return this.executeAuthoritativeGoto(unit, targetX, targetY, false);
    }
    const directAction = this.getDirectUnitAction(unit, actionType);
    if (directAction) return directAction(targetX, targetY);

    return this.executeFallbackUnitAction(unit, actionType, targetX, targetY);
  }

  /** Execute one AI-planned GOTO without creating a persistent player order. */
  public executeAIUnitGoto(
    unitId: string,
    targetX: number,
    targetY: number,
    actingPlayerId?: string
  ): Promise<ActionResult> {
    return this.executeUnitAction(unitId, ActionType.GOTO, targetX, targetY, actingPlayerId, {
      persistGotoOrder: false,
    });
  }

  private async executeFallbackUnitAction(
    unit: Unit,
    actionType: ActionType,
    targetX?: number,
    targetY?: number
  ): Promise<ActionResult> {
    if (
      this.isDiplomatAction(actionType) &&
      this.diplomatActionExecutor &&
      targetX !== undefined &&
      targetY !== undefined
    ) {
      return this.diplomatActionExecutor(unit.playerId, unit.id, actionType, targetX, targetY);
    }
    if (actionType === ActionType.AUTO_EXPLORE || actionType === ActionType.AUTO_SETTLER) {
      return this.setAutomation(unit, actionType);
    }
    if (
      (this.isRulesetWorkerAction(actionType) ||
        [ActionType.BUILD_FORTRESS, ActionType.BUILD_AIRBASE].includes(actionType)) &&
      !this.canUnitPerformAction(unit.id, actionType, targetX, targetY)
    ) {
      return { success: false, message: `Unit cannot perform ${actionType}` };
    }

    // Execute action through ActionSystem
    const result = await this.actionSystem.executeAction(unit, actionType, targetX, targetY);

    // Apply result to unit state if successful
    if (result.success) {
      await this.applyActionResult(unit, actionType, result);
    }

    return result;
  }

  private getDirectUnitAction(
    unit: Unit,
    actionType: ActionType
  ): ((targetX?: number, targetY?: number) => Promise<ActionResult>) | undefined {
    const handlers: Partial<
      Record<ActionType, (targetX?: number, targetY?: number) => Promise<ActionResult>>
    > = {
      [ActionType.CANCEL_ORDERS]: () => this.executeCancelOrders(unit),
      [ActionType.PARADROP]: (targetX, targetY) => this.executeParadrop(unit, targetX, targetY),
      [ActionType.AIRLIFT]: (targetX, targetY) => this.executeAirlift(unit, targetX, targetY),
      [ActionType.BOMBARD]: (targetX, targetY) => this.executeBombard(unit, targetX, targetY),
      [ActionType.NUCLEAR_EXPLOSION]: (targetX, targetY) =>
        this.executeNuclearExplosion(unit, targetX, targetY),
      [ActionType.CAPTURE_UNITS]: (targetX, targetY) =>
        this.executeCaptureUnits(unit, targetX, targetY),
      [ActionType.COLLECT_RANSOM]: (targetX, targetY) =>
        this.executeCollectRansom(unit, targetX, targetY),
      [ActionType.SUICIDE_ATTACK]: (targetX, targetY) =>
        this.executeSuicideAttack(unit, targetX, targetY),
      [ActionType.LOAD_UNIT]: (targetX, targetY) =>
        this.executeLoadUnitAction(unit, targetX, targetY),
      [ActionType.UNLOAD_UNIT]: (targetX, targetY) =>
        this.executeUnloadUnitAction(unit, targetX, targetY),
      [ActionType.GOTO]: (targetX, targetY) =>
        this.executeAuthoritativeGoto(unit, targetX, targetY),
      [ActionType.PATROL]: (targetX, targetY) => this.executePatrol(unit, targetX, targetY),
      [ActionType.MARKETPLACE]: (targetX, targetY) =>
        this.executeCityUnitAction(unit, actionType, targetX, targetY),
      [ActionType.HELP_WONDER]: (targetX, targetY) =>
        this.executeCityUnitAction(unit, actionType, targetX, targetY),
      [ActionType.JOIN_CITY]: (targetX, targetY) =>
        this.executeCityUnitAction(unit, actionType, targetX, targetY),
      [ActionType.DISBAND_UNIT_RECOVER]: (targetX, targetY) =>
        this.executeCityUnitAction(unit, actionType, targetX, targetY),
      [ActionType.CHANGE_HOME_CITY]: (targetX, targetY) =>
        this.executeChangeHomeCity(unit, targetX, targetY),
      [ActionType.UPGRADE_UNIT]: () => this.executeUpgradeUnit(unit),
    };
    return handlers[actionType];
  }

  private async executeCancelOrders(unit: Unit): Promise<ActionResult> {
    const hadOrders = (unit.orders?.length ?? 0) > 0 || Boolean(unit.automation);
    unit.orders = [];
    unit.activity = { type: 'idle', turnsRemaining: 0, totalTurns: 0 };
    unit.automation = undefined;
    unit.autoExploreTarget = undefined;

    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
        isAutomated: false,
        automationMode: null,
        automationTask: null,
        orders: [],
        currentOrder: null,
      })
      .where(eq(units.id, unit.id));

    return {
      success: true,
      message: hadOrders ? 'Unit orders cancelled' : 'Unit had no queued orders',
      newOrders: [],
    };
  }

  private async executeLoadUnitAction(
    unit: Unit,
    targetX?: number,
    targetY?: number
  ): Promise<ActionResult> {
    const x = targetX ?? unit.x;
    const y = targetY ?? unit.y;
    // The player-facing Load action is Freeciv's Transport Board: its
    // transport target must share the actor's tile. Moving to an adjacent
    // transport is instead resolved by the movement path as Transport Embark.
    // @reference reference/freeciv/doc/README.actions:641-700
    const transport =
      x === unit.x && y === unit.y ? this.findAvailableTransportAt(unit, x, y) : undefined;
    const loaded = transport ? await this.loadUnitOntoTransport(transport.id, unit.id) : false;
    return {
      success: loaded,
      message: loaded ? 'Unit loaded' : 'No compatible transport with available capacity',
    };
  }

  private async executeUnloadUnitAction(
    unit: Unit,
    targetX?: number,
    targetY?: number
  ): Promise<ActionResult> {
    const unloaded = await this.unloadUnit(unit.id, targetX ?? unit.x, targetY ?? unit.y);
    return {
      success: unloaded,
      message: unloaded ? 'Unit unloaded' : 'Unit cannot unload on the target tile',
    };
  }

  private isDiplomatAction(actionType: ActionType): boolean {
    return [
      ActionType.ESTABLISH_EMBASSY,
      ActionType.BRIBE_UNIT,
      ActionType.STEAL_TECH,
      ActionType.INVESTIGATE_CITY,
      ActionType.INCITE_CITY,
      ActionType.SABOTAGE_CITY,
      ActionType.SABOTAGE_UNIT,
      ActionType.POISON_WATER,
    ].includes(actionType);
  }

  private async executeCityUnitAction(
    unit: Unit,
    actionType: ActionType,
    targetX?: number,
    targetY?: number
  ): Promise<ActionResult> {
    if (targetX === undefined || targetY === undefined) {
      return { success: false, message: 'A target city is required' };
    }
    if (!this.canPerformCityUnitAction(unit, actionType, targetX, targetY)) {
      return { success: false, message: `Unit cannot perform ${actionType}` };
    }
    const result = await this.gameManagerCallback!.executeCityUnitAction!(
      actionType,
      unit.playerId,
      unit.unitTypeId,
      unit.homeCityId,
      targetX,
      targetY
    );
    if (result.success && result.unitDestroyed) {
      await this.destroyUnit(unit.id);
    }
    return result;
  }

  private canPerformCityUnitAction(
    unit: Unit,
    actionType: ActionType,
    targetX: number,
    targetY: number
  ): boolean {
    const city = this.gameManagerCallback?.getCityAt?.(targetX, targetY);
    const unitType = this.unitTypes[unit.unitTypeId];
    if (!this.hasValidCityUnitActionTarget(unit, actionType, city, unitType, targetX, targetY))
      return false;
    return this.getCityUnitActionValidator(unit, unitType)[actionType]?.() ?? false;
  }

  private hasValidCityUnitActionTarget(
    unit: Unit,
    actionType: ActionType,
    city: CityAtLocation | null | undefined,
    unitType: UnitType | undefined,
    targetX: number,
    targetY: number
  ): city is CityAtLocation {
    if (!city || !unitType || !this.gameManagerCallback?.executeCityUnitAction) return false;
    const maxRange = this.getCityUnitActionMaxRange(actionType);
    const distance = this.calculateDistance(unit.x, unit.y, targetX, targetY);
    if (distance > maxRange) return false;
    return this.canTargetCityUnitAction(unit, actionType, city);
  }

  /**
   * C2C3 permits a Caravan to help an allied, team, or no-contact city
   * (but not a city at war, cease-fire, armistice, or peace) and likewise
   * permits recycling a unit there. Other city utility actions remain
   * domestic-only.
   *
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:648-674
   * @reference reference/freeciv/common/player.c:1523-1565
   */
  private canTargetCityUnitAction(
    unit: Unit,
    actionType: ActionType,
    city: CityAtLocation
  ): boolean {
    if (city.playerId === unit.playerId) return true;
    if (![ActionType.HELP_WONDER, ActionType.DISBAND_UNIT_RECOVER].includes(actionType)) {
      return false;
    }
    const relation = this.getKnownDiplomaticState(unit.playerId, city.playerId);
    return relation === 'no_contact' || relation === 'alliance' || relation === 'team';
  }

  private getKnownDiplomaticState(firstPlayerId: string, secondPlayerId: string): string {
    const cachedRelation = this.diplomaticStateLookup?.(firstPlayerId, secondPlayerId);
    if (cachedRelation) return cachedRelation;
    if (this.sameTeamProvider?.(firstPlayerId, secondPlayerId)) return 'team';
    if (this.alliedPlayersProvider?.(firstPlayerId).has(secondPlayerId)) return 'alliance';
    return 'no_contact';
  }

  private getCityUnitActionMaxRange(actionType: ActionType): number {
    const rangeKey =
      actionType === ActionType.HELP_WONDER
        ? 'help_wonder_max_range'
        : 'disband_unit_recover_max_range';
    const actions = rulesetLoader.loadActionsRuleset(this.getRulesetName()) as unknown as {
      settings?: Record<string, unknown>;
    };
    const range = actions.settings?.[rangeKey];
    return typeof range === 'number' ? range : 0;
  }

  private getCityUnitActionValidator(
    unit: Unit,
    unitType: UnitType
  ): Partial<Record<ActionType, () => boolean>> {
    return {
      [ActionType.MARKETPLACE]: () =>
        Boolean(unit.homeCityId && unitType.flags?.includes('TradeRoute')),
      [ActionType.HELP_WONDER]: () =>
        Boolean(unitType.flags?.includes('HelpWonder') && unit.movementLeft > 0),
      [ActionType.JOIN_CITY]: () =>
        Boolean(unitType.flags?.includes('AddToCity') && unit.movementLeft > 0),
      [ActionType.DISBAND_UNIT_RECOVER]: () => !unitType.flags?.includes('EvacuateFirst'),
    };
  }

  private async executeChangeHomeCity(
    unit: Unit,
    targetX?: number,
    targetY?: number
  ): Promise<ActionResult> {
    const city = this.getChangeHomeCityTarget(targetX, targetY);
    if (!city || !this.canChangeHomeCity(unit, targetX, targetY)) {
      return { success: false, message: 'Unit cannot change home city' };
    }
    unit.homeCityId = city.id;
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ homeCityId: city.id, movementPoints: String(unit.movementLeft) })
      .where(eq(units.id, unit.id));
    return { success: true, message: `Home city changed to ${city.id}` };
  }

  private getChangeHomeCityTarget(
    targetX?: number,
    targetY?: number
  ): CityAtLocation | null | undefined {
    if (targetX === undefined || targetY === undefined) return null;
    return this.gameManagerCallback?.getCityAt?.(targetX, targetY);
  }

  private async executeUpgradeUnit(unit: Unit): Promise<ActionResult> {
    const upgrade = this.getUpgradeTarget(unit);
    if (!upgrade) {
      return { success: false, message: 'Unit cannot be upgraded here' };
    }
    const { from, to } = upgrade;
    const goldCost = this.getUpgradeGoldCost(unit, from, to);
    const db = this.databaseProvider.getDatabase();
    const [player] = await db
      .select({ gold: players.gold })
      .from(players)
      .where(and(eq(players.id, unit.playerId), eq(players.gameId, this.gameId)));
    if (!player || player.gold < goldCost) {
      return { success: false, message: `Upgrade requires ${goldCost} gold` };
    }
    const veteranLoss = rulesetLoader.loadGameRulesRuleset(this.getRulesetName()).game_parameters
      .upgrade_veteran_loss;
    await db
      .update(players)
      .set({ gold: sql`${players.gold} - ${goldCost}` })
      .where(and(eq(players.id, unit.playerId), eq(players.gameId, this.gameId)));
    await this.transformUnit(unit, from, to, veteranLoss);
    return { success: true, message: `${from.name} upgraded to ${to.name} for ${goldCost} gold` };
  }

  /**
   * Leonardo's Workshop upgrades up to Upgrade_Unit eligible units for free
   * before Freeciv restores movement and fuel for the player's next usable
   * turn.
   * @reference reference/freeciv/server/unittools.c:429-465
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3280-3286
   */
  private async applyAutomaticUpgrades(playerId: string): Promise<void> {
    const upgradeCount = Math.max(
      0,
      Math.trunc(
        this.effectsManager?.calculateEffect(EffectType.UPGRADE_UNIT, {
          playerId,
          playerTechs: this.playerTechsProvider(playerId),
          playerBuildings: new Set(this.gameManagerCallback?.getPlayerBuildings?.(playerId) ?? []),
        }).value ?? 0
      )
    );
    if (upgradeCount === 0) return;

    const candidates = [...this.units.values()]
      .filter(unit => unit.playerId === playerId)
      .flatMap(unit => {
        const upgrade = this.getUpgradeTarget(unit, true);
        return upgrade ? [{ unit, ...upgrade }] : [];
      });
    const veteranLoss = rulesetLoader.loadGameRulesRuleset(this.getRulesetName()).game_parameters
      .autoupgrade_veteran_loss;

    for (let remaining = upgradeCount; remaining > 0 && candidates.length > 0; remaining -= 1) {
      const index = randomInt(this.random, candidates.length);
      const [candidate] = candidates.splice(index, 1);
      if (!candidate) break;
      await this.transformUnit(candidate.unit, candidate.from, candidate.to, veteranLoss);
    }
  }

  /**
   * Transform a unit with the source veteran clipping and proportional move
   * scaling used for both manual upgrades and Leonardo's free upgrades.
   * @reference reference/freeciv/server/unittools.c:1558-1597
   */
  private async transformUnit(
    unit: Unit,
    from: UnitType,
    to: UnitType,
    veteranLoss: number
  ): Promise<void> {
    const oldMaximumMovement = this.getUnitMovementPoints(
      unit.playerId,
      from,
      unit.veteranLevel,
      unit.health
    );
    const veteranLevel = Math.max(
      0,
      Math.min(unit.veteranLevel, getVeteranLevelCount(to) - 1) - veteranLoss
    );
    const newMaximumMovement = this.getUnitMovementPoints(
      unit.playerId,
      to,
      veteranLevel,
      unit.health
    );
    const movementLeft =
      oldMaximumMovement === 0
        ? newMaximumMovement
        : Math.min(
            newMaximumMovement,
            Math.max(0, Math.floor((unit.movementLeft * newMaximumMovement) / oldMaximumMovement))
          );
    unit.unitTypeId = to.id;
    unit.veteranLevel = veteranLevel;
    unit.movementLeft = movementLeft;
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
        unitType: to.id,
        attackStrength: to.attack ?? 0,
        defenseStrength: to.defense ?? 0,
        rangedStrength: to.range > 1 ? to.combat : 0,
        veteranLevel,
        movementPoints: String(movementLeft),
        maxMovementPoints: String(newMaximumMovement),
      })
      .where(eq(units.id, unit.id));
  }

  /**
   * Freeciv values the old unit through the action-specific
   * Unit_Shield_Value_Pct effect before calculating the missing shields, then
   * applies Upgrade_Price_Pct at player scope.
   * @reference reference/freeciv/common/unit.c:233-265
   * @reference reference/freeciv/common/unittype.c:1757-1771
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:465-473
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:4618-4625
   */
  private getUpgradeGoldCost(unit: Unit, from: UnitType, to: UnitType): number {
    const context = this.getUnitEffectContext(unit, from, 'Upgrade Unit');
    const shieldValuePct =
      100 +
      (this.effectsManager?.calculateEffect(EffectType.UNIT_SHIELD_VALUE_PCT, context).value ?? 0);
    const oldShieldValue = Math.trunc((from.cost * shieldValuePct) / 100);
    const missingShields = to.cost - oldShieldValue;
    const baseCost = 2 * missingShields + Math.trunc((missingShields * missingShields) / 20);
    const pricePct =
      100 +
      (this.effectsManager?.calculateEffect(EffectType.UPGRADE_PRICE_PCT, context).value ?? 0);
    return Math.trunc((baseCost * pricePct) / 100);
  }

  private getUnitEffectContext(unit: Unit, unitType: UnitType, action: string): EffectContext {
    return {
      playerId: unit.playerId,
      action,
      unitId: unit.id,
      unitType: unitType.id,
      unitClass: unitType.rulesetUnitClass,
      unitClassFlags: new Set(unitType.rulesetUnitClassFlags),
      unitTypeFlags: new Set(unitType.flags ?? []),
      playerTechs: this.playerTechsProvider(unit.playerId),
      playerBuildings: new Set(this.gameManagerCallback?.getPlayerBuildings?.(unit.playerId) ?? []),
    };
  }

  private getUpgradeTarget(
    unit: Unit,
    isFree: boolean = false
  ): { from: UnitType; to: UnitType } | undefined {
    const city = this.gameManagerCallback?.getCityAt?.(unit.x, unit.y);
    const from = this.unitTypes[unit.unitTypeId];
    const to = from ? this.getBestUpgrade(from, unit.playerId) : undefined;
    if (!from || !to || !this.canTransformUnitAtCurrentLocation(unit, to)) return undefined;
    if (!isFree && (!city || city.playerId !== unit.playerId)) return undefined;
    return { from, to };
  }

  /**
   * Freeciv refuses upgrades that would strand cargo, leave a passenger in an
   * incompatible transporter, or leave an untransported unit on non-native
   * terrain.
   * @reference reference/freeciv/common/unit.c:1999-2048
   */
  private canTransformUnitAtCurrentLocation(unit: Unit, to: UnitType): boolean {
    const cargo = (unit.cargoUnits ?? []).map(cargoId => this.units.get(cargoId));
    if (
      cargo.some((cargoUnit): cargoUnit is undefined => !cargoUnit) ||
      cargo.length > (to.transport_capacity ?? 0) ||
      cargo.some(cargoUnit => !this.isValidTransportCombination(to.id, cargoUnit!.unitTypeId))
    ) {
      return false;
    }

    if (unit.transportedBy) {
      const transport = this.units.get(unit.transportedBy);
      return Boolean(transport && this.isValidTransportCombination(transport.unitTypeId, to.id));
    }
    // UnitManager's standalone test/runtime fallback has no authoritative map
    // tile to compare with Freeciv's can_exist_at_tile() check.
    if (!this.mapManager?.getTile) return true;
    return this.canUnitEnterTerrain(this.getTerrainAt(unit.x, unit.y), to.id);
  }

  private getBestUpgrade(from: UnitType, playerId: string): UnitType | undefined {
    const techs = this.playerTechsProvider(playerId);
    const visited = new Set([from.id]);
    let candidate = from;
    let best: UnitType | undefined;
    while (candidate.obsolete_by && !visited.has(candidate.obsolete_by)) {
      visited.add(candidate.obsolete_by);
      const next = this.unitTypes[candidate.obsolete_by];
      if (!next) break;
      if (!next.requiredTech || techs.has(next.requiredTech)) best = next;
      candidate = next;
    }
    return best;
  }

  private canParadrop(unit: Unit, targetX?: number, targetY?: number): boolean {
    const unitType = this.unitTypes[unit.unitTypeId];
    if (!this.isParadropActorReady(unit, unitType)) return false;
    if (
      targetX === undefined ||
      targetY === undefined ||
      !this.isValidPosition(targetX, targetY) ||
      this.calculateDistance(unit.x, unit.y, targetX, targetY) > unitType.paratroopersRange ||
      !this.canUnitEnterTerrain(this.getTerrainAt(targetX, targetY), unit.unitTypeId)
    ) {
      return false;
    }
    return this.hasParadropSource(unit);
  }

  private isParadropActorReady(unit: Unit, unitType: UnitType): boolean {
    return Boolean(
      unitType.flags?.includes('Paratroopers') &&
      unitType.paratroopersRange > 0 &&
      !this.unitHasCargo(unit.id) &&
      unit.lastActionTurn !== (this.currentTurnProvider?.() ?? 1) &&
      unit.movementLeft >= this.getMoveFragments()
    );
  }

  private hasParadropSource(unit: Unit): boolean {
    const sourceCity = this.gameManagerCallback?.getCityAt?.(unit.x, unit.y);
    if (this.hasFriendlyParadropCity(unit, sourceCity)) return true;
    const sourceTile = this.mapManager?.getTile(unit.x, unit.y);
    return this.hasFriendlyParadropAirbase(unit, sourceTile);
  }

  private hasFriendlyParadropCity(unit: Unit, city: CityAtLocation | null | undefined): boolean {
    if (!city) return false;
    return (
      city.playerId === unit.playerId ||
      this.alliedPlayersProvider?.(unit.playerId).has(city.playerId) === true
    );
  }

  private hasFriendlyParadropAirbase(
    unit: Unit,
    tile: { improvements?: string[]; owner?: string } | undefined
  ): boolean {
    if (!tile || !this.tileHasExtra(tile, 'airbase')) return false;
    return (
      tile.owner === undefined ||
      tile.owner === unit.playerId ||
      this.alliedPlayersProvider?.(unit.playerId).has(tile.owner) === true
    );
  }

  private tileHasExtra(tile: { improvements?: string[] }, extraName: string): boolean {
    return Boolean(
      tile.improvements?.some(extra => extra.toLowerCase() === extraName.toLowerCase())
    );
  }

  /**
   * @reference reference/freeciv/server/unittools.c:3140-3288 do_paradrop()
   */
  private async executeParadrop(
    unit: Unit,
    targetX?: number,
    targetY?: number
  ): Promise<ActionResult> {
    if (!this.canParadrop(unit, targetX, targetY)) {
      return { success: false, message: 'Unit cannot paradrop to the target tile' };
    }
    const x = targetX as number;
    const y = targetY as number;
    const targetCity = this.gameManagerCallback?.getCityAt?.(x, y);
    const hostileUnits = this.getHostileUnitsAt(unit, x, y);
    const territoryError = await this.validateParadropTerritory(unit, targetCity);
    if (territoryError) return territoryError;
    if (hostileUnits.length > 0) {
      await this.destroyUnit(unit.id);
      return {
        success: true,
        message: 'The unit was lost while paradropping onto enemy units',
        unitDestroyed: true,
      };
    }

    await this.commitParadrop(unit, x, y);
    return {
      success: true,
      message: `Unit paradropped to (${x}, ${y})`,
      newPosition: { x, y },
      newMovementLeft: unit.movementLeft,
    };
  }

  private getHostileUnitsAt(unit: Unit, x: number, y: number): Unit[] {
    const alliedPlayers = this.alliedPlayersProvider?.(unit.playerId) ?? new Set<string>();
    return this.getUnitsAt(x, y).filter(
      target => target.playerId !== unit.playerId && !alliedPlayers.has(target.playerId)
    );
  }

  private async commitParadrop(unit: Unit, x: number, y: number): Promise<void> {
    await this.releaseTransportedUnit(unit);
    unit.x = x;
    unit.y = y;
    unit.fortified = false;
    unit.lastActionTurn = this.currentTurnProvider?.() ?? 1;
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
        transportedBy: null,
        x,
        y,
        isFortified: false,
        lastActionTurn: this.currentTurnProvider?.() ?? 1,
      })
      .where(eq(units.id, unit.id));
    this.gameManagerCallback?.broadcastUnitMoved(this.gameId, unit.id, x, y, unit.movementLeft);
  }

  private async validateParadropTerritory(
    unit: Unit,
    targetCity: CityAtLocation | null | undefined
  ): Promise<ActionResult | undefined> {
    // The non-city target enablers have no DiplRel requirement. Territory
    // ownership alone must therefore not block an ordinary paradrop.
    if (!targetCity || targetCity.playerId === unit.playerId) return undefined;
    const relation = await this.getDiplomaticState(unit.playerId, targetCity.playerId);
    if (relation === 'peace' || relation === 'ceasefire' || relation === 'armistice') {
      // A current foreign city under a non-attack diplomatic relation is
      // rejected before do_paradrop() can resolve it. This applies whether
      // the player sees the city now or knows it from an earlier sighting.
      return {
        success: false,
        message: 'Cannot paradrop onto a foreign city during peace, ceasefire, or armistice',
      };
    }
    // Only the separate Paradrop Unit Enter Conquer enabler, whose actor
    // requirement is DiplRel War, captures a foreign city.  The ordinary
    // action may enter an allied or team city unchanged.
    if (relation === 'war') return this.captureParadropCity(unit, targetCity);
    if (relation === 'alliance' || relation === 'team') return undefined;
    if (relation === 'no_contact') {
      // Freeciv permits an ordinary Paradrop Unit Enter onto a known-but-stale
      // foreign city tile before contact, then removes the actor when the
      // actual non-allied city is resolved. CivJS does not retain per-player
      // stale city visibility, so an accepted no-contact city request follows
      // that observable resolution.
      await this.destroyUnit(unit.id);
      return {
        success: true,
        message: 'The unit was lost while paradropping into a foreign city',
        unitDestroyed: true,
      };
    }
    return { success: false, message: 'Cannot paradrop onto the foreign city' };
  }

  private async captureParadropCity(
    unit: Unit,
    targetCity: CityAtLocation
  ): Promise<ActionResult | undefined> {
    const captured = await this.gameManagerCallback?.captureCity?.(
      targetCity.id,
      unit.playerId,
      unit.id
    );
    return captured
      ? undefined
      : { success: false, message: 'Paradrop could not capture the target city' };
  }

  private canAirlift(unit: Unit, targetX?: number, targetY?: number): boolean {
    const unitType = this.unitTypes[unit.unitTypeId];
    const isAirliftable = Boolean(
      unitType?.rulesetUnitClassFlags.includes('Airliftable') ||
      unitType?.rulesetUnitClass === 'Land'
    );
    const actorInvalid = !isAirliftable || this.unitHasCargo(unit.id) || unit.movementLeft <= 0;
    if (actorInvalid || targetX === undefined || targetY === undefined) return false;
    const source = this.gameManagerCallback?.getCityAt?.(unit.x, unit.y);
    const destination = this.gameManagerCallback?.getCityAt?.(targetX, targetY);
    return this.areAirliftEndpointsReady(unit, source, destination);
  }

  private areAirliftEndpointsReady(
    unit: Unit,
    source: CityAtLocation | null | undefined,
    destination: CityAtLocation | null | undefined
  ): boolean {
    const effectsManager = this.effectsManager;
    if (!effectsManager) return false;
    const parameters = rulesetLoader.loadGameRulesRuleset(
      effectsManager.getRulesetName()
    ).game_parameters;
    return this.hasValidAirliftEndpoints(unit, source, destination, parameters, effectsManager);
  }

  private hasValidAirliftEndpoints(
    unit: Unit,
    source: CityAtLocation | null | undefined,
    destination: CityAtLocation | null | undefined,
    parameters: { airlift_from_always_enabled?: boolean; airlift_to_always_enabled?: boolean },
    effectsManager: EffectsManager
  ): boolean {
    if (!source || !destination || source.id === destination.id) return false;
    if (source.playerId !== unit.playerId || !this.gameManagerCallback?.reserveAirlift)
      return false;
    return (
      this.cityHasAirlift(
        unit.playerId,
        source,
        parameters.airlift_from_always_enabled,
        effectsManager
      ) &&
      this.cityHasAirlift(
        unit.playerId,
        destination,
        parameters.airlift_to_always_enabled,
        effectsManager
      )
    );
  }

  private cityHasAirlift(
    playerId: string,
    city: CityAtLocation,
    alwaysEnabled: boolean | undefined,
    effectsManager: EffectsManager
  ): boolean {
    if (alwaysEnabled) return true;
    return (
      effectsManager.calculateEffect(EffectType.AIRLIFT, {
        playerId,
        cityId: city.id,
        cityBuildings: new Set(city.buildings ?? []),
      }).value > 0 || city.buildings?.includes('airport') === true
    );
  }

  /**
   * @reference reference/freeciv/server/unittools.c:3062-3095 do_airline()
   */
  private async executeAirlift(
    unit: Unit,
    targetX?: number,
    targetY?: number
  ): Promise<ActionResult> {
    if (!this.canAirlift(unit, targetX, targetY)) {
      return { success: false, message: 'Unit cannot airlift to the target city' };
    }
    const destination = this.gameManagerCallback!.getCityAt!(targetX!, targetY!)!;
    const source = this.gameManagerCallback!.getCityAt!(unit.x, unit.y)!;
    if (destination.playerId !== unit.playerId) {
      const relation = await this.getDiplomaticState(unit.playerId, destination.playerId);
      if (relation !== 'alliance') {
        return { success: false, message: 'Units may airlift only to domestic or allied cities' };
      }
    }
    const reserved = await this.gameManagerCallback!.reserveAirlift!(
      source.id,
      destination.id,
      unit.playerId,
      this.currentTurnProvider?.() ?? 1
    );
    if (!reserved) {
      return { success: false, message: 'An endpoint airport already airlifted this turn' };
    }

    await this.releaseTransportedUnit(unit);
    unit.x = targetX as number;
    unit.y = targetY as number;
    unit.movementLeft = 0;
    unit.fortified = false;
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
        transportedBy: null,
        x: unit.x,
        y: unit.y,
        movementPoints: '0',
        isFortified: false,
        lastActionTurn: this.currentTurnProvider?.() ?? 1,
      })
      .where(eq(units.id, unit.id));
    this.gameManagerCallback?.broadcastUnitMoved(
      this.gameId,
      unit.id,
      unit.x,
      unit.y,
      unit.movementLeft
    );
    return {
      success: true,
      message: `Unit airlifted to ${destination.id}`,
      newPosition: { x: unit.x, y: unit.y },
      newMovementLeft: 0,
    };
  }

  private canBombard(unit: Unit, targetX?: number, targetY?: number): boolean {
    const type = this.unitTypes[unit.unitTypeId];
    if (targetX === undefined || targetY === undefined) return false;
    if (!this.hasBombardActorRequirements(unit, type, targetX, targetY)) return false;
    if (this.getTerrainClass(this.getTerrainAt(targetX, targetY)) === 'Oceanic') return false;
    return this.hasBombardableTarget(unit, targetX, targetY);
  }

  private hasBombardActorRequirements(
    unit: Unit,
    type: UnitType,
    targetX: number,
    targetY: number
  ): boolean {
    if (type.bombardRate <= 0) return false;
    if (this.getRulesetName() === 'civ2civ3' && !type.flags?.includes('Bombarder')) return false;
    if (unit.transportedBy || unit.movementLeft <= 0) return false;
    return this.calculateDistance(unit.x, unit.y, targetX, targetY) <= type.range;
  }

  private hasBombardableTarget(unit: Unit, targetX: number, targetY: number): boolean {
    const targetCity = this.gameManagerCallback?.getCityAt?.(targetX, targetY);
    return (
      (targetCity?.playerId !== undefined && targetCity.playerId !== unit.playerId) ||
      this.getUnitsAt(targetX, targetY).some(
        target =>
          target.playerId !== unit.playerId &&
          !target.transportedBy &&
          this.canUnitTargetUnit(unit, target)
      )
    );
  }

  /**
   * Non-lethal generic bombard. Classic exposes no bombard-capable unit, but
   * rulesets with bombard_rate use this authoritative result.
   * @reference reference/freeciv/server/unithand.c:4626-4734 unit_bombard()
   */
  private async executeBombard(
    unit: Unit,
    targetX?: number,
    targetY?: number
  ): Promise<ActionResult> {
    if (!this.canBombard(unit, targetX, targetY)) {
      return { success: false, message: 'Unit cannot bombard the target tile' };
    }
    if (!(await this.isHostileArea(unit, targetX!, targetY!, 0))) {
      return { success: false, message: 'Bombardment requires a state of war' };
    }
    const type = this.unitTypes[unit.unitTypeId];
    const combatRules = rulesetLoader.getCombatRules(this.getRulesetName());
    const bombardRate = combatRules.damage_reduces_bombard_rate
      ? Math.max(1, Math.floor((type.bombardRate * unit.health) / 100))
      : type.bombardRate;
    const targets = this.getUnitsAt(targetX!, targetY!).filter(
      target =>
        target.playerId !== unit.playerId &&
        !target.transportedBy &&
        this.canUnitTargetUnit(unit, target)
    );
    const affectedUnitIds: string[] = [];
    for (const target of targets) {
      const targetType = this.unitTypes[target.unitTypeId];
      const firepower = this.calculateModifiedFirepower(unit, target, type, targetType);
      const damage = Math.max(
        1,
        Math.round((bombardRate * firepower.attacker * 100) / (targetType.hitpoints ?? 10))
      );
      target.health = Math.max(1, target.health - damage);
      affectedUnitIds.push(target.id);
      await this.databaseProvider
        .getDatabase()
        .update(units)
        .set({ health: target.health })
        .where(eq(units.id, target.id));
    }
    const targetCity = this.gameManagerCallback?.getCityAt?.(targetX!, targetY!);
    await this.applyCivilianCasualty(unit, type, targetCity, targetX!, targetY!);
    unit.movementLeft = 0;
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ movementPoints: '0', lastActionTurn: this.currentTurnProvider?.() ?? 1 })
      .where(eq(units.id, unit.id));
    return {
      success: true,
      message: `Bombarded ${affectedUnitIds.length} unit(s)`,
      newMovementLeft: 0,
      affectedUnitIds,
    };
  }

  private canTargetCombatUnit(unit: Unit, targetX?: number, targetY?: number): boolean {
    if (unit.movementLeft <= 0 || targetX === undefined || targetY === undefined) return false;
    const type = this.unitTypes[unit.unitTypeId];
    if ((type.attack ?? 0) <= 0 || this.calculateDistance(unit.x, unit.y, targetX, targetY) > 1) {
      return false;
    }
    return this.getUnitsAt(targetX, targetY).some(
      target =>
        target.playerId !== unit.playerId &&
        !target.transportedBy &&
        this.canUnitTargetUnit(unit, target)
    );
  }

  private canNuclearExplode(unit: Unit, targetX?: number, targetY?: number): boolean {
    const type = this.unitTypes[unit.unitTypeId];
    const x = targetX ?? unit.x;
    const y = targetY ?? unit.y;
    if (!type?.flags?.includes('Nuclear') || !this.isValidPosition(x, y)) return false;

    const action = this.getNuclearSourceAction(unit, x, y);
    const { minRange, maxRange } = this.getNuclearActionSettings(action);
    const distance = this.calculateDistance(unit.x, unit.y, x, y);
    if (distance < minRange || distance > maxRange) return false;

    // The c2c3 self-detonation action has no MinMoveFrags requirement. The
    // city and stack-targeted variants do.
    if (action !== 'Explode Nuclear' && unit.movementLeft <= 0) return false;

    if (action === 'Nuke City') {
      const city = this.gameManagerCallback?.getCityAt?.(x, y);
      return Boolean(city && city.playerId !== unit.playerId);
    }

    if (action === 'Nuke Units') {
      return this.getUnitsAt(x, y).some(
        target =>
          target.playerId !== unit.playerId &&
          !target.transportedBy &&
          this.canUnitTargetUnit(unit, target)
      );
    }

    return true;
  }

  /**
   * c2c3 keeps three source actions with distinct targets and movement
   * requirements, but they converge on the same authoritative nuclear
   * consequence after action selection. The effect controls the blast's
   * squared radius, and an eligible nearby SDI city can intercept before
   * detonation.
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:157-223
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:765-789
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:2616-2625
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:4135-4174
   * @reference reference/freeciv/server/unithand.c:4739-4805
   * @reference reference/freeciv/server/unittools.c:2954-3065
   */
  private async executeNuclearExplosion(
    unit: Unit,
    targetX?: number,
    targetY?: number
  ): Promise<ActionResult> {
    if (!this.canNuclearExplode(unit, targetX, targetY)) {
      return { success: false, message: 'Unit cannot detonate at the target tile' };
    }
    const centerX = targetX ?? unit.x;
    const centerY = targetY ?? unit.y;
    const action = this.getNuclearSourceAction(unit, centerX, centerY);
    const targetCity = this.gameManagerCallback?.getCityAt?.(centerX, centerY);
    const targetPlayerId =
      this.mapManager?.getTile?.(centerX, centerY)?.owner ?? targetCity?.playerId;
    if (!(await this.canNuclearStrikeTarget(unit, action, centerX, centerY))) {
      return { success: false, message: 'Nuclear attack would strike a non-hostile nation' };
    }
    const defendingCity = this.findNuclearDefense(unit, centerX, centerY);
    if (defendingCity) {
      // Freeciv destroys the actor even when the SDI interception prevents
      // the explosion, then reports the action as unsuccessful.
      await this.notifyNuclearActionConsequence({
        actor: unit,
        action,
        outcome: 'caught',
        targetX: centerX,
        targetY: centerY,
        targetPlayerId,
      });
      await this.destroyUnit(unit.id);
      return {
        success: false,
        message: `Nuclear attack was intercepted by SDI defenses at ${defendingCity.id}`,
        unitDestroyed: true,
      };
    }

    const { actorConsumingAlways } = this.getNuclearActionSettings(action);
    const blastRadiusSquared = this.getNuclearBlastRadiusSquared(unit, action);
    const affectedUnitIds: string[] = [];
    if (actorConsumingAlways) {
      await this.destroyUnit(unit.id);
      affectedUnitIds.push(unit.id);
    }
    affectedUnitIds.push(...(await this.destroyNuclearUnits(centerX, centerY, blastRadiusSquared)));

    const affectedCityIds =
      (await this.gameManagerCallback?.applyNuclearCityDamage?.(
        centerX,
        centerY,
        blastRadiusSquared,
        unit.playerId
      )) ?? [];
    this.applyNuclearFallout(centerX, centerY, blastRadiusSquared);
    await this.persistMapState();
    await this.notifyNuclearActionConsequence({
      actor: unit,
      action,
      outcome: 'success',
      targetX: centerX,
      targetY: centerY,
      targetPlayerId,
    });
    if (this.nuclearPresentationCallback) {
      try {
        this.nuclearPresentationCallback({
          eventId: `nuke:${this.gameId}:${Date.now()}:${unit.id}`,
          x: centerX,
          y: centerY,
          playerId: unit.playerId,
          affectedTiles: this.getNuclearBlastPositions(centerX, centerY, blastRadiusSquared),
        });
      } catch (error) {
        logger.warn('Nuclear presentation callback failed after authoritative action', error);
      }
    }
    return {
      success: true,
      message: `Nuclear explosion affected ${affectedUnitIds.length} unit(s) and ${affectedCityIds.length} city/cities`,
      unitDestroyed: true,
      affectedUnitIds,
    };
  }

  private async notifyNuclearActionConsequence(event: NuclearActionConsequence): Promise<void> {
    try {
      await this.nuclearActionConsequenceCallback?.(event);
    } catch (error) {
      logger.warn('Nuclear diplomatic consequence callback failed after authoritative action', {
        gameId: this.gameId,
        actorId: event.actor.id,
        action: event.action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private getNuclearSourceAction(
    unit: Unit,
    targetX: number,
    targetY: number
  ): NuclearSourceAction {
    if (unit.x === targetX && unit.y === targetY) return 'Explode Nuclear';
    return this.gameManagerCallback?.getCityAt?.(targetX, targetY) ? 'Nuke City' : 'Nuke Units';
  }

  private getNuclearActionSettings(action: NuclearSourceAction): {
    minRange: number;
    maxRange: number;
    actorConsumingAlways: boolean;
  } {
    const keys = NUCLEAR_ACTION_SETTINGS[action];
    const settings = rulesetLoader.loadActionsRuleset(this.getRulesetName()).settings;
    const minRange = Number(settings[keys.minRange]);
    const rawMaxRange = settings[keys.maxRange];
    const maxRange =
      rawMaxRange === 'unlimited'
        ? Number.POSITIVE_INFINITY
        : Number.isFinite(Number(rawMaxRange))
          ? Number(rawMaxRange)
          : minRange;
    return {
      minRange: Number.isFinite(minRange) ? minRange : 0,
      maxRange,
      actorConsumingAlways: settings[keys.actorConsumingAlways] !== false,
    };
  }

  private getNuclearBlastRadiusSquared(unit: Unit, action: NuclearSourceAction): number {
    const type = this.unitTypes[unit.unitTypeId];
    const result = this.effectsManager?.calculateEffect(EffectType.NUKE_BLAST_RADIUS_1_SQ, {
      playerId: unit.playerId,
      unitId: unit.id,
      unitType: unit.unitTypeId,
      unitClass: type?.rulesetUnitClass,
      unitClassFlags: new Set(type?.rulesetUnitClassFlags ?? []),
      unitTypeFlags: new Set(type?.flags ?? []),
      action,
    });
    // Older converted ruleset bundles did not retain the blast-radius effect.
    // Keep their established radius-one behavior while source-backed bundles
    // (including Civ2Civ3) use the exact effect value.
    if (!result?.effects.length) return 1;
    const radius = result.value;
    if (radius === undefined || !Number.isFinite(radius)) return 0;
    return Math.max(0, Math.floor(radius));
  }

  private getNuclearBlastPositions(
    centerX: number,
    centerY: number,
    radiusSquared: number
  ): Array<{ x: number; y: number }> {
    return this.getMapTopology().getPositionsWithinSquaredRadius(centerX, centerY, radiusSquared);
  }

  private async destroyNuclearUnits(
    centerX: number,
    centerY: number,
    radiusSquared: number
  ): Promise<string[]> {
    const positions = new Set(
      this.getNuclearBlastPositions(centerX, centerY, radiusSquared).map(({ x, y }) => `${x},${y}`)
    );
    const affectedUnitIds = [...this.units.values()]
      .filter(target => positions.has(`${target.x},${target.y}`))
      .map(target => target.id);
    for (const targetId of affectedUnitIds) await this.destroyUnit(targetId);
    return affectedUnitIds;
  }

  private applyNuclearFallout(centerX: number, centerY: number, radiusSquared: number): void {
    const falloutPositions = this.getNuclearBlastPositions(centerX, centerY, radiusSquared);
    for (const { x, y } of falloutPositions) {
      const tile = this.mapManager?.getTile(x, y);
      if (this.canReceiveNuclearFallout(x, y, tile) && randomInt(this.random, 2) === 1) {
        this.mapManager!.updateTileProperty(x, y, 'improvements', [
          ...tile!.improvements,
          'fallout',
        ]);
      }
    }
  }

  private canReceiveNuclearFallout(
    x: number,
    y: number,
    tile: { terrain: string; improvements: string[] } | undefined
  ): boolean {
    return Boolean(
      tile &&
      !this.gameManagerCallback?.getCityAt?.(x, y) &&
      !['ocean', 'coast', 'deep_ocean', 'lake'].includes(tile.terrain) &&
      !tile.improvements.includes('fallout')
    );
  }

  private async canNuclearStrikeTarget(
    unit: Unit,
    action: NuclearSourceAction,
    targetX: number,
    targetY: number
  ): Promise<boolean> {
    if (action === 'Explode Nuclear') return true;
    const targetPlayerIds = new Set<string>();
    if (action === 'Nuke City') {
      const city = this.gameManagerCallback?.getCityAt?.(targetX, targetY);
      if (city && city.playerId !== unit.playerId) targetPlayerIds.add(city.playerId);
    } else {
      for (const target of this.getUnitsAt(targetX, targetY)) {
        if (target.playerId !== unit.playerId && !target.transportedBy) {
          targetPlayerIds.add(target.playerId);
        }
      }
    }
    if (targetPlayerIds.size === 0) return false;
    if (!this.hostilityProvider) return true;
    for (const targetPlayerId of targetPlayerIds) {
      if (!(await this.hostilityProvider(unit.playerId, targetPlayerId))) return false;
    }
    return true;
  }

  private findNuclearDefense(
    unit: Unit,
    centerX: number,
    centerY: number
  ): CityAtLocation | undefined {
    for (const position of this.getMapTopology().getPositionsWithinSquareRadius(
      centerX,
      centerY,
      2
    )) {
      const city = this.gameManagerCallback?.getCityAt?.(position.x, position.y);
      if (!city || city.playerId === unit.playerId) continue;
      const diplomaticRelations = new Set<string>(['Foreign']);
      if (this.sameTeamProvider?.(unit.playerId, city.playerId)) {
        diplomaticRelations.add('Team');
      }
      const defenseChance = this.effectsManager?.calculateEffect(EffectType.NUKE_PROOF, {
        playerId: city.playerId,
        cityId: city.id,
        cityBuildings: new Set(city.buildings ?? []),
        tileX: centerX,
        tileY: centerY,
        diplomaticRelations,
      }).value;
      if (defenseChance && randomInt(this.random, 100) < defenseChance) return city;
    }
    return undefined;
  }

  /**
   * Capture the foreign stack targeted by C2C3's Capture Units action.
   *
   * The source result transfers, rather than destroys, every foreign unit on
   * the stack after one Capturable, non-transporting unit makes the action
   * legal. Captured units retain their movement and are re-homed to the
   * capturer's city when one exists.
   *
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:681-695
   * @reference reference/freeciv/common/actions.c:249-257
   * @reference reference/freeciv/server/unithand.c:282-496
   */
  private async executeCaptureUnits(
    unit: Unit,
    targetX?: number,
    targetY?: number
  ): Promise<ActionResult> {
    if (!this.canCaptureUnits(unit, targetX, targetY)) {
      return { success: false, message: 'Unit cannot capture units on that tile' };
    }
    if (!(await this.isHostileArea(unit, targetX!, targetY!, 0))) {
      return { success: false, message: 'Capturing units requires a state of war' };
    }

    const targets = this.getCaptureTargets(unit, targetX!, targetY!);
    if (this.hasUniqueCaptureConflict(unit, targets)) {
      return { success: false, message: 'Capturing this stack would duplicate a unique unit' };
    }

    for (const target of targets) {
      await this.transferCapturedUnit(target, unit);
    }
    const movementLeft = await this.consumeActionMovement(unit, 'Capture Units');
    return {
      success: true,
      message: `Captured ${targets.length} unit(s)`,
      affectedUnitIds: targets.map(target => target.id),
      newMovementLeft: movementLeft,
    };
  }

  private canCaptureUnits(unit: Unit, targetX?: number, targetY?: number): boolean {
    const unitType = this.unitTypes[unit.unitTypeId];
    if (!this.hasCaptureActorRequirements(unit, unitType, targetX, targetY)) {
      return false;
    }
    const stack = this.getUnitsAt(targetX!, targetY!);
    // Capture Units is a stack action. A single domestic unit makes the
    // whole target stack illegal, even if an enemy Capturable unit is also
    // present.
    // @reference reference/freeciv/common/actions.c:249-257
    if (stack.some(target => target.playerId === unit.playerId)) return false;
    return stack.some(
      target =>
        target.playerId !== unit.playerId &&
        this.unitTypes[target.unitTypeId]?.flags?.includes('Capturable') &&
        !(target.cargoUnits?.length ?? 0)
    );
  }

  private hasCaptureActorRequirements(
    unit: Unit,
    unitType: UnitType | undefined,
    targetX?: number,
    targetY?: number
  ): boolean {
    if (!unitType?.flags?.includes('Capturer') || unit.movementLeft <= 0) return false;
    if (targetX === undefined || targetY === undefined) return false;
    if (this.calculateDistance(unit.x, unit.y, targetX, targetY) !== 1) return false;
    return !this.gameManagerCallback?.getCityAt?.(targetX, targetY);
  }

  private getCaptureTargets(unit: Unit, targetX: number, targetY: number): Unit[] {
    return this.getUnitsAt(targetX, targetY).filter(target => target.playerId !== unit.playerId);
  }

  private hasUniqueCaptureConflict(capturer: Unit, targets: Unit[]): boolean {
    const capturedUniqueTypes = new Set<string>();
    const ownedTypes = new Set(this.getPlayerUnits(capturer.playerId).map(unit => unit.unitTypeId));
    return targets.some(target => {
      const type = this.unitTypes[target.unitTypeId];
      if (!type?.flags?.includes('Unique')) return false;
      if (ownedTypes.has(target.unitTypeId) || capturedUniqueTypes.has(target.unitTypeId))
        return true;
      capturedUniqueTypes.add(target.unitTypeId);
      return false;
    });
  }

  private async transferCapturedUnit(target: Unit, capturer: Unit): Promise<void> {
    const previousPlayerId = target.playerId;
    target.playerId = capturer.playerId;
    target.homeCityId = capturer.homeCityId;
    target.orders = [];
    target.automation = undefined;
    target.automationTask = undefined;
    target.fortified = false;
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
        playerId: target.playerId,
        homeCityId: target.homeCityId ?? null,
        orders: [],
        currentOrder: null,
        isAutomated: false,
        automationMode: null,
        automationTask: null,
        isFortified: false,
      })
      .where(eq(units.id, target.id));
    await this.recordPlayerStatistic(previousPlayerId, 'unitsLost');
    this.notifyUnitLifecycle({ type: 'owner_changed', unit: target, previousPlayerId });
  }

  private canCollectRansom(unit: Unit, targetX?: number, targetY?: number): boolean {
    const unitType = this.unitTypes[unit.unitTypeId];
    if (!this.hasRansomActorRequirements(unit, unitType, targetX, targetY)) return false;
    return this.getUnitsAt(targetX!, targetY!).some(
      target =>
        target.playerId !== unit.playerId &&
        !target.transportedBy &&
        this.isKnownBarbarianPlayer(target.playerId)
    );
  }

  private hasRansomActorRequirements(
    unit: Unit,
    unitType: UnitType | undefined,
    targetX?: number,
    targetY?: number
  ): boolean {
    if (!unitType || !this.isEligibleRansomActor(unitType)) return false;
    if (!this.hasAdjacentRansomCombatTarget(unit, targetX, targetY)) return false;
    return this.canCollectRansomFromTile(unit, unitType);
  }

  private isEligibleRansomActor(unitType: UnitType): boolean {
    return (
      !unitType.flags?.includes('NonMil') && !unitType.rulesetUnitClassFlags.includes('Missile')
    );
  }

  private hasAdjacentRansomCombatTarget(unit: Unit, targetX?: number, targetY?: number): boolean {
    if (targetX === undefined || targetY === undefined) return false;
    return (
      this.canTargetCombatUnit(unit, targetX, targetY) &&
      this.calculateDistance(unit.x, unit.y, targetX, targetY) === 1
    );
  }

  private canCollectRansomFromTile(unit: Unit, unitType: UnitType): boolean {
    return [
      this.isUnitOnNativeTile(unitType, unit.x, unit.y),
      unitType.flags?.includes('Marines'),
      unitType.rulesetUnitClassFlags.includes('AttFromNonNative'),
    ].some(Boolean);
  }

  private isKnownBarbarianPlayer(playerId: string): boolean {
    const nation = this.gameManagerCallback?.getPlayerNation?.(playerId)?.toLowerCase();
    return !nation || nation === 'barbarian' || nation.startsWith('barbarian');
  }

  /**
   * @reference reference/freeciv/server/unittools.c:2646-2725 collect_ransom()
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:827-870
   */
  private async executeCollectRansom(
    unit: Unit,
    targetX?: number,
    targetY?: number
  ): Promise<ActionResult> {
    if (!this.canCollectRansom(unit, targetX, targetY)) {
      return { success: false, message: 'Unit cannot collect ransom from that tile' };
    }
    const targets = this.getUnitsAt(targetX!, targetY!).filter(
      target => target.playerId !== unit.playerId
    );
    const victimPlayerId = targets[0].playerId;
    const victim = await this.databaseProvider.getDatabase().query.players.findFirst({
      where: eq(players.id, victimPlayerId),
    });
    const victimIsBarbarian = this.isBarbarianRecord(victim);
    if (!victim || !victimIsBarbarian) {
      return { success: false, message: 'Ransom can only be collected from barbarians' };
    }
    // Freeciv treats barbarian players as hostile even when the runtime has
    // no ordinary diplomatic record for them.
    // @reference reference/freeciv/data/civ2civ3/actions.ruleset:827-870
    // @reference reference/freeciv/server/unittools.c:2646-2725
    if (!(await this.isHostileArea(unit, targetX!, targetY!, 0)) && !victimIsBarbarian) {
      return { success: false, message: 'Collecting ransom requires a state of war' };
    }
    if (
      targets.some(target => !this.unitTypes[target.unitTypeId]?.flags?.includes('ProvidesRansom'))
    ) {
      return {
        success: false,
        message: 'Cannot collect ransom while an ordinary barbarian unit provides protection',
      };
    }
    const requested = targets.length * rulesetLoader.getGameParameters().ransom_gold;
    const ransom = Math.min(requested, victim.gold);
    for (const target of targets) await this.destroyUnit(target.id);
    if (ransom > 0) {
      const db = this.databaseProvider.getDatabase();
      await db
        .update(players)
        .set({ gold: sql`${players.gold} + ${ransom}` })
        .where(eq(players.id, unit.playerId));
      await db
        .update(players)
        .set({ gold: sql`${players.gold} - ${ransom}` })
        .where(eq(players.id, victimPlayerId));
    }
    // C2C3 sets occupychance to 100, so a successful ransom collection
    // forced-moves the winning collector onto the now-cleared target tile.
    // @reference reference/freeciv/data/civ2civ3/game.ruleset:817-835
    // @reference reference/freeciv/common/actions.c:817-825
    // @reference reference/freeciv/server/unithand.c:5353-5411
    const movementLeft = await this.consumeActionMovement(unit, 'Collect Ransom', {
      x: targetX!,
      y: targetY!,
    });
    return {
      success: true,
      message: `${targets.length} barbarian unit(s) yielded ${ransom} gold`,
      targetDestroyed: true,
      affectedUnitIds: targets.map(target => target.id),
      newMovementLeft: movementLeft,
      newPosition: { x: unit.x, y: unit.y },
    };
  }

  private async consumeActionMovement(
    unit: Unit,
    sourceAction: string,
    targetPosition?: { x: number; y: number }
  ): Promise<number> {
    const unitType = this.unitTypes[unit.unitTypeId];
    const movementCost = unitType
      ? this.getActionSuccessMovementCost(unit, unitType, sourceAction)
      : unit.movementLeft;
    unit.movementLeft = Math.max(0, unit.movementLeft - movementCost);
    if (targetPosition) {
      unit.x = targetPosition.x;
      unit.y = targetPosition.y;
      unit.fortified = false;
    }
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
        movementPoints: String(unit.movementLeft),
        lastActionTurn: this.currentTurnProvider?.() ?? 1,
        ...(targetPosition ? { x: unit.x, y: unit.y, isFortified: false } : {}),
      })
      .where(eq(units.id, unit.id));
    return unit.movementLeft;
  }

  private async isHostileArea(
    actor: Unit,
    centerX: number,
    centerY: number,
    radius: number
  ): Promise<boolean> {
    if (!this.hostilityProvider) return true;
    const targetPlayerIds = this.getHostileAreaPlayers(actor, centerX, centerY, radius);
    if (targetPlayerIds.size === 0) return false;
    for (const targetPlayerId of targetPlayerIds) {
      if (!(await this.hostilityProvider(actor.playerId, targetPlayerId))) return false;
    }
    return true;
  }

  private getHostileAreaPlayers(
    actor: Unit,
    centerX: number,
    centerY: number,
    radius: number
  ): Set<string> {
    const targetPlayerIds = new Set<string>();
    for (const target of this.units.values()) {
      if (
        target.playerId !== actor.playerId &&
        this.calculateDistance(target.x, target.y, centerX, centerY) <= radius
      ) {
        targetPlayerIds.add(target.playerId);
      }
    }
    for (const position of this.getMapTopology().getPositionsWithinRadius(
      centerX,
      centerY,
      radius
    )) {
      const city = this.gameManagerCallback?.getCityAt?.(position.x, position.y);
      if (city && city.playerId !== actor.playerId) targetPlayerIds.add(city.playerId);
    }
    return targetPlayerIds;
  }

  private async executeSuicideAttack(
    unit: Unit,
    targetX?: number,
    targetY?: number
  ): Promise<ActionResult> {
    const unitType = this.unitTypes[unit.unitTypeId];
    if (
      !unitType?.rulesetUnitClassFlags.includes('Missile') ||
      unitType.flags?.includes('NonMil') ||
      !this.canTargetCombatUnit(unit, targetX, targetY)
    ) {
      return { success: false, message: 'Unit cannot perform a suicide attack' };
    }
    const defender = this.getUnitsAt(targetX!, targetY!).find(
      target => target.playerId !== unit.playerId && !target.transportedBy
    )!;
    const combat = await this.attackUnit(unit.id, defender.id, 'suicide');
    if (this.units.has(unit.id)) await this.destroyUnit(unit.id);
    return {
      success: true,
      message: combat.defenderDestroyed
        ? 'Suicide attack destroyed the target'
        : 'Suicide attack damaged the target',
      unitDestroyed: true,
      targetDestroyed: combat.defenderDestroyed,
      affectedUnitIds: [defender.id, ...(combat.collateralDestroyedIds ?? [])],
    };
  }

  private async setAutomation(unit: Unit, actionType: ActionType): Promise<ActionResult> {
    const automation: UnitAutomationMode =
      actionType === ActionType.AUTO_SETTLER ? 'worker' : 'explore';
    if (
      (automation === 'worker' && !this.unitTypes[unit.unitTypeId].canBuildImprovements) ||
      (automation === 'explore' && this.unitTypes[unit.unitTypeId].movement <= 0)
    ) {
      return { success: false, message: `Unit cannot use ${automation} automation` };
    }
    if (unit.automation === automation) {
      await this.clearAutomation(unit);
      return { success: true, message: `${automation} automation stopped`, newOrders: [] };
    }
    unit.automation = automation;
    unit.automationTask = undefined;
    unit.orders = [{ type: automation === 'worker' ? 'autoSettler' : 'autoExplore' }];
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
        isAutomated: true,
        automationMode: automation,
        automationTask: null,
        orders: unit.orders,
        currentOrder: unit.orders[0].type,
      })
      .where(eq(units.id, unit.id));
    return {
      success: true,
      message: `${automation} automation enabled`,
      newOrders: unit.orders,
    };
  }

  private async clearAutomation(unit: Unit): Promise<void> {
    if (!unit.automation) return;
    unit.automation = undefined;
    unit.automationTask = undefined;
    unit.autoExploreTarget = undefined;
    unit.orders = [];
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
        isAutomated: false,
        automationMode: null,
        automationTask: null,
        orders: [],
        currentOrder: null,
      })
      .where(eq(units.id, unit.id));
  }

  private async getDiplomaticState(playerId: string, otherPlayerId: string): Promise<string> {
    const player = await this.databaseProvider.getDatabase().query.players.findFirst({
      where: eq(players.id, playerId),
    });
    const relations = player?.diplomaticRelations;
    if (!relations || typeof relations !== 'object') return 'no_contact';
    const relation = (relations as Record<string, { state?: string }>)[otherPlayerId];
    return relation?.state ?? 'no_contact';
  }

  private async executeAuthoritativeGoto(
    unit: Unit,
    targetX?: number,
    targetY?: number,
    persistOrder = true
  ): Promise<ActionResult> {
    const targetError = this.validateGotoTarget(unit, targetX, targetY);
    if (targetError) return targetError;
    const foreignCityWarning = await this.getPeacefulForeignCityGotoWarning(
      unit,
      targetX!,
      targetY!
    );
    if (foreignCityWarning) return { success: false, message: foreignCityWarning };
    const foreignUnitWarning = await this.getPeacefulForeignUnitGotoWarning(
      unit,
      targetX!,
      targetY!
    );
    if (foreignUnitWarning) return { success: false, message: foreignUnitWarning };
    const foreignTerritoryWarning = await this.getPeacefulForeignTerritoryGotoWarning(
      unit,
      targetX!,
      targetY!
    );
    if (foreignTerritoryWarning) return { success: false, message: foreignTerritoryWarning };

    const startingMovement = unit.movementLeft;
    const pathResult = await this.gameManagerCallback!.requestPath(
      unit.playerId,
      unit.id,
      targetX!,
      targetY!
    );
    const path = pathResult.path?.tiles;
    const pathError = this.getGotoPathError(pathResult, path);
    if (pathError) return pathError;

    const movement = await this.moveAlongPath(unit, path.slice(1));
    if (movement.moved === 0) {
      return {
        success: false,
        message:
          movement.failure instanceof Error ? movement.failure.message : 'Cannot move along path',
      };
    }

    const reached = unit.x === targetX && unit.y === targetY;
    if (persistOrder) {
      await this.persistGotoOrder(unit, reached, targetX!, targetY!);
    } else {
      await this.clearPersistedOrders(unit);
    }
    return {
      success: true,
      message: reached ? 'Unit reached destination' : 'Unit will continue next turn',
      newPosition: { x: unit.x, y: unit.y },
      newMovementLeft: unit.movementLeft,
      movementCost: startingMovement - unit.movementLeft,
      newOrders: unit.orders,
    };
  }

  /**
   * Go To may target a foreign city so the client can preview the route, but
   * entering it is an attack/conquest action and requires a state of war.
   * Freeciv reports this as a diplomatic error instead of a generic path
   * failure; the player can declare war and retry the order.
   */
  private async getPeacefulForeignCityGotoWarning(
    unit: Unit,
    targetX: number,
    targetY: number
  ): Promise<string | undefined> {
    const city = this.gameManagerCallback?.getCityAt?.(targetX, targetY);
    if (
      !city ||
      city.playerId === unit.playerId ||
      this.alliedPlayersProvider?.(unit.playerId).has(city.playerId) ||
      !this.canUnitCaptureCity(this.unitTypes[unit.unitTypeId]) ||
      !this.hostilityProvider
    ) {
      return undefined;
    }

    if (await this.hostilityProvider(unit.playerId, city.playerId)) return undefined;
    return `Cannot enter ${city.playerId}'s city unless you declare war first.`;
  }

  private async getPeacefulForeignUnitGotoWarning(
    unit: Unit,
    targetX: number,
    targetY: number
  ): Promise<string | undefined> {
    if (!this.canUnitAttackForeignUnit(unit) || !this.hostilityProvider) return undefined;
    const target = this.getUnitsAt(targetX, targetY).find(
      candidate =>
        candidate.playerId !== unit.playerId &&
        !this.alliedPlayersProvider?.(unit.playerId).has(candidate.playerId)
    );
    if (!target || (await this.hostilityProvider(unit.playerId, target.playerId))) return undefined;
    return `Cannot invade unless you break peace with ${target.playerId} first.`;
  }

  private async getPeacefulForeignTerritoryGotoWarning(
    unit: Unit,
    targetX: number,
    targetY: number
  ): Promise<string | undefined> {
    if (!this.canUnitAttackForeignUnit(unit) || !this.hostilityProvider) return undefined;
    const owner = this.mapManager?.getTile?.(targetX, targetY)?.owner;
    if (
      !owner ||
      owner === unit.playerId ||
      this.alliedPlayersProvider?.(unit.playerId).has(owner) ||
      this.hostilePlayersProvider?.(unit.playerId).has(owner)
    ) {
      return undefined;
    }
    if (await this.hostilityProvider(unit.playerId, owner)) return undefined;
    return `Cannot invade unless you break peace with ${owner} first.`;
  }

  private getGotoPathError(
    pathResult: { success: boolean; error?: string },
    path: Array<{ x: number; y: number }> | undefined
  ): ActionResult | undefined {
    if (pathResult.success && Array.isArray(path) && path.length >= 2) return undefined;
    return { success: false, message: pathResult.error ?? 'No valid path to target' };
  }

  private validateGotoTarget(
    unit: Unit,
    targetX?: number,
    targetY?: number
  ): ActionResult | undefined {
    if (targetX === undefined || targetY === undefined || !this.isValidPosition(targetX, targetY)) {
      return { success: false, message: 'Invalid target coordinates' };
    }
    if (unit.x === targetX && unit.y === targetY) {
      return { success: false, message: 'Unit is already at target position' };
    }
    if (!this.gameManagerCallback?.requestPath) {
      return { success: false, message: 'Pathfinding target is unavailable' };
    }
    return undefined;
  }

  private async moveAlongPath(
    unit: Unit,
    steps: Array<{ x: number; y: number }>
  ): Promise<{ moved: number; failure?: unknown }> {
    let moved = 0;
    let failure: unknown;
    for (const step of steps) {
      if (unit.movementLeft <= 0) break;
      try {
        await this.moveUnit(unit.id, step.x, step.y);
        moved++;
      } catch (error) {
        failure = error;
        break;
      }
    }
    return { moved, failure };
  }

  private async persistGotoOrder(
    unit: Unit,
    reached: boolean,
    targetX: number,
    targetY: number
  ): Promise<void> {
    unit.orders = reached ? [] : [{ type: 'move', targetX, targetY }];
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ orders: unit.orders, currentOrder: unit.orders[0]?.type ?? null })
      .where(eq(units.id, unit.id));
    this.gameManagerCallback!.broadcastUnitMoved(
      this.gameId,
      unit.id,
      unit.x,
      unit.y,
      unit.movementLeft
    );
  }

  /**
   * Check if unit can perform action
   */
  canUnitPerformAction(
    unitId: string,
    actionType: ActionType,
    targetX?: number,
    targetY?: number
  ): boolean {
    const unit = this.units.get(unitId);
    if (!unit) return false;

    return this.canUnitPerformActionForUnit(unit, actionType, targetX, targetY);
  }

  /**
   * Validate a terrain activity at a future worksite without moving or
   * mutating the authoritative unit. Worker planners use this while ranking
   * remote tiles; execution still validates against the unit's real position.
   */
  canUnitPerformActionAt(
    unitId: string,
    actionType: ActionType,
    targetX: number,
    targetY: number
  ): boolean {
    const unit = this.units.get(unitId);
    if (!unit) return false;
    if (!this.isWorkerTerrainAction(actionType)) {
      return this.canUnitPerformActionForUnit(unit, actionType, targetX, targetY);
    }
    return this.canUnitPerformActionForUnit(
      { ...unit, x: targetX, y: targetY },
      actionType,
      targetX,
      targetY
    );
  }

  private canUnitPerformActionForUnit(
    unit: Unit,
    actionType: ActionType,
    targetX?: number,
    targetY?: number
  ): boolean {
    if (
      this.isRulesetWorkerAction(actionType) &&
      !this.canPerformRulesetWorkerAction(unit, actionType, targetX, targetY)
    ) {
      return false;
    }

    const directCheck = this.getDirectUnitActionCheck(unit, actionType);
    if (directCheck) return directCheck(targetX, targetY);

    if (this.getRulesetName() === 'classic' && actionType === ActionType.BUILD_FORTRESS) {
      return (
        this.playerTechsProvider(unit.playerId).has('construction') &&
        this.actionSystem.canUnitPerformAction(unit, actionType, targetX, targetY)
      );
    }
    if (this.getRulesetName() === 'classic' && actionType === ActionType.BUILD_AIRBASE) {
      return (
        this.playerTechsProvider(unit.playerId).has('radio') &&
        this.actionSystem.canUnitPerformAction(unit, actionType, targetX, targetY)
      );
    }

    return this.actionSystem.canUnitPerformAction(unit, actionType, targetX, targetY);
  }

  private isWorkerTerrainAction(actionType: ActionType): boolean {
    return new Set([
      ActionType.BUILD_ROAD,
      ActionType.BUILD_RAILROAD,
      ActionType.BUILD_IRRIGATION,
      ActionType.BUILD_MINE,
      ActionType.CULTIVATE,
      ActionType.PLANT,
      ActionType.BUILD_FORTRESS,
      ActionType.BUILD_AIRBASE,
      ActionType.TRANSFORM_TERRAIN,
      ActionType.CLEAN_POLLUTION,
    ]).has(actionType);
  }

  private isRulesetWorkerAction(actionType: ActionType): boolean {
    return new Set([
      ActionType.BUILD_ROAD,
      ActionType.BUILD_RAILROAD,
      ActionType.BUILD_IRRIGATION,
      ActionType.BUILD_MINE,
      ActionType.CULTIVATE,
      ActionType.PLANT,
      ActionType.BUILD_FORTRESS,
      ActionType.BUILD_AIRBASE,
      ActionType.PILLAGE,
      ActionType.TRANSFORM_TERRAIN,
      ActionType.CLEAN_POLLUTION,
    ]).has(actionType);
  }

  private canPerformRulesetWorkerAction(
    unit: Unit,
    actionType: ActionType,
    targetX?: number,
    targetY?: number
  ): boolean {
    // The legacy classic ruleset does not expose the complete action/extra
    // requirement vectors used by civ2civ3. Preserve its existing dedicated
    // validators; apply the universal evaluator whenever the active ruleset
    // supplies the reference vectors.
    return this.evaluateRulesetWorkerAction(unit, actionType, targetX, targetY).allowed;
  }

  private evaluateRulesetWorkerAction(
    unit: Unit,
    actionType: ActionType,
    targetX?: number,
    targetY?: number
  ): RulesetWorkerActionEvaluation {
    if (this.getRulesetName() === 'classic') return { allowed: true };
    const effectiveX = targetX ?? unit.x;
    const effectiveY = targetY ?? unit.y;
    const tile = this.mapManager?.getTile(effectiveX, effectiveY) as any;
    if (!tile) return { allowed: false };
    const rulesetName = this.getRulesetName();
    const unitType = this.unitTypes[unit.unitTypeId];
    const terrain = rulesetLoader.getTerrain(tile.terrain, rulesetName) as any;
    const tileExtras = [
      ...(tile.improvements ?? []),
      ...(tile.hasRoad ? ['Road'] : []),
      ...(tile.hasRailroad ? ['Railroad'] : []),
    ];
    const adjacent =
      this.mapManager?.getTopology?.().getCardinalNeighbors(effectiveX, effectiveY) ?? [];
    const adjacentTiles = adjacent
      .map(({ x, y }: { x: number; y: number }) => this.mapManager?.getTile(x, y))
      .filter(Boolean) as any[];
    const tileCityTiles = this.gameManagerCallback?.getCityAt?.(effectiveX, effectiveY)
      ? new Set(['Center'])
      : new Set<string>();
    const facts = {
      Local: {
        unitTypeFlags: new Set([
          ...(unitType?.flags ?? []),
          ...(unitType?.rulesetUnitClassFlags ?? []),
        ]),
        unitClass: unitType?.rulesetUnitClass,
        unitClassFlags: new Set(unitType?.rulesetUnitClassFlags ?? []),
        extras: new Set<string>(tileExtras),
        extraFlags: this.getExtraFlags(tileExtras, rulesetName),
        moves: unit.movementLeft,
      },
      Tile: {
        terrain: tile.terrain,
        terrainClass: terrain.class,
        terrainAlterations: this.getTerrainAlterations(terrain),
        cityTiles: tileCityTiles,
        extras: new Set<string>(tileExtras),
        extraFlags: this.getExtraFlags(tileExtras, rulesetName),
      },
      Target: {
        terrain: tile.terrain,
        terrainClass: terrain.class,
        terrainAlterations: this.getTerrainAlterations(terrain),
        cityTiles: tileCityTiles,
        extras: new Set<string>(tileExtras),
        extraFlags: this.getExtraFlags(tileExtras, rulesetName),
      },
      Player: { technologies: this.playerTechsProvider(unit.playerId) },
      CAdjacent: {
        terrainClass: new Set(
          adjacentTiles.map(
            neighbor => (rulesetLoader.getTerrain(neighbor.terrain, rulesetName) as any).class
          )
        ),
        extras: new Set<string>(adjacentTiles.flatMap(neighbor => neighbor.improvements ?? [])),
        extraFlags: this.getExtraFlags(
          adjacentTiles.flatMap(neighbor => neighbor.improvements ?? []),
          rulesetName
        ),
      },
    };
    const actionNames: Partial<Record<ActionType, string>> = {
      [ActionType.BUILD_ROAD]: 'Build Road',
      // Freeciv uses the Build Road enabler for both roads and railroads;
      // the Railroad extra carries the additional technology/extra guards.
      [ActionType.BUILD_RAILROAD]: 'Build Road',
      [ActionType.BUILD_IRRIGATION]: 'Build Irrigation',
      [ActionType.BUILD_MINE]: 'Build Mine',
      [ActionType.CULTIVATE]: 'Cultivate',
      [ActionType.PLANT]: 'Plant',
      [ActionType.BUILD_FORTRESS]: 'Build Base',
      [ActionType.BUILD_AIRBASE]: 'Build Base',
      [ActionType.PILLAGE]: 'Pillage',
      [ActionType.TRANSFORM_TERRAIN]: 'Transform Terrain',
      [ActionType.CLEAN_POLLUTION]: 'Clean',
    };
    const actionName = actionNames[actionType];
    const actionEnablers = actionName
      ? rulesetLoader.getActionEnablersFor(actionName, rulesetName)
      : [];
    const extraCandidates = this.getRulesetWorkerExtraCandidates(actionType, rulesetName);
    const presentExtraKeys = new Set(
      tileExtras.map(extra => extra.toLowerCase().replace(/[^a-z0-9]/g, ''))
    );
    const selectedExtra = extraCandidates.find(candidate => {
      const candidateKey = candidate.storageKey.toLowerCase().replace(/[^a-z0-9]/g, '');
      return (
        !presentExtraKeys.has(candidateKey) &&
        (!candidate.extra.reqs || this.rulesetRequirements.evaluateAll(candidate.extra.reqs, facts))
      );
    });
    const actionAllowed =
      actionEnablers.length === 0 ||
      actionEnablers.some(
        enabler =>
          this.rulesetRequirements.evaluateAll(enabler.actor_reqs, facts) &&
          this.rulesetRequirements.evaluateAll(enabler.target_reqs, facts)
      );
    return {
      allowed: actionAllowed && (extraCandidates.length === 0 || selectedExtra !== undefined),
      ...(selectedExtra ? { improvementType: selectedExtra.storageKey } : {}),
    };
  }

  /**
   * Resolve the concrete extra that a generic Freeciv activity will create.
   * A single action can legally create several extras: for example c2c3's
   * Build Mine produces Mine on land but Oil Platform on Deep Ocean after
   * Miniaturization. The source extra requirements choose among them.
   */
  private getRulesetWorkerExtraCandidates(
    actionType: ActionType,
    rulesetName: string
  ): Array<{ storageKey: string; extra: { causes?: string | string[]; reqs?: any[] } }> {
    const baseExtraNames: Partial<Record<ActionType, string[]>> = {
      [ActionType.BUILD_FORTRESS]: ['Fort', 'Fortress'],
      [ActionType.BUILD_AIRBASE]: ['Airstrip', 'Airbase'],
    };
    const baseNames = baseExtraNames[actionType];
    if (baseNames) {
      const extras = rulesetLoader.getExtras(rulesetName);
      return baseNames.flatMap(name => {
        const entry = Object.entries(extras).find(
          ([id, extra]) => id === name || extra.name === name
        );
        return entry ? [{ storageKey: entry[0].replace(/^extra_/, ''), extra: entry[1] }] : [];
      });
    }
    const namedExtras: Partial<Record<ActionType, string>> = {
      [ActionType.BUILD_ROAD]: 'Road',
      [ActionType.BUILD_RAILROAD]: 'Railroad',
      [ActionType.BUILD_IRRIGATION]: 'Irrigation',
    };
    const namedExtra = namedExtras[actionType];
    if (namedExtra) {
      const entry = Object.entries(rulesetLoader.getExtras(rulesetName)).find(
        ([id, extra]) => id === namedExtra || extra.name === namedExtra
      );
      return entry ? [{ storageKey: entry[0].replace(/^extra_/, ''), extra: entry[1] }] : [];
    }
    if (actionType !== ActionType.BUILD_MINE) return [];

    return Object.entries(rulesetLoader.getExtras(rulesetName))
      .filter(([, extra]) => {
        const causes = Array.isArray(extra.causes) ? extra.causes : [extra.causes];
        return causes.some(cause => cause === 'Mine');
      })
      .map(([id, extra]) => ({ storageKey: id.replace(/^extra_/, ''), extra }));
  }

  private getTerrainAlterations(terrain: any): Set<string> {
    const alterations = new Set<string>();
    if (terrain?.roadTime > 0) alterations.add('CanRoad');
    if (terrain?.irrigationTime > 0) alterations.add('CanIrrigate');
    if (terrain?.miningTime > 0) alterations.add('CanMine');
    if (terrain?.transformTo) alterations.add('CanTransform');
    if (terrain?.cultivateTo) alterations.add('CanCultivate');
    if (terrain?.plantTo) alterations.add('CanPlant');
    if (!['ocean', 'deep_ocean', 'coast', 'lake'].includes(String(terrain?.name).toLowerCase())) {
      alterations.add('CanBase');
    }
    return alterations;
  }

  private getExtraFlags(extraNames: string[], rulesetName: string): Set<string> {
    return new Set(
      extraNames.flatMap(name => {
        let flags: unknown;
        try {
          flags = rulesetLoader.getExtra(name, rulesetName)?.flags;
        } catch {
          flags = undefined;
        }
        return Array.isArray(flags) ? flags : typeof flags === 'string' ? [flags] : [];
      })
    );
  }

  private getDirectUnitActionCheck(
    unit: Unit,
    actionType: ActionType
  ): ((targetX?: number, targetY?: number) => boolean) | undefined {
    const checks: Partial<Record<ActionType, (targetX?: number, targetY?: number) => boolean>> = {
      [ActionType.LOAD_UNIT]: (targetX, targetY) =>
        targetX === undefined || targetY === undefined
          ? Boolean(this.findAvailableTransportAt(unit, unit.x, unit.y))
          : targetX === unit.x && targetY === unit.y
            ? Boolean(this.findAvailableTransportAt(unit, targetX, targetY))
            : false,
      [ActionType.UNLOAD_UNIT]: (targetX, targetY) =>
        this.canUnloadUnit(unit.id, targetX ?? unit.x, targetY ?? unit.y),
      [ActionType.PARADROP]: (targetX, targetY) => this.canParadrop(unit, targetX, targetY),
      [ActionType.AIRLIFT]: (targetX, targetY) => this.canAirlift(unit, targetX, targetY),
      [ActionType.BOMBARD]: (targetX, targetY) => this.canBombard(unit, targetX, targetY),
      [ActionType.NUCLEAR_EXPLOSION]: (targetX, targetY) =>
        this.canNuclearExplode(unit, targetX, targetY),
      [ActionType.CAPTURE_UNITS]: (targetX, targetY) =>
        this.canCaptureUnits(unit, targetX, targetY),
      [ActionType.COLLECT_RANSOM]: (targetX, targetY) =>
        this.canCollectRansom(unit, targetX, targetY),
      [ActionType.SUICIDE_ATTACK]: (targetX, targetY) =>
        this.unitTypes[unit.unitTypeId].rulesetUnitClassFlags.includes('Missile') &&
        this.canTargetCombatUnit(unit, targetX, targetY),
      [ActionType.AUTO_EXPLORE]: () => this.unitTypes[unit.unitTypeId].movement > 0,
      [ActionType.AUTO_SETTLER]: () => this.unitTypes[unit.unitTypeId].canBuildImprovements,
      [ActionType.PATROL]: (targetX, targetY) =>
        targetX !== undefined &&
        targetY !== undefined &&
        unit.movementLeft > 0 &&
        (unit.x !== targetX || unit.y !== targetY) &&
        this.isValidPosition(targetX, targetY),
      [ActionType.MARKETPLACE]: (targetX, targetY) =>
        this.canPerformCityUnitActionAtTarget(unit, actionType, targetX, targetY),
      [ActionType.HELP_WONDER]: (targetX, targetY) =>
        this.canPerformCityUnitActionAtTarget(unit, actionType, targetX, targetY),
      [ActionType.JOIN_CITY]: (targetX, targetY) =>
        this.canPerformCityUnitActionAtTarget(unit, actionType, targetX, targetY),
      [ActionType.DISBAND_UNIT_RECOVER]: (targetX, targetY) =>
        this.canPerformCityUnitActionAtTarget(unit, actionType, targetX, targetY),
      [ActionType.CHANGE_HOME_CITY]: (targetX, targetY) =>
        this.canChangeHomeCity(unit, targetX, targetY),
      [ActionType.UPGRADE_UNIT]: () => this.canUpgradeUnit(unit),
    };
    return checks[actionType];
  }

  private canPerformCityUnitActionAtTarget(
    unit: Unit,
    actionType: ActionType,
    targetX?: number,
    targetY?: number
  ): boolean {
    return (
      targetX !== undefined &&
      targetY !== undefined &&
      this.canPerformCityUnitAction(unit, actionType, targetX, targetY)
    );
  }

  private canChangeHomeCity(unit: Unit, targetX?: number, targetY?: number): boolean {
    if (targetX === undefined || targetY === undefined) return false;
    const city = this.gameManagerCallback?.getCityAt?.(targetX, targetY);
    const unitType = this.unitTypes[unit.unitTypeId];
    if (!city) return false;
    if (city.playerId !== unit.playerId) return false;
    if (unit.x !== targetX) return false;
    if (unit.y !== targetY) return false;
    if (unitType.flags?.includes('Diplomat')) return true;
    return Boolean(unit.homeCityId && this.canUnitHaveHomeCity(unitType));
  }

  private canUnitHaveHomeCity(unitType: UnitType): boolean {
    return !unitType.flags?.includes('NoHome');
  }

  private canUpgradeUnit(unit: Unit): boolean {
    const city = this.gameManagerCallback?.getCityAt?.(unit.x, unit.y);
    const from = this.unitTypes[unit.unitTypeId];
    const to = from ? this.getBestUpgrade(from, unit.playerId) : undefined;
    return Boolean(city && city.playerId === unit.playerId && to);
  }

  /**
   * Apply action result to unit state
   */
  private async applyActionResult(
    unit: Unit,
    actionType: ActionType,
    result: ActionResult
  ): Promise<void> {
    const updateData = await this.getActionResultUpdate(unit, actionType, result);
    if (updateData === null) return;

    if (Object.keys(updateData).length > 0) {
      await this.databaseProvider
        .getDatabase()
        .update(units)
        .set(updateData)
        .where(eq(units.id, unit.id));
    }

    logger.info(`Applied action result for unit ${unit.id}`, {
      unitId: unit.id,
      action: actionType,
      result: result.success,
      updateData,
    });
  }

  private async getActionResultUpdate(
    unit: Unit,
    actionType: ActionType,
    result: ActionResult
  ): Promise<Record<string, unknown> | null> {
    const handlers: Partial<Record<ActionType, () => Record<string, unknown>>> = {
      [ActionType.FORTIFY]: () => this.handleFortify(unit),
      [ActionType.SENTRY]: () => this.handleSentry(unit),
      [ActionType.SKIP_TURN]: () => {
        unit.movementLeft = 0;
        return { movementPoints: '0' };
      },
      [ActionType.GOTO]: () => this.handleGoto(unit, result),
      [ActionType.BUILD_ROAD]: () => this.handleWorkerActivity(unit, actionType),
      [ActionType.BUILD_RAILROAD]: () => this.handleWorkerActivity(unit, actionType),
      [ActionType.BUILD_IRRIGATION]: () => this.handleWorkerActivity(unit, actionType),
      [ActionType.BUILD_MINE]: () => this.handleWorkerActivity(unit, actionType),
      [ActionType.CULTIVATE]: () => this.handleWorkerActivity(unit, actionType),
      [ActionType.PLANT]: () => this.handleWorkerActivity(unit, actionType),
      [ActionType.BUILD_FORTRESS]: () => this.handleWorkerActivity(unit, actionType),
      [ActionType.BUILD_AIRBASE]: () => this.handleWorkerActivity(unit, actionType),
      [ActionType.PILLAGE]: () => this.handleWorkerActivity(unit, actionType),
      [ActionType.TRANSFORM_TERRAIN]: () => this.handleWorkerActivity(unit, actionType),
      [ActionType.CLEAN_POLLUTION]: () => this.handleWorkerActivity(unit, actionType),
    };
    const handler = handlers[actionType];
    if (handler) return handler();
    if (actionType === ActionType.FOUND_CITY && (await this.handleFoundCity(unit, result))) {
      return null;
    }
    if (actionType === ActionType.TRADE_ROUTE && result.unitDestroyed) {
      await this.destroyUnit(unit.id);
      return null;
    }
    if (actionType === ActionType.DISBAND_UNIT) {
      await this.destroyUnit(unit.id);
      return null;
    }
    return {};
  }

  private handleFortify(unit: Unit): any {
    unit.fortified = true;
    unit.movementLeft = 0;
    return { isFortified: true, movementPoints: '0' };
  }

  private handleSentry(unit: Unit): any {
    unit.movementLeft = 0;
    return { movementPoints: '0' };
  }

  private handleGoto(unit: Unit, result: ActionResult): any {
    if (!result.newPosition) return {};
    unit.x = result.newPosition.x;
    unit.y = result.newPosition.y;

    // Use the new movement left from ActionSystem instead of double-deducting
    if (result.newMovementLeft !== undefined) {
      unit.movementLeft = result.newMovementLeft;
    }

    // Update unit orders if provided
    if (result.newOrders !== undefined) {
      unit.orders = result.newOrders;
    }
    const updateData = {
      x: unit.x,
      y: unit.y,
      movementPoints: unit.movementLeft.toString(),
      orders: JSON.stringify(unit.orders || []),
    };
    if (this.gameManagerCallback?.broadcastUnitMoved) {
      this.gameManagerCallback.broadcastUnitMoved(
        this.gameId,
        unit.id,
        unit.x,
        unit.y,
        unit.movementLeft
      );
    }
    return updateData;
  }

  private async handleFoundCity(unit: Unit, result: ActionResult): Promise<boolean> {
    if (result.unitDestroyed) {
      await this.destroyUnit(unit.id);
      return true;
    }
    return false;
  }

  private handleWorkerActivity(unit: Unit, actionType: ActionType): any {
    const orderTypes: Partial<Record<ActionType, UnitOrder['type']>> = {
      [ActionType.BUILD_ROAD]: 'road',
      [ActionType.BUILD_RAILROAD]: 'railroad',
      [ActionType.BUILD_IRRIGATION]: 'irrigate',
      [ActionType.BUILD_MINE]: 'mine',
      [ActionType.CULTIVATE]: 'cultivate',
      [ActionType.PLANT]: 'plant',
      [ActionType.BUILD_FORTRESS]: 'fortress',
      [ActionType.BUILD_AIRBASE]: 'airbase',
      [ActionType.PILLAGE]: 'pillage',
      [ActionType.TRANSFORM_TERRAIN]: 'transform',
      [ActionType.CLEAN_POLLUTION]: 'cleanPollution',
    };
    const orderType = orderTypes[actionType];
    if (!orderType) return {};
    const improvementType = this.evaluateRulesetWorkerAction(unit, actionType).improvementType;
    const defaultImprovementByOrder: Partial<Record<UnitOrder['type'], string>> = {
      road: 'road',
      railroad: 'railroad',
      irrigate: 'irrigation',
      mine: 'mine',
      fortress: 'fortress',
      airbase: 'airbase',
    };
    unit.orders = [
      {
        type: orderType,
        ...(improvementType && improvementType !== defaultImprovementByOrder[orderType]
          ? { improvementType }
          : {}),
      },
      ...(unit.automation === 'worker' ? ([{ type: 'autoSettler' }] as UnitOrder[]) : []),
    ];
    unit.activity = undefined;
    unit.movementLeft = 0;
    return {
      movementPoints: '0',
      orders: unit.orders,
      currentOrder: orderType,
      automationMode: unit.automation ?? null,
      automationTask: unit.automationTask ?? null,
    };
  }

  /**
   * Process pending orders for all units at the start of a turn
   * This handles multi-turn GOTO movements and other queued actions
   */
  async processUnitOrders(playerId: string): Promise<void> {
    const playerUnits = Array.from(this.units.values()).filter(u => u.playerId === playerId);
    const unitsWithOrders = playerUnits.filter(u => u.orders && u.orders.length > 0);

    logger.info('Processing unit orders at turn start', {
      gameId: this.gameId,
      playerId,
      totalPlayerUnits: playerUnits.length,
      unitsWithOrders: unitsWithOrders.length,
      orderDetails: unitsWithOrders.map(u => ({
        unitId: u.id,
        unitType: u.unitTypeId,
        position: { x: u.x, y: u.y },
        movementLeft: u.movementLeft,
        ordersCount: u.orders?.length || 0,
        firstOrder: u.orders?.[0] || null,
      })),
    });

    const processedActivities = new Set<string>();
    for (const unit of this.units.values()) {
      if (unit.playerId !== playerId || !unit.orders?.[0]) continue;
      const order = unit.orders[0];
      if (this.isActivityOrderType(order.type)) {
        if (this.unitTypes[unit.unitTypeId]?.canFoundCity) {
          await this.executeCancelOrders(unit);
          continue;
        }
        const key = `${playerId}:${unit.x}:${unit.y}:${order.type}`;
        if (processedActivities.has(key)) continue;
        const group = [...this.units.values()].filter(
          candidate =>
            candidate.playerId === playerId &&
            candidate.x === unit.x &&
            candidate.y === unit.y &&
            !this.unitTypes[candidate.unitTypeId]?.canFoundCity &&
            candidate.orders?.[0]?.type === order.type
        );
        await this.processActivityGroup(group);
        processedActivities.add(key);
        continue;
      }
      await this.processUnitOrder(unit, playerId);
    }
  }

  private isActivityOrderType(orderType: UnitOrder['type']): boolean {
    return new Set<UnitOrder['type']>([
      'road',
      'railroad',
      'irrigate',
      'mine',
      'cultivate',
      'plant',
      'fortress',
      'airbase',
      'transform',
      'pillage',
      'cleanPollution',
    ]).has(orderType);
  }

  private getActivityWorkRate(unit: Unit): number {
    return unit.unitTypeId === 'engineers' ? 2 : 1;
  }

  private async processActivityGroup(group: Unit[]): Promise<void> {
    if (group.length === 0) return;
    const orderType = group[0]!.orders![0]!.type;

    for (const unit of group) {
      const order = unit.orders![0]!;
      if (!order.activity || order.activity.type === 'idle') {
        const turnsRequired = this.getActivityDuration(order, unit);
        order.activity = {
          type: this.getActivityTypeFromOrder(orderType),
          turnsRemaining: turnsRequired,
          totalTurns: turnsRequired,
          target: { x: unit.x, y: unit.y },
        };
      }
    }

    const requiredWork = Math.max(
      ...group.map(unit => this.getActivityWorkRate(unit) * unit.orders![0]!.activity!.totalTurns)
    );
    const previousWork = Math.max(
      ...group.map(unit => {
        const activity = unit.orders![0]!.activity!;
        return (activity.totalTurns - activity.turnsRemaining) * this.getActivityWorkRate(unit);
      })
    );
    const currentWork =
      previousWork + group.reduce((sum, unit) => sum + this.getActivityWorkRate(unit), 0);

    // In Freeciv each turn of useful worker activity has its own veteran
    // roll, regardless of whether the activity completes on this turn.
    for (const unit of group) {
      await this.maybePromoteAfterWork(unit);
    }

    if (currentWork >= requiredWork) {
      await this.completeActivity(group[0]!, group[0]!.orders![0]!);
      for (const unit of group) {
        unit.activity = { type: 'idle', turnsRemaining: 0, totalTurns: 0 };
        this.removeCurrentOrder(unit);
        unit.movementLeft = 0;
        await this.databaseProvider
          .getDatabase()
          .update(units)
          .set({
            movementPoints: '0',
            orders: unit.orders ?? [],
            currentOrder: unit.orders?.[0]?.type ?? null,
          })
          .where(eq(units.id, unit.id));
      }
      return;
    }

    for (const unit of group) {
      const order = unit.orders![0]!;
      const activity = order.activity!;
      const rate = this.getActivityWorkRate(unit);
      activity.totalTurns = Math.ceil(requiredWork / rate);
      activity.turnsRemaining = Math.ceil((requiredWork - currentWork) / rate);
      unit.activity = activity;
      unit.movementLeft = 0;
      await this.databaseProvider
        .getDatabase()
        .update(units)
        .set({
          movementPoints: '0',
          orders: unit.orders ?? [],
          currentOrder: unit.orders?.[0]?.type ?? null,
        })
        .where(eq(units.id, unit.id));
    }
  }

  /**
   * Process a single unit's pending order
   * @reference freeciv-web/javascript/unit.js unit order processing
   */
  private async processUnitOrder(unit: Unit, playerId: string): Promise<void> {
    // Early return if unit doesn't belong to player or has no valid orders
    if (!this.shouldProcessUnitOrder(unit, playerId)) {
      return;
    }

    const order = unit.orders![0];
    const processor = this.getOrderProcessor(order.type);
    if (!processor) {
      logger.warn(`Unknown order type: ${order.type} for unit ${unit.id}`);
      this.removeCurrentOrder(unit);
      return;
    }
    await processor(unit, order);
  }

  private getOrderProcessor(
    orderType: UnitOrder['type']
  ): ((unit: Unit, order: UnitOrder) => Promise<void>) | undefined {
    const activityTypes = new Set<UnitOrder['type']>([
      'road',
      'railroad',
      'irrigate',
      'mine',
      'cultivate',
      'plant',
      'fortress',
      'airbase',
      'transform',
      'pillage',
      'cleanPollution',
    ]);
    const processors: Partial<
      Record<UnitOrder['type'], (unit: Unit, order: UnitOrder) => Promise<void>>
    > = {
      move: (unit, order) => this.processMoveOrder(unit, order),
      patrol: (unit, order) => this.processPatrolOrder(unit, order),
      fortify: (unit, order) => this.processFortifyOrder(unit, order),
      sentry: (unit, order) => this.processSentryOrder(unit, order),
      autoExplore: unit => this.processAutoExploreOrder(unit),
      autoSettler: unit => this.processAutoSettlerOrder(unit),
    };
    if (activityTypes.has(orderType)) {
      return (unit, order) => this.processActivityOrder(unit, order);
    }
    return processors[orderType];
  }

  /**
   * Check if a unit's order should be processed
   */
  private shouldProcessUnitOrder(unit: Unit, playerId: string): boolean {
    if (unit.playerId !== playerId) return false;
    if (!unit.orders || unit.orders.length === 0) return false;

    const currentOrder = unit.orders[0];

    // Activity orders can continue even without movement points
    const activityOrders = [
      'road',
      'railroad',
      'irrigate',
      'mine',
      'cultivate',
      'plant',
      'fortress',
      'airbase',
      'transform',
      'pillage',
      'cleanPollution',
    ];
    if (activityOrders.includes(currentOrder.type)) {
      return true;
    }

    // Movement orders require movement points
    return unit.movementLeft > 0;
  }

  /**
   * Process a move order for a unit
   */
  private async processMoveOrder(unit: Unit, order: any): Promise<void> {
    // Only process move orders with valid target coordinates
    if (order.type !== 'move' || order.targetX === undefined || order.targetY === undefined) {
      logger.debug('Skipping invalid move order', {
        unitId: unit.id,
        orderType: order.type,
        targetX: order.targetX,
        targetY: order.targetY,
      });
      return;
    }

    logger.info('Processing move order', {
      unitId: unit.id,
      unitType: unit.unitTypeId,
      currentPosition: { x: unit.x, y: unit.y },
      targetPosition: { x: order.targetX, y: order.targetY },
      movementLeft: unit.movementLeft,
    });

    const result = await this.executeAuthoritativeGoto(unit, order.targetX, order.targetY);

    logger.info('Move order execution result', {
      unitId: unit.id,
      success: result.success,
      message: result.message,
      newPosition: result.newPosition,
      newMovementLeft: result.newMovementLeft,
      hasNewOrders: !!result.newOrders && result.newOrders.length > 0,
    });

    if (result.success) {
      await this.handleSuccessfulGoto(unit, order, result);
    } else {
      await this.handleFailedGoto(unit, result);
    }
  }

  /**
   * Handle successful GOTO action result
   */
  private async handleSuccessfulGoto(unit: Unit, order: any, _result: any): Promise<void> {
    // Log completion or continuation status
    if (unit.x === order.targetX && unit.y === order.targetY) {
      logger.info(`Unit ${unit.id} completed GOTO to (${order.targetX}, ${order.targetY})`);
    } else {
      logger.info(`Unit ${unit.id} continued GOTO toward (${order.targetX}, ${order.targetY})`);
    }
  }

  /**
   * Handle failed GOTO action result
   */
  private async handleFailedGoto(unit: Unit, result: any): Promise<void> {
    const message = String(result.message ?? 'Unknown GOTO failure');
    // A path can become invalid after the order is created. Freeciv treats
    // that as a recoverable planning miss rather than a persistent error.
    if (/no valid path|pathfinding target is unavailable/i.test(message)) {
      logger.debug(`Discarding invalid GOTO order for unit ${unit.id}: ${message}`);
    } else {
      logger.warn(`Failed to process GOTO order for unit ${unit.id}: ${message}`);
    }
    await this.clearPersistedOrders(unit);
  }

  private async clearPersistedOrders(unit: Unit): Promise<void> {
    const hadOrders = (unit.orders?.length ?? 0) > 0;
    unit.orders = [];
    if (!hadOrders) return;
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ orders: [], currentOrder: null })
      .where(eq(units.id, unit.id));
  }

  /**
   * Process patrol order - move between two points repeatedly
   */
  private async processPatrolOrder(unit: Unit, order: UnitOrder): Promise<void> {
    if (!order.patrolStart || !order.patrolEnd) {
      logger.warn(`Invalid patrol order for unit ${unit.id}: missing patrol points`);
      this.removeCurrentOrder(unit);
      return;
    }

    // Determine next target based on current position
    const { patrolStart, patrolEnd } = order;
    const isAtStart = unit.x === patrolStart.x && unit.y === patrolStart.y;
    const isAtEnd = unit.x === patrolEnd.x && unit.y === patrolEnd.y;

    let targetX: number, targetY: number;

    if (isAtStart) {
      targetX = patrolEnd.x;
      targetY = patrolEnd.y;
    } else if (isAtEnd) {
      targetX = patrolStart.x;
      targetY = patrolStart.y;
    } else {
      // Moving toward start point if not at either end
      targetX = patrolStart.x;
      targetY = patrolStart.y;
    }

    // Execute movement toward target
    const result = await this.executeAuthoritativeGoto(unit, targetX, targetY);

    if (result.success) {
      unit.orders = [order];
      await this.persistUnitOrders(unit);
      logger.info(`Unit ${unit.id} patrolling toward (${targetX}, ${targetY})`);
    } else {
      logger.warn(`Patrol failed for unit ${unit.id}: ${result.message}`);
      this.removeCurrentOrder(unit);
    }
  }

  private async executePatrol(
    unit: Unit,
    targetX?: number,
    targetY?: number
  ): Promise<ActionResult> {
    if (!this.canUnitPerformAction(unit.id, ActionType.PATROL, targetX, targetY)) {
      return { success: false, message: 'Unit cannot patrol to the target tile' };
    }

    const order: UnitOrder = {
      type: 'patrol',
      patrolStart: { x: unit.x, y: unit.y },
      patrolEnd: { x: targetX!, y: targetY! },
    };
    const result = await this.executeAuthoritativeGoto(unit, targetX, targetY);
    if (!result.success || !this.units.has(unit.id)) return result;

    unit.orders = [order];
    await this.persistUnitOrders(unit);
    return {
      ...result,
      message: `Unit is patrolling between (${order.patrolStart!.x}, ${order.patrolStart!.y}) and (${targetX}, ${targetY})`,
      newOrders: unit.orders,
    };
  }

  private async persistUnitOrders(unit: Unit): Promise<void> {
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ orders: unit.orders ?? [], currentOrder: unit.orders?.[0]?.type ?? null })
      .where(eq(units.id, unit.id));
  }

  /**
   * Process activity order (road, mine, irrigate, etc.)
   */
  private async processActivityOrder(unit: Unit, order: UnitOrder): Promise<void> {
    // Initialize activity if not already started
    if (!order.activity || order.activity.type === 'idle') {
      const activityType = this.getActivityTypeFromOrder(order.type);
      const turnsRequired = this.getActivityDuration(order, unit);

      order.activity = {
        type: activityType,
        turnsRemaining: turnsRequired,
        totalTurns: turnsRequired,
        target: { x: unit.x, y: unit.y },
      };

      logger.info(`Unit ${unit.id} started ${activityType} activity (${turnsRequired} turns)`);
    }
    unit.activity = order.activity;

    // Process turn of activity
    order.activity.turnsRemaining--;
    await this.maybePromoteAfterWork(unit);

    if (order.activity.turnsRemaining <= 0) {
      // Activity completed
      await this.completeActivity(unit, order);
      unit.activity = { type: 'idle', turnsRemaining: 0, totalTurns: 0 };
      this.removeCurrentOrder(unit);
      logger.info(`Unit ${unit.id} completed ${unit.activity.type} activity`);
    }

    // Activities consume all movement
    unit.movementLeft = 0;
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
        movementPoints: '0',
        orders: unit.orders ?? [],
        currentOrder: unit.orders?.[0]?.type ?? null,
      })
      .where(eq(units.id, unit.id));
  }

  /**
   * Process fortify order
   */
  private async processFortifyOrder(unit: Unit, _order: UnitOrder): Promise<void> {
    const result = await this.actionSystem.executeAction(unit, ActionType.FORTIFY);
    if (result.success) {
      await this.applyActionResult(unit, ActionType.FORTIFY, result);
      this.removeCurrentOrder(unit);
      logger.info(`Unit ${unit.id} fortified`);
    } else {
      logger.warn(`Failed to fortify unit ${unit.id}: ${result.message}`);
      this.removeCurrentOrder(unit);
    }
  }

  /**
   * Process sentry order
   */
  private async processSentryOrder(unit: Unit, _order: UnitOrder): Promise<void> {
    unit.sentryUntil = 'enemy_sighted'; // Default sentry behavior
    unit.movementLeft = 0; // Sentry consumes all movement
    this.removeCurrentOrder(unit);
    logger.info(`Unit ${unit.id} on sentry duty`);
  }

  /**
   * Keep a reload-safe auto-explore order while selecting targets from the
   * authoritative player knowledge map.
   * @reference reference/freeciv/server/unittools.c:3101-3120 do_explore()
   */
  private async processAutoExploreOrder(unit: Unit): Promise<void> {
    const moved = await this.moveAutomatedUnitTowardUnexplored(unit);
    if (!moved) {
      await this.clearAutomation(unit);
      return;
    }
    await this.persistAutomationOrder(unit);
  }

  private async processAutoSettlerOrder(unit: Unit): Promise<void> {
    // Infrastructure selection runs in the shared end-of-turn worker service.
    // Keep the compatibility marker stable during the normal activity phase.
    await this.persistAutomationOrder(unit);
  }

  private async moveAutomatedUnitTowardUnexplored(unit: Unit): Promise<boolean> {
    const targets = this.getUnexploredTargets(unit);
    for (const target of targets.slice(0, 32)) {
      if (await this.tryMoveAutomatedUnit(unit, target.x, target.y)) return true;
    }
    return false;
  }

  private getUnexploredTargets(unit: Unit): Array<{ x: number; y: number; distance: number }> {
    const explored =
      this.gameManagerCallback?.getExploredTiles?.(unit.playerId) ?? new Set<string>();
    const targets: Array<{ x: number; y: number; distance: number }> = [];
    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        if (!explored.has(`${x},${y}`)) {
          targets.push({ x, y, distance: this.calculateDistance(unit.x, unit.y, x, y) });
        }
      }
    }
    targets.sort(
      (left, right) => left.distance - right.distance || left.y - right.y || left.x - right.x
    );
    return targets;
  }

  private async tryMoveAutomatedUnit(
    unit: Unit,
    targetX: number,
    targetY: number
  ): Promise<boolean> {
    const pathResult = await this.gameManagerCallback?.requestPath(
      unit.playerId,
      unit.id,
      targetX,
      targetY
    );
    const path = pathResult?.path?.tiles;
    if (!pathResult?.success || !Array.isArray(path) || path.length < 2) return false;

    const moved = await this.moveAutomatedUnitAlongPath(unit, path.slice(1));
    if (!moved) return false;
    unit.autoExploreTarget = { x: targetX, y: targetY };
    this.gameManagerCallback?.broadcastUnitMoved(
      this.gameId,
      unit.id,
      unit.x,
      unit.y,
      unit.movementLeft
    );
    return true;
  }

  private async moveAutomatedUnitAlongPath(
    unit: Unit,
    path: Array<{ x: number; y: number }>
  ): Promise<boolean> {
    let moved = false;
    for (const step of path) {
      if (unit.movementLeft <= 0) break;
      try {
        await this.moveUnit(unit.id, step.x, step.y);
        moved = true;
      } catch {
        break;
      }
    }
    return moved;
  }

  private async persistAutomationOrder(unit: Unit): Promise<void> {
    const orderType = unit.automation === 'worker' ? 'autoSettler' : 'autoExplore';
    unit.orders = [{ type: orderType }];
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
        isAutomated: true,
        automationMode: unit.automation ?? null,
        automationTask: unit.automationTask ?? null,
        orders: unit.orders,
        currentOrder: orderType,
      })
      .where(eq(units.id, unit.id));
  }

  /**
   * Remove the current order from unit's queue
   */
  private removeCurrentOrder(unit: Unit): void {
    if (unit.orders && unit.orders.length > 0) {
      unit.orders.shift();
    }
  }

  /**
   * Get activity type from order type
   */
  private getActivityTypeFromOrder(orderType: string): UnitActivity['type'] {
    const activityMap: Record<string, UnitActivity['type']> = {
      road: 'building_road',
      railroad: 'building_railroad',
      irrigate: 'irrigating',
      mine: 'mining',
      cultivate: 'cultivating',
      plant: 'planting',
      fortress: 'building_fortress',
      airbase: 'building_airbase',
      transform: 'transforming',
      pillage: 'pillaging',
      cleanPollution: 'cleaning_pollution',
    };
    return activityMap[orderType] || 'idle';
  }

  /**
   * Get activity duration in turns
   * @reference freeciv ruleset activity times
   */
  private getActivityDuration(
    order: Pick<UnitOrder, 'type' | 'improvementType'>,
    unit: Unit
  ): number {
    const tile = this.mapManager?.getTile(unit.x, unit.y);
    const terrain = tile
      ? rulesetLoader.getTerrain(tile.terrain, this.getRulesetName())
      : undefined;
    const baseTurns = this.getBaseActivityDuration(order, tile, terrain);
    const adjustedTurns = unit.unitTypeId === 'engineers' ? Math.ceil(baseTurns / 2) : baseTurns;
    return Math.max(1, adjustedTurns);
  }

  private getBaseActivityDuration(
    order: Pick<UnitOrder, 'type' | 'improvementType'>,
    tile: { terrain: string; improvements?: string[] } | undefined,
    terrain: ReturnType<typeof rulesetLoader.getTerrain> | undefined
  ): number {
    const orderType = order.type;
    const extraBuildDuration = (fallbackExtra: string, fallbackDuration: number): number => {
      const extra = rulesetLoader.getExtra(
        order.improvementType ?? fallbackExtra,
        this.getRulesetName()
      );
      const configuredDuration = Number(extra.build_time ?? 0);
      if (configuredDuration > 0) return configuredDuration;
      return Math.max(1, fallbackDuration * Number(extra.build_time_factor ?? 1));
    };
    const baseTimes: Record<string, () => number> = {
      road: () => extraBuildDuration('Road', terrain?.roadTime ?? 0),
      railroad: () => extraBuildDuration('Railroad', terrain?.roadTime ?? 0),
      irrigate: () => extraBuildDuration('Irrigation', terrain?.irrigationTime ?? 0),
      mine: () => extraBuildDuration('Mine', terrain?.miningTime ?? 0),
      cultivate: () => terrain?.cultivateTime ?? 0,
      plant: () => terrain?.plantTime ?? 0,
      fortress: () => extraBuildDuration('Fortress', Number((terrain as any)?.base_time ?? 0)),
      airbase: () => extraBuildDuration('Airbase', Number((terrain as any)?.base_time ?? 0)),
      transform: () => terrain?.transformTime ?? 0,
      pillage: () => 1,
      cleanPollution: () => this.getCleanupDuration(tile),
    };
    return baseTimes[orderType]?.() || 1;
  }

  private getCleanupDuration(
    tile: { terrain: string; improvements?: string[] } | undefined
  ): number {
    const extra = this.getCleanupExtraName(tile);
    return (
      rulesetLoader.getTerrainExtraRemovalTime(tile?.terrain ?? '', extra, this.getRulesetName()) ??
      rulesetLoader.getExtra(extra, this.getRulesetName()).removal_time ??
      0
    );
  }

  /**
   * Complete an activity and apply its effects
   */
  private async completeActivity(unit: Unit, order: UnitOrder): Promise<void> {
    const tile = this.mapManager?.getTile(unit.x, unit.y);
    if (!tile) {
      throw new Error(`No map tile at (${unit.x}, ${unit.y})`);
    }

    const previousExtras = new Set<string>(tile.improvements as string[]);
    const extras = new Set<string>(previousExtras);
    this.applyActivityTileChange(unit, order, tile, extras);
    this.mapManager.updateTileProperty(unit.x, unit.y, 'improvements', [...extras]);
    const added = [...extras].filter(extra => !previousExtras.has(extra));
    const removed = [...previousExtras].filter(extra => !extras.has(extra));
    if (added.length > 0 || removed.length > 0) {
      this.tileExtrasChangedCallback?.({
        x: unit.x,
        y: unit.y,
        playerId: unit.playerId,
        added,
        removed,
      });
    }
    const mapData = this.mapManager.getMapData?.();
    if (mapData) {
      // Worker extras are part of the authoritative map and must survive a
      // server restart just like terrain and ownership.
      // @reference reference/freeciv/server/savegame/savegame3.c:2490-2600
      await this.databaseProvider
        .getDatabase()
        .update(games)
        .set({ mapData })
        .where(eq(games.id, this.gameId));
      this.gameManagerCallback?.broadcastMapChanged?.(this.gameId, mapData);
    }
    logger.info(`Activity ${order.type} completed by unit ${unit.id} at (${unit.x}, ${unit.y})`);
  }

  private applyActivityTileChange(
    unit: Unit,
    order: UnitOrder,
    tile: { terrain: string; improvements: string[]; hasRoad?: boolean; hasRailroad?: boolean },
    extras: Set<string>
  ): void {
    const orderType = order.type;
    const handlers: Partial<Record<UnitOrder['type'], () => void>> = {
      road: () => {
        extras.add('road');
        this.mapManager!.updateTileProperty(unit.x, unit.y, 'hasRoad', true);
      },
      railroad: () => {
        extras.add('railroad');
        this.mapManager!.updateTileProperty(unit.x, unit.y, 'hasRailroad', true);
      },
      irrigate: () => {
        extras.delete('mine');
        extras.add('irrigation');
      },
      mine: () => {
        extras.delete('irrigation');
        extras.add(order.improvementType ?? 'mine');
      },
      cultivate: () => this.applyTerrainActivity(unit, tile, extras, 'cultivateTo'),
      plant: () => this.applyTerrainActivity(unit, tile, extras, 'plantTo'),
      fortress: () => extras.add(order.improvementType ?? 'fortress'),
      airbase: () => extras.add(order.improvementType ?? 'airbase'),
      transform: () => this.applyTerrainActivity(unit, tile, extras, 'transformTo'),
      pillage: () => this.applyPillage(unit, tile, extras),
      cleanPollution: () => extras.delete(extras.has('pollution') ? 'pollution' : 'fallout'),
    };
    handlers[orderType]?.();
  }

  private applyTerrainActivity(
    unit: Unit,
    tile: { terrain: string },
    extras: Set<string>,
    target: 'cultivateTo' | 'plantTo' | 'transformTo'
  ): void {
    const terrain = rulesetLoader.getTerrain(tile.terrain, this.getRulesetName());
    const targetTerrain = terrain[target];
    if (!targetTerrain) return;
    this.mapManager!.updateTileProperty(unit.x, unit.y, 'terrain', targetTerrain as TerrainType);
    extras.delete('irrigation');
    extras.delete('mine');
  }

  private applyPillage(
    unit: Unit,
    tile: { improvements: string[]; hasRoad?: boolean; hasRailroad?: boolean },
    extras: Set<string>
  ): void {
    const target = tile.hasRailroad ? 'railroad' : tile.hasRoad ? 'road' : tile.improvements[0];
    if (target === 'railroad')
      this.mapManager!.updateTileProperty(unit.x, unit.y, 'hasRailroad', false);
    if (target === 'road') this.mapManager!.updateTileProperty(unit.x, unit.y, 'hasRoad', false);
    if (target) extras.delete(target);
  }

  /**
   * Add order to unit's queue
   */
  addOrderToUnit(unitId: string, order: UnitOrder): boolean {
    const unit = this.units.get(unitId);
    if (!unit) {
      return false;
    }

    if (!unit.orders) {
      unit.orders = [];
    }

    unit.orders.push(order);
    logger.info(`Added ${order.type} order to unit ${unitId}`);
    return true;
  }

  /**
   * Clear all orders for a unit
   */
  clearUnitOrders(unitId: string): boolean {
    const unit = this.units.get(unitId);
    if (!unit) {
      return false;
    }

    unit.orders = [];
    unit.activity = { type: 'idle', turnsRemaining: 0, totalTurns: 0 };
    logger.info(`Cleared all orders for unit ${unitId}`);
    return true;
  }

  /**
   * Get unit's current activity progress
   */
  getUnitActivityProgress(
    unitId: string
  ): { activity: string; progress: number; turnsLeft: number } | null {
    const unit = this.units.get(unitId);
    if (!unit || !unit.activity || unit.activity.type === 'idle') {
      return null;
    }

    const progress =
      ((unit.activity.totalTurns - unit.activity.turnsRemaining) / unit.activity.totalTurns) * 100;

    return {
      activity: unit.activity.type,
      progress: Math.round(progress),
      turnsLeft: unit.activity.turnsRemaining,
    };
  }

  /**
   * Get visible units for a player (considering fog of war)
   */
  getVisibleUnits(
    playerId: string,
    visibleTiles: Set<string>,
    detectionTiles?: { invisible: Set<string>; subsurface: Set<string> }
  ): Unit[] {
    return Array.from(this.units.values()).filter(unit => {
      // Player always sees their own units
      if (unit.playerId === playerId) return true;

      // Check if unit is in visible tiles
      const tileKey = `${unit.x},${unit.y}`;
      const layer = this.unitTypes[unit.unitTypeId]?.visionLayer ?? 'Main';
      if (layer === 'Stealth') return detectionTiles?.invisible.has(tileKey) ?? false;
      if (layer === 'Subsurface') return detectionTiles?.subsurface.has(tileKey) ?? false;
      return visibleTiles.has(tileKey);
    });
  }

  /**
   * Get transport capacity remaining for a unit
   * @reference freeciv-web/javascript/unit.js unit_cargo_room()
   */
  getTransportCapacityRemaining(transportId: string): number {
    const transport = this.units.get(transportId);
    if (!transport) {
      return 0;
    }

    const transportType = this.unitTypes[transport.unitTypeId];
    if (!transportType || !transportType.transport_capacity) {
      return 0;
    }

    const currentCargo = transport.cargoUnits ? transport.cargoUnits.length : 0;
    return Math.max(0, transportType.transport_capacity - currentCargo);
  }

  /**
   * Check if unit has cargo
   * @reference freeciv-web/javascript/unit.js unit_has_cargo()
   */
  unitHasCargo(unitId: string): boolean {
    const unit = this.units.get(unitId);
    return !!(unit?.cargoUnits && unit.cargoUnits.length > 0);
  }

  /**
   * Check if a unit can deboard (unload) from its transport
   * @reference freeciv-web/javascript/unit.js unit_can_deboard()
   */
  canUnloadUnit(unitId: string, targetX?: number, targetY?: number): boolean {
    const unit = this.units.get(unitId);
    if (!unit?.transportedBy) return false;
    const transport = this.units.get(unit.transportedBy);
    if (!transport) return false;
    const x = targetX ?? transport.x;
    const y = targetY ?? transport.y;
    return this.canUnloadAt(unit, transport, x, y);
  }

  /**
   * Check Freeciv's Transport Unload form, where the transport is the actor
   * and a passenger on its current tile is the target.
   *
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1314-1324
   * @reference reference/freeciv/server/unithand.c:895-909
   */
  canTransportUnloadCargo(transportId: string, cargoId: string): boolean {
    const transport = this.units.get(transportId);
    const cargo = this.units.get(cargoId);
    return Boolean(
      transport &&
      cargo?.transportedBy === transport.id &&
      this.canUnloadAt(cargo, transport, transport.x, transport.y)
    );
  }

  private canUnloadAt(unit: Unit, transport: Unit, x: number, y: number): boolean {
    if (!this.isValidPosition(x, y)) return false;
    const distance = this.calculateDistance(transport.x, transport.y, x, y);
    if (distance > 1) return false;
    if (!this.canUnitEnterTerrain(this.getTerrainAt(x, y), unit.unitTypeId)) return false;
    if (
      this.getUnitsAt(x, y).some(
        candidate => !this.playersCanShareTransport(unit.playerId, candidate.playerId)
      )
    ) {
      return false;
    }
    const city = this.gameManagerCallback?.getCityAt?.(x, y);
    if (city && !this.playersCanShareTransport(unit.playerId, city.playerId)) return false;
    if (distance === 0) {
      return this.canFreelyUnloadFrom(unit, transport) || this.isTransportDocked(transport);
    }
    return unit.movementLeft > 0;
  }

  /**
   * Check if unit can load another unit
   */
  canLoadUnit(transportId: string, cargoId: string): boolean {
    const transport = this.units.get(transportId);
    const cargo = this.units.get(cargoId);
    return Boolean(transport && cargo && this.canCargoUseTransport(cargo, transport, true));
  }

  /**
   * Check if transport and cargo combination is valid
   * @reference freeciv-web/javascript/unit.js unit_could_possibly_load()
   */
  private isValidTransportCombination(transportType: string, cargoType: string): boolean {
    const transport = this.unitTypes[transportType];
    const cargo = this.unitTypes[cargoType];
    return Boolean(
      transport &&
      cargo &&
      (transport.transport_capacity ?? 0) > 0 &&
      transport.cargoClasses.includes(cargo.rulesetUnitClass ?? '')
    );
  }

  /**
   * Freeciv permits allied cargo to use a compatible transport. Board can
   * also transfer a passenger directly between two transports on one tile.
   * @reference reference/freeciv/common/unit.c:743-789
   * @reference reference/freeciv/server/unithand.c:856-875
   */
  private canCargoUseTransport(cargo: Unit, transport: Unit, requireSameTile: boolean): boolean {
    if (!this.isEligibleTransportAssignment(cargo, transport, requireSameTile)) return false;
    return this.canFreelyLoadInto(cargo, transport) || this.isTransportDocked(transport);
  }

  private isEligibleTransportAssignment(
    cargo: Unit,
    transport: Unit,
    requireSameTile: boolean
  ): boolean {
    if (cargo.id === transport.id || cargo.transportedBy === transport.id) return false;
    if (!this.playersCanShareTransport(cargo.playerId, transport.playerId)) return false;
    if (requireSameTile && (cargo.x !== transport.x || cargo.y !== transport.y)) return false;
    if (!requireSameTile && !this.canEnterTransportTile(cargo, transport)) return false;
    if (this.getTransportCapacityRemaining(transport.id) <= 0) return false;
    return this.isValidTransportCombination(transport.unitTypeId, cargo.unitTypeId);
  }

  /**
   * Freeciv's Transport Embark action rejects a target tile that contains an
   * unallied unit or city. The regular destination validator only receives
   * one unit, while a transport tile can be a stack, so check the complete
   * authoritative tile before selecting an embark target.
   *
   * @reference reference/freeciv/doc/README.actions:668-700
   */
  private canEnterTransportTile(cargo: Unit, transport: Unit): boolean {
    if (
      this.getUnitsAt(transport.x, transport.y).some(
        candidate => !this.playersCanShareTransport(cargo.playerId, candidate.playerId)
      )
    ) {
      return false;
    }
    const city = this.gameManagerCallback?.getCityAt?.(transport.x, transport.y);
    return !city || this.playersCanShareTransport(cargo.playerId, city.playerId);
  }

  private playersCanShareTransport(firstPlayerId: string, secondPlayerId: string): boolean {
    return (
      firstPlayerId === secondPlayerId ||
      this.alliedPlayersProvider?.(firstPlayerId).has(secondPlayerId) === true
    );
  }

  private canFreelyLoadInto(cargo: Unit, transport: Unit): boolean {
    const cargoType = this.unitTypes[cargo.unitTypeId];
    const transportClass = this.unitTypes[transport.unitTypeId]?.rulesetUnitClass;
    return Boolean(transportClass && cargoType?.embarks?.includes(transportClass));
  }

  private canFreelyUnloadFrom(cargo: Unit, transport: Unit): boolean {
    const cargoType = this.unitTypes[cargo.unitTypeId];
    const transportClass = this.unitTypes[transport.unitTypeId]?.rulesetUnitClass;
    return Boolean(transportClass && cargoType?.disembarks?.includes(transportClass));
  }

  private isTransportDocked(transport: Unit): boolean {
    if (this.gameManagerCallback?.getCityAt?.(transport.x, transport.y)) return true;
    const tile = this.mapManager?.getTile?.(transport.x, transport.y);
    const extras = tile?.improvements ?? [];
    const transportClass = this.unitTypes[transport.unitTypeId]?.rulesetUnitClass;
    if (!transportClass) return false;
    return extras.some((extraId: string) => this.isNativeTransportBase(extraId, transportClass));
  }

  private isNativeTransportBase(extraId: string, transportClass: string): boolean {
    try {
      const extra = rulesetLoader.getExtra(extraId, this.getRulesetName()) as {
        causes?: string | string[];
        native_to?: string[];
      };
      const causes = Array.isArray(extra.causes) ? extra.causes : [extra.causes];
      return causes.includes('Base') && extra.native_to?.includes(transportClass) === true;
    } catch {
      return false;
    }
  }

  private findAvailableTransportAt(cargo: Unit, x: number, y: number): Unit | undefined {
    return this.getUnitsAt(x, y).find(transport =>
      this.canCargoUseTransport(cargo, transport, false)
    );
  }

  /**
   * Load a unit onto a transport
   */
  async loadUnitOntoTransport(transportId: string, cargoId: string): Promise<boolean> {
    if (!this.canLoadUnit(transportId, cargoId)) {
      return false;
    }

    const transport = this.units.get(transportId)!;
    const cargo = this.units.get(cargoId)!;

    const previousTransport = cargo.transportedBy ? this.units.get(cargo.transportedBy) : undefined;
    if (previousTransport) await this.detachCargoFromTransport(cargo, previousTransport);

    // Update cargo unit. Freeciv's Transport Board action unloads cargo from
    // its former transport before boarding the selected compatible transport.
    // @reference reference/freeciv/server/unithand.c:856-875
    cargo.transportedBy = transportId;
    cargo.x = transport.x;
    cargo.y = transport.y;
    cargo.automationTask = undefined;
    // Boarding is a state change, not movement.  Freeciv keeps the cargo's
    // movement points, which matters for rulesets with tired_attack enabled
    // when a unit (notably Marines) attacks from a transport.

    // Update transport unit
    if (!transport.cargoUnits) {
      transport.cargoUnits = [];
    }
    if (!transport.cargoUnits.includes(cargoId)) transport.cargoUnits.push(cargoId);

    // Update database
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
        transportedBy: transportId,
        x: cargo.x,
        y: cargo.y,
        movementPoints: String(cargo.movementLeft),
        automationTask: null,
      })
      .where(eq(units.id, cargoId));
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ cargoUnits: transport.cargoUnits })
      .where(eq(units.id, transportId));

    logger.info(`Unit ${cargoId} loaded onto transport ${transportId}`, {
      transportType: transport.unitTypeId,
      cargoType: cargo.unitTypeId,
      location: { x: transport.x, y: transport.y },
    });

    return true;
  }

  /**
   * Unload cargo onto its transport tile or an adjacent native tile.
   * @reference reference/freeciv/server/unithand.c unit_unload()
   */
  async unloadUnit(unitId: string, targetX?: number, targetY?: number): Promise<boolean> {
    const cargo = this.units.get(unitId);
    if (!cargo?.transportedBy) return false;
    const transport = this.units.get(cargo.transportedBy);
    if (!transport) return false;

    const x = targetX ?? transport.x;
    const y = targetY ?? transport.y;
    if (!this.canUnloadUnit(unitId, x, y)) return false;

    return this.unloadCargoAt(cargo, transport, x, y);
  }

  /**
   * Perform Freeciv's Transport Unload form, where the selected transport
   * releases one of its passengers without moving it to another tile.
   *
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1314-1324
   * @reference reference/freeciv/server/unithand.c:895-909
   */
  async unloadCargoFromTransport(transportId: string, cargoId: string): Promise<boolean> {
    const transport = this.units.get(transportId);
    const cargo = this.units.get(cargoId);
    if (!transport || !cargo || !this.canTransportUnloadCargo(transportId, cargoId)) return false;

    return this.unloadCargoAt(cargo, transport, transport.x, transport.y);
  }

  private async unloadCargoAt(
    cargo: Unit,
    transport: Unit,
    x: number,
    y: number
  ): Promise<boolean> {
    const remainingMovement = this.getUnloadMovement(cargo, transport, x, y);
    transport.cargoUnits = (transport.cargoUnits ?? []).filter(id => id !== cargo.id);
    cargo.transportedBy = undefined;
    cargo.x = x;
    cargo.y = y;
    cargo.movementLeft = remainingMovement;

    await this.persistUnload(cargo.id, transport, x, y, remainingMovement);
    return true;
  }

  private getUnloadMovement(cargo: Unit, transport: Unit, x: number, y: number): number {
    if (x === transport.x && y === transport.y) return cargo.movementLeft;
    const movementCost = this.calculateTerrainMovementCost(cargo, transport.x, transport.y, x, y);
    const cargoType = this.unitTypes[cargo.unitTypeId];
    const action = cargoType ? this.getDisembarkAction(cargoType, transport) : undefined;
    const actionCost =
      cargoType && action
        ? this.getActionSuccessMovementCost(cargo, cargoType, action, {
            // Freeciv charges Action_Success_Actor_Move_Cost after unit_move()
            // reaches the target tile. Its AI temporarily assigns the target
            // tile before evaluating this exact UnitState requirement.
            // @reference reference/freeciv/server/unithand.c:918-941
            // @reference reference/freeciv/common/unit.c:2199-2217
            unitIsOnNativeTile: this.isUnitOnNativeTile(cargoType, x, y),
          })
        : 0;
    return Math.max(0, cargo.movementLeft - Math.max(0, movementCost) - actionCost);
  }

  /**
   * Civ2Civ3 splits ordinary disembarkation into native/city-source and
   * non-native-source actions. The latter can carry a distinct post-action
   * movement cost, so preserve the source action identity until pricing.
   *
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1327-1364
   */
  private getDisembarkAction(cargoType: UnitType, transport: Unit): string {
    const sourceIsCity = Boolean(this.gameManagerCallback?.getCityAt?.(transport.x, transport.y));
    return this.isUnitOnNativeTile(cargoType, transport.x, transport.y) || sourceIsCity
      ? 'Transport Disembark'
      : 'Transport Disembark 2';
  }

  /**
   * Match Freeciv's is_native_tile(): native terrain or any native extra.
   *
   * @reference reference/freeciv/common/movement.c:358-367
   * @reference reference/freeciv/common/extras.c:855-869
   */
  private isUnitOnNativeTile(unitType: UnitType, x: number, y: number): boolean {
    if (this.canUnitEnterTerrain(this.getTerrainAt(x, y), unitType.id)) return true;
    const tile = this.mapManager?.getTile?.(x, y);
    const unitClass = unitType.rulesetUnitClass;
    if (!unitClass) return false;
    const extras = Array.isArray(tile?.improvements) ? (tile.improvements as string[]) : [];
    return extras.some(extraId => this.isExtraNativeToUnitClass(extraId, unitClass));
  }

  private isExtraNativeToUnitClass(extraId: string, unitClass: string): boolean {
    try {
      const extra = rulesetLoader.getExtra(extraId, this.getRulesetName()) as {
        native_to?: string[];
      };
      return extra.native_to?.includes(unitClass) === true;
    } catch {
      return false;
    }
  }

  private async persistUnload(
    unitId: string,
    transport: Unit,
    x: number,
    y: number,
    movement: number
  ): Promise<void> {
    await Promise.all([
      this.databaseProvider
        .getDatabase()
        .update(units)
        .set({ transportedBy: null, x, y, movementPoints: String(movement) })
        .where(eq(units.id, unitId)),
      this.databaseProvider
        .getDatabase()
        .update(units)
        .set({ cargoUnits: transport.cargoUnits })
        .where(eq(units.id, transport.id)),
    ]);
  }

  private getCleanupExtraName(
    tile: { improvements?: string[] } | undefined
  ): 'Pollution' | 'Fallout' {
    return tile?.improvements?.some(extra => extra.toLowerCase() === 'pollution')
      ? 'Pollution'
      : 'Fallout';
  }
}
