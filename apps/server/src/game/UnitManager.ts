import { db } from '../database';
import { units } from '../database/schema/units';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { getTerrainMovementCost } from './constants/MovementConstants';
import { UNIT_TYPES, getUnitType, UnitType } from './constants/UnitConstants';
import { ActionSystem } from './ActionSystem';
import { ActionType, ActionResult } from '../types/shared/actions';

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

export class UnitManager {
  private units: Map<string, Unit> = new Map();
  private gameId: string;
  private mapWidth: number;
  private mapHeight: number;
  private mapManager: any; // MapManager instance for terrain access
  private actionSystem: ActionSystem;
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
    getCityAt?: (x: number, y: number) => { playerId: string } | null;
  };

  constructor(
    gameId: string,
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
      getCityAt?: (x: number, y: number) => { playerId: string } | null;
    }
  ) {
    this.gameId = gameId;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.mapManager = mapManager;
    this.gameManagerCallback = gameManagerCallback;
    this.actionSystem = new ActionSystem(gameId, gameManagerCallback);
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

    // Calculate movement cost using terrain-based system
    // @reference freeciv/common/movement.c map_move_cost_unit()
    const movementCost = this.calculateTerrainMovementCost(unit, unit.x, unit.y, newX, newY);

    // Check if unit has enough movement
    if (unit.movementLeft < movementCost) {
      throw new Error('Not enough movement points');
    }

    // Check for enemy units at destination
    const targetUnit = this.getUnitAt(newX, newY);
    if (targetUnit && targetUnit.playerId !== unit.playerId) {
      throw new Error('Cannot move to tile occupied by enemy unit');
    }

    // Check for enemy cities at destination
    if (this.gameManagerCallback?.getCityAt) {
      const targetCity = this.gameManagerCallback.getCityAt(newX, newY);
      if (targetCity && targetCity.playerId !== unit.playerId) {
        throw new Error('Cannot move to tile occupied by enemy city');
      }
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
   * @reference freeciv/server/unithand.c unit_restore_movepoints()
   */
  async resetMovement(playerId: string): Promise<void> {
    for (const unit of this.units.values()) {
      if (unit.playerId === playerId) {
        const unitType = UNIT_TYPES[unit.unitTypeId];
        // Restore full movement points in fragments
        unit.movementLeft = unitType.movement;

        // Heal fortified units
        // @reference freeciv/server/unithand.c unit_restore_movepoints() - heal_unit()
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
        movementLeft: Math.min(parseFloat(dbUnit.movementPoints) || 0, unitType.movement),
        health: dbUnit.health,
        veteranLevel: dbUnit.veteranLevel,
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
    await db.delete(units).where(eq(units.id, unitId));
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
        unit.fortified = true;
        unit.movementLeft = 0;
        updateData = { isFortified: true, movementPoints: '0' };
        break;

      case ActionType.SENTRY:
        unit.movementLeft = 0;
        updateData = { movementPoints: '0' };
        break;

      case ActionType.WAIT:
        // Wait preserves movement points
        break;

      case ActionType.GOTO:
        if (result.newPosition) {
          // Move unit and deduct proper movement cost
          unit.x = result.newPosition.x;
          unit.y = result.newPosition.y;
          const movementCost = result.movementCost || 1;
          unit.movementLeft = Math.max(0, unit.movementLeft - movementCost);
          updateData = {
            x: unit.x,
            y: unit.y,
            movementPoints: unit.movementLeft.toString(),
            orders: JSON.stringify(unit.orders || []), // Persist orders to database
          };

          // Broadcast unit movement to all players
          if (this.gameManagerCallback?.broadcastUnitMoved) {
            this.gameManagerCallback.broadcastUnitMoved(
              this.gameId,
              unit.id,
              unit.x,
              unit.y,
              unit.movementLeft
            );
          }
        }
        break;

      case ActionType.FOUND_CITY:
        if (result.unitDestroyed) {
          // Unit would be destroyed when founding city
          await this.destroyUnit(unit.id);
          return;
        }
        break;

      case ActionType.BUILD_ROAD:
        unit.movementLeft = 0;
        updateData = { movementPoints: '0' };
        break;
    }

    // Update database if there are changes
    if (Object.keys(updateData).length > 0) {
      await db.update(units).set(updateData).where(eq(units.id, unit.id));
    }

    logger.info(`Applied action result for unit ${unit.id}`, {
      unitId: unit.id,
      action: actionType,
      result: result.success,
      updateData,
    });
  }

  /**
   * Process pending orders for all units at the start of a turn
   * This handles multi-turn GOTO movements and other queued actions
   */
  async processUnitOrders(playerId: string): Promise<void> {
    for (const unit of this.units.values()) {
      if (
        unit.playerId === playerId &&
        unit.orders &&
        unit.orders.length > 0 &&
        unit.movementLeft > 0
      ) {
        // Process the first order in the queue
        const order = unit.orders[0];

        if (order.type === 'move' && order.targetX !== undefined && order.targetY !== undefined) {
          // Continue GOTO movement
          const result = await this.actionSystem.executeAction(
            unit,
            ActionType.GOTO,
            order.targetX,
            order.targetY
          );

          if (result.success) {
            await this.applyActionResult(unit, ActionType.GOTO, result);

            // Check if destination was reached (this will clear orders automatically in executeGoto)
            if (unit.x === order.targetX && unit.y === order.targetY) {
              logger.info(`Unit ${unit.id} completed GOTO to (${order.targetX}, ${order.targetY})`);
            } else {
              logger.info(
                `Unit ${unit.id} continued GOTO toward (${order.targetX}, ${order.targetY})`
              );
            }
          } else {
            logger.warn(`Failed to process GOTO order for unit ${unit.id}: ${result.message}`);
            // Clear failed orders
            unit.orders = [];
          }
        }
      }
    }
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
