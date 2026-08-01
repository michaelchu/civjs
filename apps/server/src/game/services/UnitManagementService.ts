import { GameInstance } from '@game/managers/GameManager';
import { BaseGameService } from '@game/orchestrators/GameService';
import { logger } from '@utils/logger';
import type { Unit } from '@game/managers/UnitManager';
import type { CombatPresentationEvent } from '@app-types/presentation';

const PRE_GUNPOWDER_COMBAT_UNITS = new Set([
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
  'well-digger',
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

interface UnitBroadcaster {
  broadcastUnitInfo(gameId: string, unit: Unit): void;
  broadcastUnitDestroyed(gameId: string, unit: Unit): void;
  broadcastCombatOccurred?: (gameId: string, event: CombatPresentationEvent) => void;
}

/**
 * UnitManagementService - Extracted unit operations from GameManager
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

    const moved = await gameInstance.unitManager.moveUnit(unitId, x, y);

    if (moved) {
      const updatedUnit = gameInstance.unitManager.getUnit(unitId);

      // Update visibility for the player
      if (updatedUnit) {
        gameInstance.visibilityManager.onUnitMoved(playerId);
        this.unitBroadcaster?.broadcastUnitInfo(gameId, updatedUnit);
      } else {
        gameInstance.visibilityManager.onUnitDestroyed(playerId);
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

    const defenderStackSnapshots = this.captureDefenderStack(
      gameInstance,
      defenderUnitId,
      playerId
    );
    const attackerSnapshot = { ...attackerUnit };
    const defenderSnapshot = gameInstance.unitManager.getUnit(defenderUnitId);
    const combatResult = await gameInstance.unitManager.attackUnit(attackerUnitId, defenderUnitId);
    const defenderBefore =
      defenderStackSnapshots.find(unit => unit.id === combatResult.defenderId) ??
      (defenderSnapshot ? { ...defenderSnapshot } : undefined);
    if (defenderBefore && !gameInstance.unitManager.hasCombatPresentationCallback?.()) {
      const survivingAttacker = gameInstance.unitManager.getUnit(attackerUnitId);
      const survivingDefender = gameInstance.unitManager.getUnit(combatResult.defenderId);
      const winner = combatResult.attackerDestroyed ? defenderBefore : attackerSnapshot;
      const combatEvent: CombatPresentationEvent = {
        eventId: `combat:${gameId}:${Date.now()}:${attackerUnitId}:${combatResult.defenderId}`,
        x: defenderBefore.x,
        y: defenderBefore.y,
        style: this.getCombatPresentationStyle(gameInstance, winner),
        playerIds: [attackerSnapshot.playerId, defenderBefore.playerId],
        attackerDamage: combatResult.attackerDamage,
        defenderDamage: combatResult.defenderDamage,
        attackerDestroyed: combatResult.attackerDestroyed,
        defenderDestroyed: combatResult.defenderDestroyed,
        combatants: [
          this.toCombatPresentationCombatant(
            attackerSnapshot,
            'attacker',
            combatResult.attackerDestroyed ? 0 : (survivingAttacker?.health ?? 0),
            combatResult.attackerDestroyed
          ),
          this.toCombatPresentationCombatant(
            defenderBefore,
            'defender',
            combatResult.defenderDestroyed ? 0 : (survivingDefender?.health ?? 0),
            combatResult.defenderDestroyed
          ),
        ],
      };
      this.unitBroadcaster?.broadcastCombatOccurred?.(gameId, {
        ...combatEvent,
      });
    }
    this.broadcastCombatResult(
      gameInstance,
      gameId,
      playerId,
      attackerUnitId,
      combatResult,
      defenderStackSnapshots
    );

    return combatResult;
  }

  private toCombatPresentationCombatant(
    unit: any,
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

  private getCombatPresentationStyle(gameInstance: any, winner: any): 'swords' | 'explosion' {
    const unitType = gameInstance.unitManager.getUnitType?.(winner.unitTypeId);
    const identifiers = [winner.unitTypeId, unitType?.name]
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.toLowerCase());
    return identifiers.some(identifier => PRE_GUNPOWDER_COMBAT_UNITS.has(identifier))
      ? 'swords'
      : 'explosion';
  }

  private captureDefenderStack(gameInstance: any, defenderUnitId: string, playerId: string): any[] {
    const defender = gameInstance.unitManager.getUnit(defenderUnitId);
    return defender
      ? gameInstance.unitManager
          .getUnitsAt(defender.x, defender.y)
          .filter((unit: any) => unit.playerId !== playerId)
          .map((unit: any) => ({ ...unit }))
      : [];
  }

  private broadcastCombatResult(
    gameInstance: any,
    gameId: string,
    playerId: string,
    attackerUnitId: string,
    result: any,
    defenderStack: any[]
  ): void {
    if (result.attackerDestroyed) gameInstance.visibilityManager.onUnitDestroyed(playerId);
    const defender = defenderStack.find(unit => unit.id === result.defenderId);
    if (result.defenderDestroyed && defender)
      gameInstance.visibilityManager.onUnitDestroyed(defender.playerId);
    const survivingAttacker = gameInstance.unitManager.getUnit(attackerUnitId);
    const survivingDefender = gameInstance.unitManager.getUnit(result.defenderId);
    if (survivingAttacker) this.unitBroadcaster?.broadcastUnitInfo(gameId, survivingAttacker);
    if (survivingDefender) this.unitBroadcaster?.broadcastUnitInfo(gameId, survivingDefender);
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
