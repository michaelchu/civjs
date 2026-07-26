import { DatabaseProvider } from '@database';
import { units } from '@database/schema/units';
import { eq } from 'drizzle-orm';
import { logger } from '@utils/logger';
import { getTerrainMovementCost } from '@game/constants/MovementConstants';
import { UNIT_TYPES, getUnitType, UnitType } from '@game/constants/UnitConstants';
import { ActionSystem } from '@game/systems/ActionSystem';
import { ActionType, ActionResult } from '@app-types/shared/actions';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';

interface CityAtLocation {
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
  transportedBy?: string; // ID of unit transporting this unit
  cargoUnits?: string[]; // IDs of units being transported by this unit
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
    | 'sentry'
    | 'wait'
    | 'disband';
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
    },
    effectsManager?: EffectsManager
  ) {
    this.gameId = gameId;
    this.databaseProvider = databaseProvider;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.mapManager = mapManager;
    this.gameManagerCallback = gameManagerCallback;
    this.effectsManager = effectsManager;
    this.actionSystem = new ActionSystem(gameId, gameManagerCallback);
  }

  public setCurrentTurnProvider(provider: () => number): void {
    this.currentTurnProvider = provider;
  }

  /**
   * Create a new unit
   */
  async createUnit(playerId: string, unitTypeId: string, x: number, y: number): Promise<Unit> {
    const unitType = UNIT_TYPES[unitTypeId];
    if (!unitType) {
      throw new Error(`Unknown unit type: ${unitTypeId}`);
    }

    // Validate position
    if (!this.isValidPosition(x, y)) {
      throw new Error(`Invalid position: ${x}, ${y}`);
    }

    // Check if there's already a unit at this position (for non-stacking rules)
    const existingUnit = this.getUnitAt(x, y);
    if (existingUnit && unitType.unitClass === 'civilian') {
      throw new Error('Cannot stack civilian units');
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

    const unitType = UNIT_TYPES[unit.unitTypeId];

    this.validateMoveTarget(newX, newY);

    const movementCost = this.calculateTerrainMovementCost(unit, unit.x, unit.y, newX, newY);
    this.ensureSufficientMovement(unit, movementCost);

    const targetUnit = this.getUnitAt(newX, newY);
    this.validateDestination(unit, unitType, targetUnit, newX, newY);

    // Update unit state
    unit.x = newX;
    unit.y = newY;
    unit.movementLeft -= movementCost;
    unit.fortified = false; // Moving breaks fortification

    await this.updateUnitPositionInDb(unitId, unit);

    logger.info(`Unit ${unitId} moved to (${newX}, ${newY})`);
    return true;
  }

  private validateMoveTarget(newX: number, newY: number): void {
    if (!this.isValidPosition(newX, newY)) {
      throw new Error(`Invalid position: ${newX}, ${newY}`);
    }
  }

  private ensureSufficientMovement(unit: Unit, movementCost: number): void {
    if (unit.movementLeft < movementCost) {
      throw new Error('Not enough movement points');
    }
  }

  private validateDestination(
    unit: Unit,
    unitType: UnitType,
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

    if (targetUnit && unitType.unitClass === 'civilian') {
      throw new Error('Cannot stack civilian units');
    }
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

    const attackerType = UNIT_TYPES[attacker.unitTypeId];
    const defenderType = UNIT_TYPES[defender.unitTypeId];

    // Check if attacker has movement left
    if (attacker.movementLeft <= 0) {
      throw new Error('No movement points remaining');
    }

    // Check if units are in range
    const distance = this.calculateDistance(attacker.x, attacker.y, defender.x, defender.y);

    if (distance > attackerType.range) {
      throw new Error('Target out of range');
    }

    // Simple combat calculation
    const attackerStrength = this.calculateCombatStrength(attacker, attackerType);
    const defenderStrength = this.calculateCombatStrength(defender, defenderType);

    // Calculate damage (simplified formula)
    const damageToDefender = Math.floor(
      (attackerStrength / (attackerStrength + defenderStrength)) * 30 + Math.random() * 20
    );
    const damageToAttacker = Math.floor(
      (defenderStrength / (attackerStrength + defenderStrength)) * 20 + Math.random() * 10
    );

    // Apply damage
    attacker.health -= damageToAttacker;
    defender.health -= damageToDefender;
    attacker.movementLeft = 0; // Attack uses all remaining movement

    // Check for unit destruction
    const attackerDestroyed = attacker.health <= 0;
    const defenderDestroyed = defender.health <= 0;

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
    } else {
      // Both survived - award minimal experience
      attackerExp = this.calculateCombatExperience(attacker, defender, false);
      defenderExp = this.calculateCombatExperience(defender, attacker, false);

      if (attackerExp > 0) {
        await this.awardExperience(attackerId, attackerExp);
      }
      if (defenderExp > 0) {
        await this.awardExperience(defenderId, defenderExp);
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
      // If defender is destroyed and attacker is melee, move to defender's position
      if (!attackerDestroyed && attackerType.range === 1) {
        attacker.x = defender.x;
        attacker.y = defender.y;
        await this.databaseProvider
          .getDatabase()
          .update(units)
          .set({ x: attacker.x, y: attacker.y })
          .where(eq(units.id, attackerId));
      }
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
        orders:
          dbUnit.orders && typeof dbUnit.orders === 'string' && dbUnit.orders.trim()
            ? JSON.parse(dbUnit.orders)
            : [],
      };
      this.units.set(unit.id, unit);
    }

    logger.info(`Loaded ${this.units.size} units for game ${this.gameId}`);
  }

  /**
   * Calculate combat strength with veteran bonuses
   * @reference freeciv/common/combat.c get_total_attack_power()
   * @reference freeciv/common/combat.c defense_multiplication() / EFT_FORTIFY_DEFENSE_BONUS
   */
  private calculateCombatStrength(unit: Unit, unitType: UnitType): number {
    let strength = unitType.combat;

    // Veteran bonus - more sophisticated calculation
    const veteranLevel = this.getVeteranLevel(unit.veteranLevel);
    strength = Math.floor(strength * veteranLevel.powerFactor);

    // @reference reference/freeciv/common/combat.c:697-708
    strength = Math.floor(
      (strength * (100 + this.calculateFortifyDefenseBonus(unit, unitType))) / 100
    );

    strength = Math.floor(
      (strength * (100 + this.calculateCityDefenseBonus(unit, unitType))) / 100
    );

    // Health modifier
    strength = Math.floor(strength * (unit.health / 100));

    return Math.max(1, strength);
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
  private getTerrainAt(x: number, y: number): string {
    if (!this.mapManager) {
      return 'plains'; // Default terrain if no map manager
    }

    try {
      const tile = this.mapManager.getTile(x, y);
      return tile?.terrain || 'plains';
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
    _unit: Unit,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ): number {
    const distance = this.calculateDistance(fromX, fromY, toX, toY);

    // For non-adjacent moves, calculate path cost (simplified)
    if (distance > 1) {
      // For now, treat as straight-line movement with destination terrain cost
      const destinationTerrain = this.getTerrainAt(toX, toY);
      return getTerrainMovementCost(destinationTerrain) * distance;
    }

    // Adjacent move - use destination terrain cost
    const destinationTerrain = this.getTerrainAt(toX, toY);
    const movementCost = getTerrainMovementCost(destinationTerrain);

    // TODO: Add road/railroad bonuses
    // TODO: Add river crossing penalties
    // TODO: Add unit-specific terrain bonuses (e.g., alpine troops in mountains)

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
    targetY?: number
  ): Promise<ActionResult> {
    const unit = this.units.get(unitId);
    if (!unit) {
      return {
        success: false,
        message: `Unit not found: ${unitId}`,
      };
    }

    // Execute action through ActionSystem
    const result = await this.actionSystem.executeAction(unit, actionType, targetX, targetY);

    // Apply result to unit state if successful
    if (result.success) {
      await this.applyActionResult(unit, actionType, result);
    }

    return result;
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

      case ActionType.GOTO:
        updateData = this.handleGoto(unit, result);
        break;

      case ActionType.FOUND_CITY: {
        const destroyed = await this.handleFoundCity(unit, result);
        if (destroyed) return;
        break;
      }

      case ActionType.BUILD_ROAD:
        updateData = this.handleBuildRoad(unit);
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

  private handleBuildRoad(unit: Unit): any {
    unit.movementLeft = 0;
    return { movementPoints: '0' };
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
        await this.processActivityOrder(unit, order);
        break;
      case 'fortify':
        await this.processFortifyOrder(unit, order);
        break;
      case 'sentry':
        await this.processSentryOrder(unit, order);
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
    const activityOrders = ['road', 'railroad', 'irrigate', 'mine', 'transform', 'pillage'];
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

    // Execute the GOTO action
    const result = await this.actionSystem.executeAction(
      unit,
      ActionType.GOTO,
      order.targetX,
      order.targetY
    );

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
  private async handleSuccessfulGoto(unit: Unit, order: any, result: any): Promise<void> {
    await this.applyActionResult(unit, ActionType.GOTO, result);

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
    const result = await this.actionSystem.executeAction(unit, ActionType.GOTO, targetX, targetY);

    if (result.success) {
      await this.applyActionResult(unit, ActionType.GOTO, result);
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
    if (!unit.activity || unit.activity.type === 'idle') {
      const activityType = this.getActivityTypeFromOrder(order.type);
      const turnsRequired = this.getActivityDuration(order.type, unit);

      unit.activity = {
        type: activityType,
        turnsRemaining: turnsRequired,
        totalTurns: turnsRequired,
        target: { x: unit.x, y: unit.y },
      };

      logger.info(`Unit ${unit.id} started ${activityType} activity (${turnsRequired} turns)`);
    }

    // Process turn of activity
    unit.activity.turnsRemaining--;

    if (unit.activity.turnsRemaining <= 0) {
      // Activity completed
      await this.completeActivity(unit, order);
      unit.activity = { type: 'idle', turnsRemaining: 0, totalTurns: 0 };
      this.removeCurrentOrder(unit);
      logger.info(`Unit ${unit.id} completed ${unit.activity.type} activity`);
    }

    // Activities consume all movement
    unit.movementLeft = 0;
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
    };
    return activityMap[orderType] || 'idle';
  }

  /**
   * Get activity duration in turns
   * @reference freeciv ruleset activity times
   */
  private getActivityDuration(orderType: string, unit: Unit): number {
    // Base activity times (in turns)
    const baseTimes: Record<string, number> = {
      road: 3,
      railroad: 3,
      irrigate: 5,
      mine: 5,
      transform: 24, // Very long activity
      pillage: 1,
    };

    let baseTurns = baseTimes[orderType] || 1;

    // Engineer units work twice as fast as workers
    if (unit.unitTypeId === 'engineer') {
      baseTurns = Math.ceil(baseTurns / 2);
    }

    return Math.max(1, baseTurns);
  }

  /**
   * Complete an activity and apply its effects
   */
  private async completeActivity(unit: Unit, order: UnitOrder): Promise<void> {
    // TODO: Integrate with MapManager to apply terrain/improvement changes
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
  canUnloadUnit(unitId: string): boolean {
    const unit = this.units.get(unitId);
    if (!unit || !unit.transportedBy) {
      return false; // Not transported, cannot deboard
    }

    const transport = this.units.get(unit.transportedBy);
    if (!transport) {
      return false; // Transport not found
    }

    // Always can deboard in cities (placeholder logic)
    // TODO: Add proper city detection when CityManager is available
    // if (tile_has_city) return true;

    // For now, allow deboarding on land tiles for ground units
    // This is a simplified version - the original has complex ruleset logic
    const unitType = UNIT_TYPES[unit.unitTypeId];
    const transportType = UNIT_TYPES[transport.unitTypeId];

    if (unitType.unitClass === 'naval' && transportType.unitClass === 'naval') {
      return true; // Naval units can always deboard from naval transports
    }

    if (unitType.unitClass !== 'naval' && transportType.unitClass === 'naval') {
      // Ground/air units need to be on coast or in port
      // TODO: Add proper terrain checking when MapManager is integrated
      return true; // Simplified - allow for now
    }

    return true; // Default allow - will be refined with proper terrain/city checks
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
    // Simplified transport rules - in a full implementation this would check
    // the ruleset's cargo capacity and allowed unit classes

    const transportRules: Record<string, string[]> = {
      trireme: ['warriors', 'archers', 'settlers', 'diplomat'],
      caravel: ['warriors', 'archers', 'settlers', 'diplomat', 'musketeers'],
      galleon: ['warriors', 'archers', 'settlers', 'diplomat', 'musketeers', 'riflemen'],
      transport: [
        'warriors',
        'archers',
        'settlers',
        'diplomat',
        'musketeers',
        'riflemen',
        'cavalry',
        'armor',
      ],
      carrier: ['fighter', 'bomber'],
      submarine: [],
    };

    const allowedCargo = transportRules[transportType] || [];
    return allowedCargo.includes(cargoType);
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

    logger.info(`Unit ${cargoId} loaded onto transport ${transportId}`, {
      transportType: transport.unitTypeId,
      cargoType: cargo.unitTypeId,
      location: { x: transport.x, y: transport.y },
    });

    return true;
  }
}
