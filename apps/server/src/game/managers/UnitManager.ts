import { DatabaseProvider } from '@database';
import { units } from '@database/schema/units';
import { games } from '@database/schema/games';
import { players } from '@database/schema/players';
import { eq } from 'drizzle-orm';
import { logger } from '@utils/logger';
import { getTerrainMovementCost, SINGLE_MOVE } from '@game/constants/MovementConstants';
import { UNIT_TYPES, getUnitType, UnitType } from '@game/constants/UnitConstants';
import { ActionSystem } from '@game/systems/ActionSystem';
import { ActionType, ActionResult } from '@app-types/shared/actions';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { TerrainType } from '@game/map/MapTypes';

interface CityAtLocation {
  id: string;
  playerId: string;
  buildings?: string[];
}

export interface Unit {
  id: string;
  gameId: string;
  playerId: string;
  unitTypeId: string;
  x: number;
  y: number;
  movementLeft: number;
  health: number;
  veteranLevel: number;
  experience: number;
  fortified: boolean;
  orders?: UnitOrder[];
  activity?: UnitActivity;
  sentryUntil?: 'turn_start' | 'enemy_sighted' | 'manual';
  autoExploreTarget?: { x: number; y: number };
  automation?: 'explore' | 'settler';
  transportedBy?: string; // ID of unit transporting this unit
  cargoUnits?: string[]; // IDs of units being transported by this unit
  homeCityId?: string;
}

export interface VeteranLevel {
  name: string;
  powerFactor: number; // Multiplier for attack/defense strength
  moveBonus: number; // Additional movement points
  experienceRequired: number; // Experience points needed to reach this level
}

export interface UnitOrder {
  type:
    | 'move'
    | 'attack'
    | 'fortify'
    | 'foundCity'
    | 'buildImprovement'
    | 'pillage'
    | 'patrol'
    | 'irrigate'
    | 'mine'
    | 'road'
    | 'railroad'
    | 'transform'
    | 'cleanPollution'
    | 'sentry'
    | 'wait'
    | 'disband'
    | 'autoExplore'
    | 'autoSettler';
  targetX?: number;
  targetY?: number;
  targetId?: string;
  improvementType?: string;
  activity?: UnitActivity;
  patrolStart?: { x: number; y: number };
  patrolEnd?: { x: number; y: number };
  activityTurnsLeft?: number;
  priority?: number;
}

export interface UnitActivity {
  type:
    | 'idle'
    | 'building_road'
    | 'building_railroad'
    | 'irrigating'
    | 'mining'
    | 'pillaging'
    | 'transforming'
    | 'cleaning_pollution'
    | 'fortifying'
    | 'patrolling';
  turnsRemaining: number;
  totalTurns: number;
  target?: { x: number; y: number };
}

export interface CombatResult {
  attackerId: string;
  defenderId: string;
  attackerDamage: number;
  defenderDamage: number;
  attackerDestroyed: boolean;
  defenderDestroyed: boolean;
  collateralDestroyedIds?: string[];
  experienceGained?: {
    attacker: number;
    defender: number;
  };
}

export class UnitManager {
  private units: Map<string, Unit> = new Map();
  private gameId: string;
  private databaseProvider: DatabaseProvider;
  private mapWidth: number;
  private mapHeight: number;
  private mapManager: any; // MapManager instance for terrain access
  private actionSystem: ActionSystem;
  private effectsManager?: EffectsManager;
  private currentTurnProvider?: () => number;
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
    broadcastUnitMoved: (
      gameId: string,
      unitId: string,
      x: number,
      y: number,
      movementLeft: number
    ) => void;
    getCityAt?: (x: number, y: number) => CityAtLocation | null;
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
    broadcastMapChanged?: (gameId: string, mapData: unknown) => void;
  };

  constructor(
    gameId: string,
    databaseProvider: DatabaseProvider,
    mapWidth: number,
    mapHeight: number,
    mapManager?: any,
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
      broadcastUnitMoved: (
        gameId: string,
        unitId: string,
        x: number,
        y: number,
        movementLeft: number
      ) => void;
      getCityAt?: (x: number, y: number) => CityAtLocation | null;
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
      broadcastMapChanged?: (gameId: string, mapData: unknown) => void;
    },
    effectsManager?: EffectsManager,
    private readonly random: () => number = Math.random
  ) {
    this.gameId = gameId;
    this.databaseProvider = databaseProvider;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.mapManager = mapManager;
    this.gameManagerCallback = gameManagerCallback;
    this.effectsManager = effectsManager;
    this.actionSystem = new ActionSystem(gameId, gameManagerCallback, mapManager);
  }

  public setCurrentTurnProvider(provider: () => number): void {
    this.currentTurnProvider = provider;
  }

  public setExploredTilesProvider(provider: (playerId: string) => Set<string>): void {
    if (this.gameManagerCallback) {
      this.gameManagerCallback.getExploredTiles = provider;
    }
  }

  /**
   * Create a new unit
   */
  async createUnit(
    playerId: string,
    unitTypeId: string,
    x: number,
    y: number,
    homeCityId?: string
  ): Promise<Unit> {
    const unitType = UNIT_TYPES[unitTypeId];
    if (!unitType) {
      throw new Error(`Unknown unit type: ${unitTypeId}`);
    }

    // Validate position
    if (!this.isValidPosition(x, y)) {
      throw new Error(`Invalid position: ${x}, ${y}`);
    }

    const city = this.gameManagerCallback?.getCityAt?.(x, y);
    const veteranLevel =
      city && city.playerId === playerId && this.effectsManager
        ? this.effectsManager.calculateEffect(EffectType.VETERAN_BUILD, {
            playerId,
            unitType: unitTypeId,
            unitClass: unitType.rulesetUnitClass,
            unitTypeFlags: new Set(unitType.flags),
            cityBuildings: new Set(city.buildings ?? []),
          }).value
        : 0;

    // Save to database and get the generated ID
    const [dbUnit] = await this.databaseProvider
      .getDatabase()
      .insert(units)
      .values({
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
        movementPoints: (unitType.movement * 3).toString(),
        maxMovementPoints: (unitType.movement * 3).toString(),
        veteranLevel,
        homeCityId,
        isAutomated: false,
        // @reference reference/freeciv/server/unittools.c:1215-1280
        createdTurn: this.currentTurnProvider?.() ?? 1,
      })
      .returning();

    const unit: Unit = {
      id: dbUnit.id,
      gameId: this.gameId,
      playerId,
      unitTypeId,
      x,
      y,
      movementLeft: unitType.movement * 3, // Convert movement points to fragments
      health: 100,
      veteranLevel,
      experience: 0,
      fortified: false,
      homeCityId,
      automation: undefined,
    };

    this.units.set(unit.id, unit);
    logger.info(`Created unit ${unit.id} at (${x}, ${y})`);

    return unit;
  }

  /**
   * Move a unit to a new position
   */
  async moveUnit(unitId: string, newX: number, newY: number): Promise<boolean> {
    const unit = this.units.get(unitId);
    if (!unit) {
      throw new Error(`Unit not found: ${unitId}`);
    }

    this.validateMoveTarget(newX, newY);
    if (this.calculateDistance(unit.x, unit.y, newX, newY) !== 1) {
      throw new Error('Units may only move to an adjacent tile');
    }
    if (unit.transportedBy) {
      throw new Error('Transported unit must unload before moving');
    }
    const targetUnit = this.getUnitAt(newX, newY);
    const targetCity = this.gameManagerCallback?.getCityAt?.(newX, newY);
    if (targetCity && targetCity.playerId !== unit.playerId && !targetUnit) {
      const unitType = UNIT_TYPES[unit.unitTypeId];
      const canCapture =
        unitType?.rulesetUnitClassFlags.includes('CanOccupyCity') &&
        !unitType.flags?.includes('NonMil');
      const captured =
        canCapture && this.gameManagerCallback?.captureCity
          ? await this.gameManagerCallback.captureCity(targetCity.id, unit.playerId, unit.id)
          : false;
      if (!captured) {
        throw new Error('Cannot capture enemy city with this unit');
      }
    }
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
    const effectiveMovementCost = embarkTransport ? SINGLE_MOVE : movementCost;
    this.ensureSufficientMovement(unit);

    // Update unit state
    unit.x = newX;
    unit.y = newY;
    unit.movementLeft = Math.max(0, unit.movementLeft - effectiveMovementCost);
    unit.fortified = false; // Moving breaks fortification
    if (embarkTransport) {
      unit.transportedBy = embarkTransport.id;
      embarkTransport.cargoUnits ??= [];
      embarkTransport.cargoUnits.push(unit.id);
    }

    const cargo = (unit.cargoUnits ?? [])
      .map(cargoId => this.units.get(cargoId))
      .filter((cargoUnit): cargoUnit is Unit => Boolean(cargoUnit));
    for (const cargoUnit of cargo) {
      cargoUnit.x = newX;
      cargoUnit.y = newY;
    }

    await this.updateUnitPositionInDb(unitId, unit);
    if (embarkTransport) {
      await Promise.all([
        this.databaseProvider
          .getDatabase()
          .update(units)
          .set({ transportedBy: embarkTransport.id })
          .where(eq(units.id, unit.id)),
        this.databaseProvider
          .getDatabase()
          .update(units)
          .set({ cargoUnits: embarkTransport.cargoUnits })
          .where(eq(units.id, embarkTransport.id)),
      ]);
    }
    await Promise.all(cargo.map(cargoUnit => this.updateUnitPositionInDb(cargoUnit.id, cargoUnit)));

    logger.info(`Unit ${unitId} moved to (${newX}, ${newY})`);
    return true;
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
    if (targetUnit && targetUnit.playerId !== unit.playerId) {
      throw new Error('Cannot move to tile occupied by enemy unit');
    }

    if (this.gameManagerCallback?.getCityAt) {
      const targetCity = this.gameManagerCallback.getCityAt(newX, newY);
      if (targetCity && targetCity.playerId !== unit.playerId) {
        throw new Error('Cannot move to tile occupied by enemy city');
      }
    }
  }

  /**
   * Classic ground units may not move from one enemy-controlled tile directly
   * into another. Friendly stacks, cities, non-ZOC terrain, and IgZOC units
   * are exempt.
   * @reference reference/freeciv/common/movement.c:573-595
   * @reference reference/freeciv/common/unit.c:1443-1510
   */
  private canMoveWithZoneOfControl(unit: Unit, newX: number, newY: number): boolean {
    const type = UNIT_TYPES[unit.unitTypeId];
    const subjectToZoc =
      type?.rulesetUnitClassFlags.includes('ZOC') && !type.flags?.includes('IgZOC');
    if (!subjectToZoc) return true;

    if (this.getUnitsAt(newX, newY).some(candidate => candidate.playerId === unit.playerId)) {
      return true;
    }
    if (
      this.gameManagerCallback?.getCityAt?.(unit.x, unit.y) ||
      this.gameManagerCallback?.getCityAt?.(newX, newY)
    ) {
      return true;
    }

    const noZocTerrains = new Set(['ocean', 'deep_ocean', 'coast', 'lake']);
    if (
      noZocTerrains.has(this.getTerrainAt(unit.x, unit.y)) ||
      noZocTerrains.has(this.getTerrainAt(newX, newY))
    ) {
      return true;
    }

    return (
      !this.hasAdjacentEnemyZoc(unit.playerId, unit.x, unit.y) ||
      !this.hasAdjacentEnemyZoc(unit.playerId, newX, newY)
    );
  }

  private hasAdjacentEnemyZoc(playerId: string, x: number, y: number): boolean {
    return [...this.units.values()].some(candidate => {
      if (
        candidate.playerId === playerId ||
        candidate.transportedBy ||
        this.calculateDistance(x, y, candidate.x, candidate.y) > 1
      ) {
        return false;
      }
      const type = UNIT_TYPES[candidate.unitTypeId];
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
  async attackUnit(attackerId: string, defenderId: string): Promise<CombatResult> {
    const attacker = this.units.get(attackerId);
    const defender = this.units.get(defenderId);

    if (!attacker || !defender) {
      throw new Error('Unit not found');
    }
    if (attacker.playerId === defender.playerId) {
      throw new Error('Cannot attack a friendly unit');
    }
    if (attacker.transportedBy || defender.transportedBy) {
      throw new Error('Transported units cannot directly participate in combat');
    }

    const attackerType = UNIT_TYPES[attacker.unitTypeId];
    const defenderType = UNIT_TYPES[defender.unitTypeId];
    const defenderTileUnits = this.getUnitsAt(defender.x, defender.y).filter(
      unit => unit.playerId === defender.playerId && unit.id !== defender.id
    );
    if ((attackerType.attack ?? 0) <= 0) {
      throw new Error('Unit has no attack strength');
    }

    // Check if attacker has movement left
    if (attacker.movementLeft <= 0) {
      throw new Error('No movement points remaining');
    }

    // Check if units are in range
    const distance = this.calculateDistance(attacker.x, attacker.y, defender.x, defender.y);

    if (distance > attackerType.range) {
      throw new Error('Target out of range');
    }

    const attackerStrength = this.calculateAttackStrength(attacker, attackerType);
    const defenderStrength = this.calculateCombatStrength(defender, defenderType);
    const attackerStartingHealth = attacker.health;
    const defenderStartingHealth = defender.health;
    const damagePerAttackerWin = Math.max(
      1,
      Math.round(((attackerType.firepower ?? 1) * 100) / (defenderType.hitpoints ?? 10))
    );
    const damagePerDefenderWin = Math.max(
      1,
      Math.round(((defenderType.firepower ?? 1) * 100) / (attackerType.hitpoints ?? 10))
    );

    // Classic combat resolves one firepower exchange at a time until one unit
    // dies. A round is selected by attack power versus defense power; current
    // hit points determine how many rounds a unit can endure, not its power.
    // @reference reference/freeciv/server/unittools.c:292-351
    while (attacker.health > 0 && defender.health > 0) {
      if (this.random() * (attackerStrength + defenderStrength) >= defenderStrength) {
        defender.health -= damagePerAttackerWin;
      } else {
        attacker.health -= damagePerDefenderWin;
      }
    }

    attacker.health = Math.max(0, attacker.health);
    defender.health = Math.max(0, defender.health);
    const damageToAttacker = attackerStartingHealth - attacker.health;
    const damageToDefender = defenderStartingHealth - defender.health;
    attacker.movementLeft = 0; // Attack uses all remaining movement

    // Check for unit destruction
    const attackerDestroyed = attacker.health <= 0;
    const defenderDestroyed = defender.health <= 0;
    let resultCollateralDestroyedIds: string[] | undefined;

    // Award experience based on combat outcome
    let attackerExp = 0;
    let defenderExp = 0;

    if (attackerDestroyed) {
      // Defender won
      defenderExp = this.calculateCombatExperience(defender, attacker, true);
      if (defenderExp > 0) {
        await this.awardExperience(defenderId, defenderExp);
      }
    } else if (defenderDestroyed) {
      // Attacker won
      attackerExp = this.calculateCombatExperience(attacker, defender, true);
      if (attackerExp > 0) {
        await this.awardExperience(attackerId, attackerExp);
      }
    }

    // Handle unit destruction
    if (attackerDestroyed) {
      await this.destroyUnit(attackerId);
    } else {
      await this.databaseProvider
        .getDatabase()
        .update(units)
        .set({ health: attacker.health, movementPoints: '0' })
        .where(eq(units.id, attackerId));
    }

    if (defenderDestroyed) {
      await this.destroyUnit(defenderId);
      const stackProtected = Boolean(
        this.gameManagerCallback?.getCityAt?.(defender.x, defender.y) ||
          this.mapManager
            ?.getTile(defender.x, defender.y)
            ?.improvements?.some((extra: string) => extra === 'fortress' || extra === 'airbase')
      );
      const collateralDestroyedIds: string[] = [];
      if (!stackProtected) {
        // Classic enables killstack by default outside cities, fortresses, and
        // airbases, whose NoStackDeath flag protects the remaining defenders.
        // @reference reference/freeciv/common/game.h:552
        // @reference reference/freeciv/common/combat.c:990-1000
        for (const stackedUnit of defenderTileUnits) {
          await this.destroyUnit(stackedUnit.id);
          collateralDestroyedIds.push(stackedUnit.id);
        }
      }
      // If defender is destroyed and attacker is melee, move to defender's position
      const hostileUnitsRemain = this.getUnitsAt(defender.x, defender.y).some(
        unit => unit.playerId === defender.playerId
      );
      if (!attackerDestroyed && attackerType.range === 1 && !hostileUnitsRemain) {
        attacker.x = defender.x;
        attacker.y = defender.y;
        await this.databaseProvider
          .getDatabase()
          .update(units)
          .set({ x: attacker.x, y: attacker.y })
          .where(eq(units.id, attackerId));
      }
      resultCollateralDestroyedIds = collateralDestroyedIds;
    } else {
      await this.databaseProvider
        .getDatabase()
        .update(units)
        .set({ health: defender.health })
        .where(eq(units.id, defenderId));
    }

    const result: CombatResult = {
      attackerId,
      defenderId,
      attackerDamage: damageToAttacker,
      defenderDamage: damageToDefender,
      attackerDestroyed,
      defenderDestroyed,
      collateralDestroyedIds: resultCollateralDestroyedIds,
      experienceGained: {
        attacker: attackerExp,
        defender: defenderExp,
      },
    };

    logger.info(`Combat: ${attackerId} vs ${defenderId}`, result);
    return result;
  }

  /**
   * Fortify a unit (increases defense)
   */
  async fortifyUnit(unitId: string): Promise<void> {
    const unit = this.units.get(unitId);
    if (!unit) {
      throw new Error(`Unit not found: ${unitId}`);
    }

    unit.fortified = true;
    unit.movementLeft = 0; // Fortifying uses all movement

    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ movementPoints: '0', isFortified: true })
      .where(eq(units.id, unitId));

    logger.info(`Unit ${unitId} fortified`);
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
    for (const unit of this.units.values()) {
      if (unit.playerId === playerId) {
        const unitType = UNIT_TYPES[unit.unitTypeId];
        // Restore full movement points in fragments
        unit.movementLeft = unitType.movement * 3;

        // Heal fortified units
        // @reference freeciv/server/unithand.c unit_restore_movepoints() - heal_unit()
        if (unit.fortified && unit.health < 100) {
          unit.health = Math.min(100, unit.health + 10);
        }
        const city = this.gameManagerCallback?.getCityAt?.(unit.x, unit.y);
        if (city && city.playerId === playerId && this.effectsManager) {
          const regeneration = this.effectsManager.calculateEffect(EffectType.HP_REGEN, {
            playerId,
            unitType: unit.unitTypeId,
            unitClass: unitType.rulesetUnitClass,
            cityBuildings: new Set(city.buildings ?? []),
          }).value;
          unit.health = Math.min(100, unit.health + regeneration);
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
          })
          .where(eq(units.id, unit.id));
      }
    }
  }

  /**
   * Get all units for a player
   */
  getPlayerUnits(playerId: string): Unit[] {
    return Array.from(this.units.values()).filter(u => u.playerId === playerId);
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
      const unitType = UNIT_TYPES[dbUnit.unitType];
      if (!unitType) {
        logger.warn(`Unknown unit type: ${dbUnit.unitType} for unit ${dbUnit.id}`);
        continue; // Skip invalid unit types
      }

      const unit: Unit = {
        id: dbUnit.id,
        gameId: dbUnit.gameId,
        playerId: dbUnit.playerId,
        unitTypeId: dbUnit.unitType,
        x: dbUnit.x,
        y: dbUnit.y,
        movementLeft: Math.min(parseFloat(dbUnit.movementPoints) || 0, unitType.movement * 3),
        health: dbUnit.health,
        veteranLevel: dbUnit.veteranLevel,
        experience: dbUnit.experience || 0,
        fortified: dbUnit.isFortified,
        orders: Array.isArray(dbUnit.orders)
          ? (dbUnit.orders as UnitOrder[])
          : dbUnit.orders && typeof dbUnit.orders === 'string' && dbUnit.orders.trim()
            ? JSON.parse(dbUnit.orders)
            : [],
        transportedBy: dbUnit.transportedBy ?? undefined,
        cargoUnits: Array.isArray(dbUnit.cargoUnits) ? (dbUnit.cargoUnits as string[]) : [],
        homeCityId: dbUnit.homeCityId ?? undefined,
        automation: dbUnit.isAutomated
          ? dbUnit.currentOrder === 'autoSettler'
            ? 'settler'
            : 'explore'
          : undefined,
      };
      this.units.set(unit.id, unit);
    }

    logger.info(`Loaded ${this.units.size} units for game ${this.gameId}`);
  }

  /**
   * Calculate attack power with veteran bonuses.
   * @reference reference/freeciv/common/combat.c:608-647
   */
  private calculateAttackStrength(unit: Unit, unitType: UnitType): number {
    const veteranLevel = this.getVeteranLevel(unit.veteranLevel);
    return Math.max(1, Math.floor((unitType.attack ?? unitType.combat) * veteranLevel.powerFactor));
  }

  /**
   * Calculate defense power with veteran, terrain, fortify, and city bonuses.
   * Kept under the established name because focused ruleset tests exercise it.
   * @reference reference/freeciv/common/combat.c:650-708
   * @reference freeciv/common/combat.c defense_multiplication() / EFT_FORTIFY_DEFENSE_BONUS
   */
  private calculateCombatStrength(unit: Unit, unitType: UnitType): number {
    let strength = unitType.defense ?? unitType.combat;

    const veteranLevel = this.getVeteranLevel(unit.veteranLevel);
    strength = Math.floor(strength * veteranLevel.powerFactor);

    if (unitType.rulesetUnitClassFlags.includes('TerrainDefense')) {
      const terrainDefense = rulesetLoader.getTerrain(this.getTerrainAt(unit.x, unit.y)).defense;
      strength = Math.floor((strength * (100 + terrainDefense)) / 100);
    }

    // @reference reference/freeciv/common/combat.c:697-708
    strength = Math.floor(
      (strength * (100 + this.calculateFortifyDefenseBonus(unit, unitType))) / 100
    );

    strength = Math.floor(
      (strength * (100 + this.calculateCityDefenseBonus(unit, unitType))) / 100
    );

    return Math.max(0, strength);
  }

  /**
   * Classic Fortify_Defense_Bonus for fortified units and city-center land defenders.
   * @reference reference/freeciv/data/classic/effects.ruleset:157-173
   * @reference reference/freeciv/common/combat.c:697-708
   */
  private calculateFortifyDefenseBonus(unit: Unit, unitType: UnitType): number {
    if (!this.effectsManager) return 0;

    const city = this.gameManagerCallback?.getCityAt?.(unit.x, unit.y);
    const tileIsCityCenter = Boolean(city && city.playerId === unit.playerId);

    return this.effectsManager.calculateEffect(EffectType.FORTIFY_DEFENSE_BONUS, {
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

  private calculateCityDefenseBonus(unit: Unit, unitType: UnitType): number {
    const city = this.gameManagerCallback?.getCityAt?.(unit.x, unit.y);
    if (!city || city.playerId !== unit.playerId || !this.effectsManager) return 0;

    return this.effectsManager.calculateEffect(EffectType.DEFEND_BONUS, {
      playerId: unit.playerId,
      unitId: unit.id,
      unitType: unit.unitTypeId,
      unitClass: unitType.rulesetUnitClass,
      unitTypeFlags: new Set(unitType.flags),
      tileX: unit.x,
      tileY: unit.y,
      tileIsCityCenter: true,
      cityBuildings: new Set(city.buildings ?? []),
      playerBuildings: new Set(this.gameManagerCallback?.getPlayerBuildings?.(unit.playerId) ?? []),
    }).value;
  }

  /**
   * Get veteran level definition
   * @reference freeciv/common/unittype.h veteran levels
   */
  private getVeteranLevel(level: number): VeteranLevel {
    const veteranLevels: VeteranLevel[] = [
      { name: 'Green', powerFactor: 1.0, moveBonus: 0, experienceRequired: 0 },
      { name: 'Veteran', powerFactor: 1.5, moveBonus: 0, experienceRequired: 20 },
      { name: 'Hardened', powerFactor: 1.75, moveBonus: 1, experienceRequired: 40 },
      { name: 'Elite', powerFactor: 2.0, moveBonus: 1, experienceRequired: 80 },
    ];

    return veteranLevels[Math.min(level, veteranLevels.length - 1)];
  }

  /**
   * Award experience to unit and check for promotion
   * @reference freeciv/server/unittools.c unit_versus_unit()
   */
  async awardExperience(unitId: string, experiencePoints: number): Promise<boolean> {
    const unit = this.units.get(unitId);
    if (!unit) {
      return false;
    }

    const oldLevel = unit.veteranLevel;
    unit.experience += experiencePoints;

    // Check for promotion
    const newLevel = this.calculateVeteranLevelFromExperience(unit.experience);

    if (newLevel > oldLevel) {
      unit.veteranLevel = newLevel;

      // Update movement points for veteran bonus
      const veteranLevel = this.getVeteranLevel(newLevel);
      const unitType = UNIT_TYPES[unit.unitTypeId];
      const maxMovement = (unitType.movement + veteranLevel.moveBonus) * 3; // Convert to fragments

      // If unit hasn't moved this turn, give them bonus movement
      if (unit.movementLeft === unitType.movement * 3) {
        unit.movementLeft = maxMovement;
      }

      // Update database
      await this.databaseProvider
        .getDatabase()
        .update(units)
        .set({
          veteranLevel: unit.veteranLevel,
          experience: unit.experience,
          movementPoints: unit.movementLeft.toString(),
        })
        .where(eq(units.id, unitId));

      logger.info(`Unit ${unitId} promoted to ${this.getVeteranLevel(newLevel).name}!`, {
        unitId,
        oldLevel,
        newLevel,
        experience: unit.experience,
        experienceAwarded: experiencePoints,
      });

      return true; // Unit was promoted
    } else {
      // Just update experience
      await this.databaseProvider
        .getDatabase()
        .update(units)
        .set({ experience: unit.experience })
        .where(eq(units.id, unitId));
    }

    return false; // No promotion
  }

  /**
   * Calculate veteran level from total experience
   */
  private calculateVeteranLevelFromExperience(experience: number): number {
    const veteranLevels = [
      { level: 0, required: 0 }, // Green
      { level: 1, required: 20 }, // Veteran
      { level: 2, required: 40 }, // Hardened
      { level: 3, required: 80 }, // Elite
    ];

    let level = 0;
    for (const vet of veteranLevels) {
      if (experience >= vet.required) {
        level = vet.level;
      } else {
        break;
      }
    }

    return level;
  }

  /**
   * Calculate experience gained from combat
   * @reference freeciv/server/unittools.c unit_versus_unit()
   */
  calculateCombatExperience(attacker: Unit, defender: Unit, attackerWon: boolean): number {
    const attackerType = UNIT_TYPES[attacker.unitTypeId];
    const defenderType = UNIT_TYPES[defender.unitTypeId];

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
    return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
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
    const destinationTerrain = this.getTerrainAt(toX, toY);
    const unitType = UNIT_TYPES[unit.unitTypeId];
    if (unitType?.rulesetUnitClass === 'Trireme' && destinationTerrain === 'deep_ocean') {
      return -1;
    }
    const movementCost = getTerrainMovementCost(destinationTerrain, unit.unitTypeId);
    if (movementCost < 0) return movementCost;

    const fromTile = this.mapManager?.getTile(fromX, fromY);
    const destinationTile = this.mapManager?.getTile(toX, toY);
    const usesLandInfrastructure = unitType?.rulesetUnitClass === 'Land';

    // Classic road costs are already expressed in movement fragments. Both
    // endpoints must carry the integrating road extra.
    // @reference reference/freeciv/data/classic/terrain.ruleset:2078-2093
    if (usesLandInfrastructure && fromTile?.hasRailroad && destinationTile?.hasRailroad) {
      return 0;
    }
    if (usesLandInfrastructure && fromTile?.hasRoad && destinationTile?.hasRoad) {
      return 1;
    }
    if (unitType?.flags?.includes('IgTer')) {
      return 1;
    }

    return movementCost;
  }

  /**
   * Get unit type maximum movement points
   */
  getUnitMaxMovement(unitTypeId: string): number {
    const unitType = getUnitType(unitTypeId);
    return unitType ? unitType.movement : 1;
  }

  /**
   * Check if position is valid
   */
  private isValidPosition(x: number, y: number): boolean {
    return x >= 0 && x < this.mapWidth && y >= 0 && y < this.mapHeight;
  }

  /**
   * Destroy a unit
   */
  private async destroyUnit(unitId: string): Promise<void> {
    const unit = this.units.get(unitId);
    if (!unit) return;

    for (const cargoId of [...(unit.cargoUnits ?? [])]) {
      await this.destroyUnit(cargoId);
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
    this.units.delete(unitId);
    await this.databaseProvider.getDatabase().delete(units).where(eq(units.id, unitId));
    logger.info(`Unit ${unitId} destroyed`);
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
    unit.playerId = newPlayerId;
    unit.homeCityId = homeCityId;
    unit.orders = [];
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
        movementPoints: '0',
        isFortified: false,
      })
      .where(eq(units.id, unitId));
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

  async finishDiplomatMission(unitId: string): Promise<void> {
    const unit = this.units.get(unitId);
    if (!unit) return;
    unit.movementLeft = 0;
    unit.orders = [];
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ movementPoints: '0', orders: [], currentOrder: null })
      .where(eq(units.id, unitId));
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
   * Get unit type definition by ID
   */
  getUnitType(unitTypeId: string): UnitType | undefined {
    return getUnitType(unitTypeId);
  }

  /**
   * Execute action for unit using ActionSystem
   */
  async executeUnitAction(
    unitId: string,
    actionType: ActionType,
    targetX?: number,
    targetY?: number,
    actingPlayerId?: string
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

    if (![ActionType.AUTO_EXPLORE, ActionType.AUTO_SETTLER].includes(actionType)) {
      await this.clearAutomation(unit);
    }
    if (actionType === ActionType.PARADROP) {
      return this.executeParadrop(unit, targetX, targetY);
    }
    if (actionType === ActionType.AIRLIFT) {
      return this.executeAirlift(unit, targetX, targetY);
    }
    if (actionType === ActionType.BOMBARD) {
      return this.executeBombard(unit, targetX, targetY);
    }
    if (actionType === ActionType.AUTO_EXPLORE || actionType === ActionType.AUTO_SETTLER) {
      return this.setAutomation(unit, actionType);
    }

    if (actionType === ActionType.LOAD_UNIT) {
      const transport = this.findAvailableTransportAt(unit, targetX ?? unit.x, targetY ?? unit.y);
      const loaded = transport ? await this.loadUnitOntoTransport(transport.id, unit.id) : false;
      return {
        success: loaded,
        message: loaded ? 'Unit loaded' : 'No compatible transport with available capacity',
      };
    }
    if (actionType === ActionType.UNLOAD_UNIT) {
      const unloaded = await this.unloadUnit(unit.id, targetX ?? unit.x, targetY ?? unit.y);
      return {
        success: unloaded,
        message: unloaded ? 'Unit unloaded' : 'Unit cannot unload on the target tile',
      };
    }
    if (actionType === ActionType.GOTO) {
      return this.executeAuthoritativeGoto(unit, targetX, targetY);
    }

    // Execute action through ActionSystem
    const result = await this.actionSystem.executeAction(unit, actionType, targetX, targetY);

    // Apply result to unit state if successful
    if (result.success) {
      await this.applyActionResult(unit, actionType, result);
    }

    return result;
  }

  private canParadrop(unit: Unit, targetX?: number, targetY?: number): boolean {
    const unitType = UNIT_TYPES[unit.unitTypeId];
    if (!this.isParadropActorReady(unit, unitType)) return false;
    if (
      targetX === undefined ||
      targetY === undefined ||
      !this.isValidPosition(targetX, targetY) ||
      this.calculateDistance(unit.x, unit.y, targetX, targetY) > unitType.paratroopersRange ||
      getTerrainMovementCost(this.getTerrainAt(targetX, targetY), unit.unitTypeId) < 0
    ) {
      return false;
    }
    return this.hasParadropSource(unit);
  }

  private isParadropActorReady(unit: Unit, unitType: UnitType): boolean {
    return Boolean(
      unitType.flags?.includes('Paratroopers') &&
        unitType.paratroopersRange > 0 &&
        !unit.transportedBy &&
        unit.movementLeft >= SINGLE_MOVE
    );
  }

  private hasParadropSource(unit: Unit): boolean {
    const sourceCity = this.gameManagerCallback?.getCityAt?.(unit.x, unit.y);
    if (sourceCity?.playerId === unit.playerId) return true;
    const sourceTile = this.mapManager?.getTile(unit.x, unit.y);
    if (!sourceTile || !this.tileHasExtra(sourceTile, 'airbase')) return false;
    return sourceTile.owner === undefined || sourceTile.owner === unit.playerId;
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
    const hostileUnits = this.getUnitsAt(x, y).filter(target => target.playerId !== unit.playerId);
    const territoryError = await this.validateParadropTerritory(unit, x, y, targetCity);
    if (territoryError) return territoryError;
    if (hostileUnits.length > 0) {
      await this.destroyUnit(unit.id);
      return {
        success: true,
        message: 'The unit was lost while paradropping onto enemy units',
        unitDestroyed: true,
      };
    }

    unit.x = x;
    unit.y = y;
    unit.fortified = false;
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ x, y, isFortified: false, lastActionTurn: this.currentTurnProvider?.() ?? 1 })
      .where(eq(units.id, unit.id));
    this.gameManagerCallback?.broadcastUnitMoved(this.gameId, unit.id, x, y, unit.movementLeft);
    return {
      success: true,
      message: `Unit paradropped to (${x}, ${y})`,
      newPosition: { x, y },
      newMovementLeft: unit.movementLeft,
    };
  }

  private async validateParadropTerritory(
    unit: Unit,
    x: number,
    y: number,
    targetCity: CityAtLocation | null | undefined
  ): Promise<ActionResult | undefined> {
    const targetOwner = targetCity?.playerId ?? this.mapManager?.getTile(x, y)?.owner;
    if (!targetOwner || targetOwner === unit.playerId) return undefined;
    const relation = await this.getDiplomaticState(unit.playerId, targetOwner);
    if (relation !== 'war') {
      return { success: false, message: 'Cannot paradrop onto foreign territory without war' };
    }
    if (!targetCity) return undefined;
    return this.captureParadropCity(unit, targetCity);
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
    const actorInvalid =
      UNIT_TYPES[unit.unitTypeId].rulesetUnitClass !== 'Land' ||
      unit.transportedBy ||
      unit.movementLeft <= 0;
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
    return Boolean(
      source &&
        destination &&
        source.id !== destination.id &&
        source.playerId === unit.playerId &&
        source.buildings?.includes('airport') &&
        destination.buildings?.includes('airport') &&
        this.gameManagerCallback?.reserveAirlift
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

    unit.x = targetX as number;
    unit.y = targetY as number;
    unit.movementLeft = 0;
    unit.fortified = false;
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
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
    const type = UNIT_TYPES[unit.unitTypeId];
    if (
      type.bombardRate <= 0 ||
      unit.movementLeft <= 0 ||
      targetX === undefined ||
      targetY === undefined ||
      this.calculateDistance(unit.x, unit.y, targetX, targetY) > type.range
    ) {
      return false;
    }
    return this.getUnitsAt(targetX, targetY).some(target => target.playerId !== unit.playerId);
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
    const type = UNIT_TYPES[unit.unitTypeId];
    const targets = this.getUnitsAt(targetX!, targetY!).filter(
      target => target.playerId !== unit.playerId && !target.transportedBy
    );
    const affectedUnitIds: string[] = [];
    for (const target of targets) {
      const targetType = UNIT_TYPES[target.unitTypeId];
      const damage = Math.max(
        1,
        Math.round((type.bombardRate * (type.firepower ?? 1) * 100) / (targetType.hitpoints ?? 10))
      );
      target.health = Math.max(1, target.health - damage);
      affectedUnitIds.push(target.id);
      await this.databaseProvider
        .getDatabase()
        .update(units)
        .set({ health: target.health })
        .where(eq(units.id, target.id));
    }
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

  private async setAutomation(unit: Unit, actionType: ActionType): Promise<ActionResult> {
    const automation = actionType === ActionType.AUTO_SETTLER ? 'settler' : 'explore';
    if (
      (automation === 'settler' && !UNIT_TYPES[unit.unitTypeId].canBuildImprovements) ||
      (automation === 'explore' && UNIT_TYPES[unit.unitTypeId].movement <= 0)
    ) {
      return { success: false, message: `Unit cannot use ${automation} automation` };
    }
    if (unit.automation === automation) {
      await this.clearAutomation(unit);
      return { success: true, message: `${automation} automation stopped`, newOrders: [] };
    }
    unit.automation = automation;
    unit.orders = [{ type: automation === 'settler' ? 'autoSettler' : 'autoExplore' }];
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ isAutomated: true, orders: unit.orders, currentOrder: unit.orders[0].type })
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
    unit.autoExploreTarget = undefined;
    unit.orders = [];
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ isAutomated: false, orders: [], currentOrder: null })
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
    targetY?: number
  ): Promise<ActionResult> {
    if (targetX === undefined || targetY === undefined || !this.isValidPosition(targetX, targetY)) {
      return { success: false, message: 'Invalid target coordinates' };
    }
    if (unit.x === targetX && unit.y === targetY) {
      return { success: false, message: 'Unit is already at target position' };
    }
    if (!this.gameManagerCallback?.requestPath) {
      return { success: false, message: 'Pathfinding target is unavailable' };
    }
    const startingMovement = unit.movementLeft;
    const pathResult = await this.gameManagerCallback.requestPath(
      unit.playerId,
      unit.id,
      targetX,
      targetY
    );
    const path = pathResult.path?.tiles;
    if (!pathResult.success || !Array.isArray(path) || path.length < 2) {
      return { success: false, message: pathResult.error ?? 'No valid path to target' };
    }

    let moved = 0;
    let failure: unknown;
    for (const step of path.slice(1)) {
      if (unit.movementLeft <= 0) break;
      try {
        await this.moveUnit(unit.id, step.x, step.y);
        moved++;
      } catch (error) {
        failure = error;
        break;
      }
    }
    if (moved === 0) {
      return {
        success: false,
        message: failure instanceof Error ? failure.message : 'Cannot move along path',
      };
    }

    const reached = unit.x === targetX && unit.y === targetY;
    unit.orders = reached ? [] : [{ type: 'move', targetX, targetY }];
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ orders: unit.orders, currentOrder: unit.orders[0]?.type ?? null })
      .where(eq(units.id, unit.id));
    this.gameManagerCallback.broadcastUnitMoved(
      this.gameId,
      unit.id,
      unit.x,
      unit.y,
      unit.movementLeft
    );
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

    if (actionType === ActionType.LOAD_UNIT) {
      return Boolean(this.findAvailableTransportAt(unit, targetX ?? unit.x, targetY ?? unit.y));
    }
    if (actionType === ActionType.UNLOAD_UNIT) {
      return this.canUnloadUnit(unitId, targetX ?? unit.x, targetY ?? unit.y);
    }
    if (actionType === ActionType.PARADROP) {
      return this.canParadrop(unit, targetX, targetY);
    }
    if (actionType === ActionType.AIRLIFT) {
      return this.canAirlift(unit, targetX, targetY);
    }
    if (actionType === ActionType.BOMBARD) {
      return this.canBombard(unit, targetX, targetY);
    }
    if (actionType === ActionType.AUTO_EXPLORE) {
      return UNIT_TYPES[unit.unitTypeId].movement > 0;
    }
    if (actionType === ActionType.AUTO_SETTLER) {
      return UNIT_TYPES[unit.unitTypeId].canBuildImprovements;
    }

    return this.actionSystem.canUnitPerformAction(unit, actionType, targetX, targetY);
  }

  /**
   * Apply action result to unit state
   */
  private async applyActionResult(
    unit: Unit,
    actionType: ActionType,
    result: ActionResult
  ): Promise<void> {
    let updateData: any = {};

    switch (actionType) {
      case ActionType.FORTIFY:
        updateData = this.handleFortify(unit);
        break;

      case ActionType.SENTRY:
        updateData = this.handleSentry(unit);
        break;

      case ActionType.WAIT:
        // Wait preserves movement points
        break;

      case ActionType.SKIP_TURN:
        unit.movementLeft = 0;
        updateData = { movementPoints: '0' };
        break;

      case ActionType.GOTO:
        updateData = this.handleGoto(unit, result);
        break;

      case ActionType.FOUND_CITY: {
        const destroyed = await this.handleFoundCity(unit, result);
        if (destroyed) return;
        break;
      }

      case ActionType.TRADE_ROUTE:
        if (result.unitDestroyed) {
          await this.destroyUnit(unit.id);
          return;
        }
        break;

      case ActionType.DISBAND_UNIT:
        await this.destroyUnit(unit.id);
        return;

      case ActionType.BUILD_ROAD:
      case ActionType.BUILD_RAILROAD:
      case ActionType.BUILD_IRRIGATION:
      case ActionType.BUILD_MINE:
      case ActionType.PILLAGE:
      case ActionType.TRANSFORM_TERRAIN:
      case ActionType.CLEAN_POLLUTION:
        updateData = this.handleWorkerActivity(unit, actionType);
        break;
    }

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
      [ActionType.PILLAGE]: 'pillage',
      [ActionType.TRANSFORM_TERRAIN]: 'transform',
      [ActionType.CLEAN_POLLUTION]: 'cleanPollution',
    };
    const orderType = orderTypes[actionType];
    if (!orderType) return {};
    unit.orders = [{ type: orderType }];
    unit.activity = undefined;
    unit.movementLeft = 0;
    return {
      movementPoints: '0',
      orders: unit.orders,
      currentOrder: orderType,
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

    for (const unit of this.units.values()) {
      await this.processUnitOrder(unit, playerId);
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

    // Process different types of orders
    switch (order.type) {
      case 'move':
        await this.processMoveOrder(unit, order);
        break;
      case 'patrol':
        await this.processPatrolOrder(unit, order);
        break;
      case 'road':
      case 'railroad':
      case 'irrigate':
      case 'mine':
      case 'transform':
      case 'pillage':
      case 'cleanPollution':
        await this.processActivityOrder(unit, order);
        break;
      case 'fortify':
        await this.processFortifyOrder(unit, order);
        break;
      case 'sentry':
        await this.processSentryOrder(unit, order);
        break;
      case 'autoExplore':
        await this.processAutoExploreOrder(unit);
        break;
      case 'autoSettler':
        await this.processAutoSettlerOrder(unit);
        break;
      default:
        logger.warn(`Unknown order type: ${order.type} for unit ${unit.id}`);
        this.removeCurrentOrder(unit);
    }
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
      this.handleFailedGoto(unit, result);
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
  private handleFailedGoto(unit: Unit, result: any): void {
    logger.warn(`Failed to process GOTO order for unit ${unit.id}: ${result.message}`);
    // Clear failed orders
    unit.orders = [];
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
      logger.info(`Unit ${unit.id} patrolling toward (${targetX}, ${targetY})`);
    } else {
      logger.warn(`Patrol failed for unit ${unit.id}: ${result.message}`);
      this.removeCurrentOrder(unit);
    }
  }

  /**
   * Process activity order (road, mine, irrigate, etc.)
   */
  private async processActivityOrder(unit: Unit, order: UnitOrder): Promise<void> {
    // Initialize activity if not already started
    if (!order.activity || order.activity.type === 'idle') {
      const activityType = this.getActivityTypeFromOrder(order.type);
      const turnsRequired = this.getActivityDuration(order.type, unit);

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
    const candidates: Array<[ActionType, UnitOrder['type']]> = [
      [ActionType.CLEAN_POLLUTION, 'cleanPollution'],
      [ActionType.BUILD_ROAD, 'road'],
      [ActionType.BUILD_IRRIGATION, 'irrigate'],
      [ActionType.BUILD_MINE, 'mine'],
    ];
    const selected = candidates.find(([action]) =>
      this.actionSystem.canUnitPerformAction(unit, action)
    );
    if (selected) {
      const [action, orderType] = selected;
      const result = await this.actionSystem.executeAction(unit, action);
      if (result.success) {
        unit.orders = [{ type: orderType }, { type: 'autoSettler' }];
        unit.movementLeft = 0;
        await this.databaseProvider
          .getDatabase()
          .update(units)
          .set({
            movementPoints: '0',
            isAutomated: true,
            orders: unit.orders,
            currentOrder: orderType,
          })
          .where(eq(units.id, unit.id));
        return;
      }
    }

    const moved = await this.moveAutomatedUnitTowardUnexplored(unit);
    if (!moved) {
      await this.clearAutomation(unit);
      return;
    }
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
    const orderType = unit.automation === 'settler' ? 'autoSettler' : 'autoExplore';
    unit.orders = [{ type: orderType }];
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({ isAutomated: true, orders: unit.orders, currentOrder: orderType })
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
  private getActivityDuration(orderType: string, unit: Unit): number {
    const tile = this.mapManager?.getTile(unit.x, unit.y);
    const terrain = tile ? rulesetLoader.getTerrain(tile.terrain) : undefined;
    const baseTimes: Record<string, number> = {
      road: terrain?.roadTime ?? 0,
      railroad: rulesetLoader.getExtra('Railroad').build_time ?? 0,
      irrigate: terrain?.irrigationTime ?? 0,
      mine: terrain?.miningTime ?? 0,
      transform: terrain?.transformTime ?? 0,
      pillage: 1,
      cleanPollution:
        rulesetLoader.getTerrainExtraRemovalTime(tile?.terrain ?? '', 'Pollution') ??
        rulesetLoader.getExtra('Pollution').removal_time ??
        0,
    };

    let baseTurns = baseTimes[orderType] || 1;

    // Engineer units work twice as fast as workers
    if (unit.unitTypeId === 'engineers') {
      baseTurns = Math.ceil(baseTurns / 2);
    }

    return Math.max(1, baseTurns);
  }

  /**
   * Complete an activity and apply its effects
   */
  private async completeActivity(unit: Unit, order: UnitOrder): Promise<void> {
    const tile = this.mapManager?.getTile(unit.x, unit.y);
    if (!tile) {
      throw new Error(`No map tile at (${unit.x}, ${unit.y})`);
    }

    const extras = new Set(tile.improvements);
    switch (order.type) {
      case 'road':
        extras.add('road');
        this.mapManager.updateTileProperty(unit.x, unit.y, 'hasRoad', true);
        break;
      case 'railroad':
        extras.add('railroad');
        this.mapManager.updateTileProperty(unit.x, unit.y, 'hasRailroad', true);
        break;
      case 'irrigate':
        extras.delete('mine');
        extras.add('irrigation');
        break;
      case 'mine':
        extras.delete('irrigation');
        extras.add('mine');
        break;
      case 'transform': {
        const transformed = rulesetLoader.getTerrain(tile.terrain).transformTo;
        if (transformed) {
          this.mapManager.updateTileProperty(unit.x, unit.y, 'terrain', transformed as TerrainType);
          extras.delete('irrigation');
          extras.delete('mine');
        }
        break;
      }
      case 'pillage': {
        const target = tile.hasRailroad ? 'railroad' : tile.hasRoad ? 'road' : tile.improvements[0];
        if (target === 'railroad') {
          this.mapManager.updateTileProperty(unit.x, unit.y, 'hasRailroad', false);
        } else if (target === 'road') {
          this.mapManager.updateTileProperty(unit.x, unit.y, 'hasRoad', false);
        }
        if (target) extras.delete(target);
        break;
      }
      case 'cleanPollution':
        extras.delete('pollution');
        break;
    }
    this.mapManager.updateTileProperty(unit.x, unit.y, 'improvements', [...extras]);
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
  getVisibleUnits(playerId: string, visibleTiles: Set<string>): Unit[] {
    return Array.from(this.units.values()).filter(unit => {
      // Player always sees their own units
      if (unit.playerId === playerId) return true;

      // Check if unit is in visible tiles
      const tileKey = `${unit.x},${unit.y}`;
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

    const transportType = UNIT_TYPES[transport.unitTypeId];
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
    if (!unit || !unit.transportedBy) {
      return false; // Not transported, cannot deboard
    }

    const transport = this.units.get(unit.transportedBy);
    if (!transport) {
      return false; // Transport not found
    }

    const unitType = UNIT_TYPES[unit.unitTypeId];
    const x = targetX ?? transport.x;
    const y = targetY ?? transport.y;
    if (!this.isValidPosition(x, y) || this.calculateDistance(transport.x, transport.y, x, y) > 1) {
      return false;
    }
    const terrain = this.getTerrainAt(x, y);
    if (getTerrainMovementCost(terrain, unit.unitTypeId) < 0) {
      return false;
    }
    const enemy = this.getUnitsAt(x, y).some(candidate => candidate.playerId !== unit.playerId);
    const city = this.gameManagerCallback?.getCityAt?.(x, y);
    return !enemy && (!city || city.playerId === unit.playerId) && Boolean(unitType);
  }

  /**
   * Check if unit can load another unit
   */
  canLoadUnit(transportId: string, cargoId: string): boolean {
    const transport = this.units.get(transportId);
    const cargo = this.units.get(cargoId);

    if (!transport || !cargo) {
      return false;
    }
    if (transport.playerId !== cargo.playerId) {
      return false;
    }

    // Units must be on the same tile
    if (transport.x !== cargo.x || transport.y !== cargo.y) {
      return false;
    }

    // Unit can't transport itself
    if (transportId === cargoId) {
      return false;
    }

    // Cargo must not already be transported
    if (cargo.transportedBy) {
      return false;
    }

    // Transport must have capacity
    if (this.getTransportCapacityRemaining(transportId) <= 0) {
      return false;
    }

    // Check transport compatibility
    return this.isValidTransportCombination(transport.unitTypeId, cargo.unitTypeId);
  }

  /**
   * Check if transport and cargo combination is valid
   * @reference freeciv-web/javascript/unit.js unit_could_possibly_load()
   */
  private isValidTransportCombination(transportType: string, cargoType: string): boolean {
    const transport = UNIT_TYPES[transportType];
    const cargo = UNIT_TYPES[cargoType];
    return Boolean(
      transport &&
        cargo &&
        (transport.transport_capacity ?? 0) > 0 &&
        transport.cargoClasses.includes(cargo.rulesetUnitClass ?? '')
    );
  }

  private findAvailableTransportAt(cargo: Unit, x: number, y: number): Unit | undefined {
    return this.getUnitsAt(x, y).find(
      transport =>
        transport.playerId === cargo.playerId &&
        this.getTransportCapacityRemaining(transport.id) > 0 &&
        this.isValidTransportCombination(transport.unitTypeId, cargo.unitTypeId)
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

    // Update cargo unit
    cargo.transportedBy = transportId;
    cargo.movementLeft = 0; // Loading consumes movement

    // Update transport unit
    if (!transport.cargoUnits) {
      transport.cargoUnits = [];
    }
    transport.cargoUnits.push(cargoId);

    // Update database
    await this.databaseProvider
      .getDatabase()
      .update(units)
      .set({
        transportedBy: transportId,
        movementPoints: '0',
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

    transport.cargoUnits = (transport.cargoUnits ?? []).filter(id => id !== unitId);
    cargo.transportedBy = undefined;
    cargo.x = x;
    cargo.y = y;
    cargo.movementLeft = 0;

    await Promise.all([
      this.databaseProvider
        .getDatabase()
        .update(units)
        .set({ transportedBy: null, x, y, movementPoints: '0' })
        .where(eq(units.id, unitId)),
      this.databaseProvider
        .getDatabase()
        .update(units)
        .set({ cargoUnits: transport.cargoUnits })
        .where(eq(units.id, transport.id)),
    ]);
    return true;
  }
}
