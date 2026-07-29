import { ActionType } from '@app-types/shared/actions';
import { planFerries, scoreFerryBeachhead } from '@game/ai/FreecivAIFerryPlanner';
import type { AIUnitTask, FreecivAIState } from '@game/ai/FreecivAIStateStore';
import type { GameInstance } from '@game/managers/GameManager';
import type { Unit } from '@game/managers/UnitManager';

/**
 * Executes ferry assignment, rendezvous, embarkation, beachhead search, and
 * unloading through authoritative movement and transport APIs.
 */
export class FreecivAITransportController {
  async manageFerries(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const plan = planFerries({
      friendlyUnits: game.unitManager.getPlayerUnits(playerId),
      existingTasks: state.unitTasks,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      capacityRemaining: ferryId => game.unitManager.getTransportCapacityRemaining(ferryId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
    });
    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (task.role === 'ferry') delete state.unitTasks[unitId];
    }
    for (const assignment of plan) {
      if (state.unitTasks[assignment.ferry.id]?.role === 'ferry') continue;
      state.unitTasks[assignment.ferry.id] = {
        role: 'ferry',
        targetId: assignment.passenger.id,
        targetX: assignment.destinationX,
        targetY: assignment.destinationY,
        assignedTurn: game.currentTurn,
      };
    }

    let actions = 0;
    const movedFerries = new Set<string>();
    for (const assignment of plan) {
      const { ferry, passenger } = assignment;
      if (assignment.phase === 'embarked') {
        if (await game.unitManager.loadUnitOntoTransport(ferry.id, passenger.id)) actions++;
        continue;
      }
      if (assignment.phase === 'rendezvous') {
        if (ferry.x === passenger.x && ferry.y === passenger.y) {
          if (await game.unitManager.loadUnitOntoTransport(ferry.id, passenger.id)) actions++;
          continue;
        }
        const rendezvous = await this.findReachableFerryWaypoint(
          game,
          ferry,
          game.mapManager.getNeighbors(passenger.x, passenger.y)
        );
        if (rendezvous && ferry.movementLeft > 0 && !movedFerries.has(ferry.id)) {
          const result = await game.unitManager.executeUnitAction(
            ferry.id,
            ActionType.GOTO,
            rendezvous.x,
            rendezvous.y,
            playerId
          );
          if (result.success) {
            actions++;
            movedFerries.add(ferry.id);
          }
        }
        // A land unit embarks through the authoritative movement path by
        // entering the adjacent transport's tile.
        if (
          game.mapManager.getDistance(ferry.x, ferry.y, passenger.x, passenger.y) <= 1 &&
          !passenger.transportedBy &&
          passenger.movementLeft > 0
        ) {
          const result = await game.unitManager.executeUnitAction(
            passenger.id,
            ActionType.GOTO,
            ferry.x,
            ferry.y,
            playerId
          );
          if (result.success) actions++;
        }
        continue;
      }
      const landing = await this.findFerryLanding(
        game,
        ferry,
        passenger,
        assignment.destinationX,
        assignment.destinationY,
        assignment.missionRole
      );
      if (!landing) continue;
      if (game.unitManager.canUnloadUnit(passenger.id, landing.landX, landing.landY)) {
        if (await game.unitManager.unloadUnit(passenger.id, landing.landX, landing.landY))
          actions++;
        continue;
      }
      if (ferry.movementLeft > 0 && !movedFerries.has(ferry.id)) {
        const result = await game.unitManager.executeUnitAction(
          ferry.id,
          ActionType.GOTO,
          landing.waterX,
          landing.waterY,
          playerId
        );
        if (result.success) {
          actions++;
          movedFerries.add(ferry.id);
        }
      }
    }
    return actions;
  }

  /**
   * @reference reference/freeciv/ai/default/daiferry.c:dai_gobyboat
   */
  private async findReachableFerryWaypoint(
    game: GameInstance,
    ferry: Unit,
    candidates: Array<{ x: number; y: number }>
  ): Promise<{ x: number; y: number } | null> {
    const reachable: Array<{ x: number; y: number; turns: number; cost: number }> = [];
    for (const candidate of candidates) {
      if (!game.unitManager.canContinuePathFrom(ferry, candidate.x, candidate.y)) continue;
      const path = await game.pathfindingManager.findPath(ferry, candidate.x, candidate.y);
      if (!path.valid) continue;
      reachable.push({
        x: candidate.x,
        y: candidate.y,
        turns: path.estimatedTurns,
        cost: path.totalCost,
      });
    }
    reachable.sort(
      (left, right) =>
        left.turns - right.turns || left.cost - right.cost || left.y - right.y || left.x - right.x
    );
    return reachable[0] ?? null;
  }

  /**
   * Search is map-complete so inland objectives and irregular coastlines do
   * not silently disable ferry missions.
   *
   * @reference reference/freeciv/ai/default/daiferry.c:dai_find_beachhead
   */
  private async findFerryLanding(
    game: GameInstance,
    ferry: Unit,
    passenger: Unit,
    destinationX: number,
    destinationY: number,
    missionRole: AIUnitTask['role']
  ): Promise<{ landX: number; landY: number; waterX: number; waterY: number } | null> {
    const landCandidates: Array<{ x: number; y: number; score: number }> = [];
    const width = game.config.mapWidth ?? 80;
    const height = game.config.mapHeight ?? 50;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (
          !game.mapManager.isValidPosition(x, y) ||
          !game.unitManager.canContinuePathFrom(passenger, x, y)
        ) {
          continue;
        }
        const city = game.cityManager.getCityAt(x, y);
        if (city && city.playerId !== passenger.playerId) continue;
        const enemy = game.unitManager
          .getUnitsAt(x, y)
          .some(candidate => candidate.playerId !== passenger.playerId);
        if (enemy) continue;
        const positions = [{ x, y }, ...game.mapManager.getNeighbors(x, y)];
        const nearbyUnits = positions.flatMap(position =>
          game.unitManager.getUnitsAt(position.x, position.y)
        );
        const enemyThreat = nearbyUnits
          .filter(unit => unit.playerId !== passenger.playerId)
          .reduce((sum, unit) => sum + game.unitManager.calculateUnitAttackRating(unit), 0);
        const friendlySupport = nearbyUnits
          .filter(unit => unit.playerId === passenger.playerId && unit.id !== passenger.id)
          .reduce((sum, unit) => sum + game.unitManager.calculateUnitDefenseRating(unit), 0);
        const landingUnit = { ...passenger, x, y, transportedBy: undefined };
        landCandidates.push({
          x,
          y,
          score: scoreFerryBeachhead({
            missionRole,
            distance: game.mapManager.getDistance(x, y, destinationX, destinationY),
            enemyThreat,
            friendlySupport,
            landingDefense: game.unitManager.calculateUnitDefenseRating(landingUnit),
          }),
        });
      }
    }
    landCandidates.sort(
      (left, right) => left.score - right.score || left.y - right.y || left.x - right.x
    );

    for (const land of landCandidates) {
      const water = await this.findReachableFerryWaypoint(
        game,
        ferry,
        game.mapManager.getNeighbors(land.x, land.y)
      );
      if (water) {
        return {
          landX: land.x,
          landY: land.y,
          waterX: water.x,
          waterY: water.y,
        };
      }
    }
    return null;
  }
}
