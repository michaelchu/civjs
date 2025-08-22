import { db } from '../database';
import { units } from '../database/schema/units';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';

export interface UnitType {
  id: string;
  name: string;
  cost: number;
  movement: number;
  combat: number;
  range: number;
  sight: number;
  canFoundCity: boolean;
  canBuildImprovements: boolean;
  unitClass: 'military' | 'civilian' | 'naval' | 'air';
  requiredTech?: string;
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
  fortified: boolean;
  orders?: UnitOrder[];
}

export interface UnitOrder {
  type: 'move' | 'attack' | 'fortify' | 'foundCity' | 'buildImprovement';
  targetX?: number;
  targetY?: number;
  targetId?: string;
  improvementType?: string;
}

export interface CombatResult {
  attackerId: string;
  defenderId: string;
  attackerDamage: number;
  defenderDamage: number;
  attackerDestroyed: boolean;
  defenderDestroyed: boolean;
}

// Unit type definitions - these would normally be in a data file
export const UNIT_TYPES: Record<string, UnitType> = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    cost: 40,
    movement: 2,
    combat: 20,
    range: 1,
    sight: 2,
    canFoundCity: false,
    canBuildImprovements: false,
    unitClass: 'military',
  },
  settler: {
    id: 'settler',
    name: 'Settler',
    cost: 80,
    movement: 2,
    combat: 0,
    range: 0,
    sight: 2,
    canFoundCity: true,
    canBuildImprovements: false,
    unitClass: 'civilian',
  },
  scout: {
    id: 'scout',
    name: 'Scout',
    cost: 25,
    movement: 3,
    combat: 10,
    range: 1,
    sight: 3,
    canFoundCity: false,
    canBuildImprovements: false,
    unitClass: 'military',
  },
  worker: {
    id: 'worker',
    name: 'Worker',
    cost: 50,
    movement: 2,
    combat: 0,
    range: 0,
    sight: 2,
    canFoundCity: false,
    canBuildImprovements: true,
    unitClass: 'civilian',
  },
  archer: {
    id: 'archer',
    name: 'Archer',
    cost: 50,
    movement: 2,
    combat: 15,
    range: 2,
    sight: 2,
    canFoundCity: false,
    canBuildImprovements: false,
    unitClass: 'military',
    requiredTech: 'archery',
  },
  spearman: {
    id: 'spearman',
    name: 'Spearman',
    cost: 45,
    movement: 2,
    combat: 25,
    range: 1,
    sight: 2,
    canFoundCity: false,
    canBuildImprovements: false,
    unitClass: 'military',
    requiredTech: 'bronzeWorking',
  },
};

export class UnitManager {
  private units: Map<string, Unit> = new Map();
  private gameId: string;
  private mapWidth: number;
  private mapHeight: number;

  constructor(gameId: string, mapWidth: number, mapHeight: number) {
    this.gameId = gameId;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
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

    // Save to database and get the generated ID
    const [dbUnit] = await db
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
        movementPoints: unitType.movement.toString(),
        maxMovementPoints: unitType.movement.toString(),
        veteranLevel: 0,
        createdTurn: 1, // TODO: get current turn
      })
      .returning();

    const unit: Unit = {
      id: dbUnit.id,
      gameId: this.gameId,
      playerId,
      unitTypeId,
      x,
      y,
      movementLeft: unitType.movement,
      health: 100,
      veteranLevel: 0,
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

    // Check if position is valid
    if (!this.isValidPosition(newX, newY)) {
      throw new Error(`Invalid position: ${newX}, ${newY}`);
    }

    // Calculate movement cost
    const distance = this.calculateDistance(unit.x, unit.y, newX, newY);
    const movementCost = Math.ceil(distance); // Simplified - would consider terrain

    // Check if unit has enough movement
    if (unit.movementLeft < movementCost) {
      throw new Error('Not enough movement points');
    }

    // Check for enemy units at destination
    const targetUnit = this.getUnitAt(newX, newY);
    if (targetUnit && targetUnit.playerId !== unit.playerId) {
      throw new Error('Cannot move to tile occupied by enemy unit');
    }

    // Check stacking rules
    if (targetUnit && unitType.unitClass === 'civilian') {
      throw new Error('Cannot stack civilian units');
    }

    // Update unit position
    unit.x = newX;
    unit.y = newY;
    unit.movementLeft -= movementCost;
    unit.fortified = false; // Moving breaks fortification

    // Update database
    await db
      .update(units)
      .set({
        x: unit.x,
        y: unit.y,
        movementPoints: unit.movementLeft.toString(),
      })
      .where(eq(units.id, unitId));

    logger.info(`Unit ${unitId} moved to (${newX}, ${newY})`);
    return true;
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

    // Handle unit destruction
    if (attackerDestroyed) {
      await this.destroyUnit(attackerId);
    } else {
      await db
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
        await db
          .update(units)
          .set({ x: attacker.x, y: attacker.y })
          .where(eq(units.id, attackerId));
      }
    } else {
      await db.update(units).set({ health: defender.health }).where(eq(units.id, defenderId));
    }

    const result: CombatResult = {
      attackerId,
      defenderId,
      attackerDamage: damageToAttacker,
      defenderDamage: damageToDefender,
      attackerDestroyed,
      defenderDestroyed,
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

    await db
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

    await db.update(units).set({ health: unit.health }).where(eq(units.id, unitId));
  }

  /**
   * Reset movement for all units (called at turn start)
   */
  async resetMovement(playerId: string): Promise<void> {
    for (const unit of this.units.values()) {
      if (unit.playerId === playerId) {
        const unitType = UNIT_TYPES[unit.unitTypeId];
        unit.movementLeft = unitType.movement;

        // Heal fortified units
        if (unit.fortified && unit.health < 100) {
          unit.health = Math.min(100, unit.health + 10);
        }
      }
    }

    // Update database for all player units
    for (const unit of this.units.values()) {
      if (unit.playerId === playerId) {
        const unitType = UNIT_TYPES[unit.unitTypeId];
        await db
          .update(units)
          .set({
            movementPoints: unitType.movement.toString(),
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
    const dbUnits = await db.select().from(units).where(eq(units.gameId, this.gameId));

    for (const dbUnit of dbUnits) {
      const unit: Unit = {
        id: dbUnit.id,
        gameId: dbUnit.gameId,
        playerId: dbUnit.playerId,
        unitTypeId: dbUnit.unitType,
        x: dbUnit.x,
        y: dbUnit.y,
        movementLeft: parseFloat(dbUnit.movementPoints),
        health: dbUnit.health,
        veteranLevel: dbUnit.veteranLevel,
        fortified: dbUnit.isFortified,
      };
      this.units.set(unit.id, unit);
    }

    logger.info(`Loaded ${this.units.size} units for game ${this.gameId}`);
  }

  /**
   * Calculate combat strength
   */
  private calculateCombatStrength(unit: Unit, unitType: UnitType): number {
    let strength = unitType.combat;

    // Veteran bonus
    strength += unit.veteranLevel * 5;

    // Fortification bonus
    if (unit.fortified) {
      strength *= 1.5;
    }

    // Health modifier
    strength *= unit.health / 100;

    return strength;
  }

  /**
   * Calculate distance between two points
   */
  private calculateDistance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
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
    await db.delete(units).where(eq(units.id, unitId));
    logger.info(`Unit ${unitId} destroyed`);
  }

  /**
   * Get unit by ID
   */
  getUnit(unitId: string): Unit | undefined {
    return this.units.get(unitId);
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
}
