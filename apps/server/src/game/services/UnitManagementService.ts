import { GameInstance } from '@game/managers/GameManager';
import { BaseGameService } from '@game/orchestrators/GameService';
import { logger } from '@utils/logger';
import type { Unit } from '@game/managers/UnitManager';

interface UnitBroadcaster {
  broadcastUnitInfo(gameId: string, unit: Unit): void;
  broadcastUnitDestroyed(gameId: string, unit: Unit): void;
}

/**
 * UnitManagementService - Extracted unit operations from GameManager
 * @reference docs/refactor/REFACTORING_PLAN.md - Phase 1 GameManager refactoring
 *
 * Handles all unit-related operations including:
 * - Unit creation, movement, combat, and fortification
 * - Unit validation and ownership checks
 * - Unit visibility updates
 * - Unit broadcasting coordination
 */
export class UnitManagementService extends BaseGameService {
  constructor(
    private games: Map<string, GameInstance>,
    private readonly unitBroadcaster?: UnitBroadcaster
  ) {
    super(logger);
  }

  getServiceName(): string {
    return 'UnitManagementService';
  }

  /**
   * Create a new unit for a player
   * @reference Original GameManager.createUnit()
   */
  public async createUnit(
    gameId: string,
    playerId: string,
    unitType: string,
    x: number,
    y: number
  ): Promise<string> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    if (gameInstance.state !== 'active') {
      throw new Error('Cannot create units unless game is active');
    }

    const player = gameInstance.players.get(playerId);
    if (!player) {
      throw new Error('Player not found in game');
    }

    const unit = await gameInstance.unitManager.createUnit(playerId, unitType, x, y);

    // Update visibility for the player
    gameInstance.visibilityManager.onUnitCreated(playerId);

    this.unitBroadcaster?.broadcastUnitInfo(gameId, unit);

    return unit.id;
  }

  /**
   * Move a unit to a new position
   * @reference Original GameManager.moveUnit()
   */
  public async moveUnit(
    gameId: string,
    playerId: string,
    unitId: string,
    x: number,
    y: number
  ): Promise<boolean> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    if (gameInstance.state !== 'active') {
      throw new Error('Cannot move units unless game is active');
    }

    // Verify unit belongs to player
    const unit = gameInstance.unitManager.getUnit(unitId);
    if (!unit || unit.playerId !== playerId) {
      throw new Error('Unit not found or does not belong to player');
    }

    const unitBeforeMove = { ...unit };
    const moved = await gameInstance.unitManager.moveUnit(unitId, x, y);

    if (moved) {
      const updatedUnit = gameInstance.unitManager.getUnit(unitId);

      // Update visibility for the player
      if (updatedUnit) {
        gameInstance.visibilityManager.onUnitMoved(playerId);
        this.unitBroadcaster?.broadcastUnitInfo(gameId, updatedUnit);
      } else {
        gameInstance.visibilityManager.onUnitDestroyed(playerId);
        this.unitBroadcaster?.broadcastUnitDestroyed(gameId, unitBeforeMove);
      }
    }

    return moved;
  }

  /**
   * Attack another unit
   * @reference Original GameManager.attackUnit()
   */
  public async attackUnit(
    gameId: string,
    playerId: string,
    attackerUnitId: string,
    defenderUnitId: string
  ) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    if (gameInstance.state !== 'active') {
      throw new Error('Cannot attack unless game is active');
    }

    // Verify attacking unit belongs to player
    const attackerUnit = gameInstance.unitManager.getUnit(attackerUnitId);
    if (!attackerUnit || attackerUnit.playerId !== playerId) {
      throw new Error('Attacking unit not found or does not belong to player');
    }

    const attackerSnapshot = gameInstance.unitManager.getUnit(attackerUnitId);
    const requestedDefenderSnapshot = gameInstance.unitManager.getUnit(defenderUnitId);
    const defenderStackSnapshots = requestedDefenderSnapshot
      ? gameInstance.unitManager
          .getUnitsAt(requestedDefenderSnapshot.x, requestedDefenderSnapshot.y)
          .filter(unit => unit.playerId !== playerId)
          .map(unit => ({ ...unit }))
      : [];
    const combatResult = await gameInstance.unitManager.attackUnit(attackerUnitId, defenderUnitId);
    const defenderSnapshot = defenderStackSnapshots.find(
      unit => unit.id === combatResult.defenderId
    );

    // Update visibility for relevant players if units were destroyed
    if (combatResult.attackerDestroyed) {
      if (attackerSnapshot) {
        this.unitBroadcaster?.broadcastUnitDestroyed(gameId, attackerSnapshot);
      }
      gameInstance.visibilityManager.onUnitDestroyed(playerId);
    }
    if (combatResult.defenderDestroyed) {
      for (const destroyedUnit of defenderStackSnapshots.filter(
        unit =>
          unit.id === combatResult.defenderId ||
          combatResult.collateralDestroyedIds?.includes(unit.id)
      )) {
        this.unitBroadcaster?.broadcastUnitDestroyed(gameId, destroyedUnit);
      }
      if (defenderSnapshot) {
        gameInstance.visibilityManager.onUnitDestroyed(defenderSnapshot.playerId);
      }
    }

    const survivingAttacker = gameInstance.unitManager.getUnit(attackerUnitId);
    const survivingDefender = gameInstance.unitManager.getUnit(combatResult.defenderId);
    if (survivingAttacker) this.unitBroadcaster?.broadcastUnitInfo(gameId, survivingAttacker);
    if (survivingDefender) this.unitBroadcaster?.broadcastUnitInfo(gameId, survivingDefender);

    return combatResult;
  }

  /**
   * Fortify a unit for defensive bonus
   * @reference Original GameManager.fortifyUnit()
   */
  public async fortifyUnit(gameId: string, playerId: string, unitId: string): Promise<void> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    // Verify unit belongs to player
    const unit = gameInstance.unitManager.getUnit(unitId);
    if (!unit || unit.playerId !== playerId) {
      throw new Error('Unit not found or does not belong to player');
    }

    await gameInstance.unitManager.fortifyUnit(unitId);

    const fortifiedUnit = gameInstance.unitManager.getUnit(unitId);
    if (fortifiedUnit) this.unitBroadcaster?.broadcastUnitInfo(gameId, fortifiedUnit);
  }

  /**
   * Get all units owned by a player
   * @reference Original GameManager.getPlayerUnits()
   */
  public getPlayerUnits(gameId: string, playerId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    return gameInstance.unitManager.getPlayerUnits(playerId);
  }

  /**
   * Get units visible to a player
   * @reference Original GameManager.getVisibleUnits()
   */
  public getVisibleUnits(gameId: string, playerId: string, visibleTiles?: Set<string>) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    // Use visibility manager if no visibleTiles provided
    const tiles = visibleTiles || gameInstance.visibilityManager.getVisibleTiles(playerId);
    return gameInstance.unitManager.getVisibleUnits(
      playerId,
      tiles,
      gameInstance.visibilityManager.getDetectionTiles(playerId)
    );
  }
}
