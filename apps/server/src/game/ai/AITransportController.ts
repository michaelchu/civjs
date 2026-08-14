/**
 * @module server/game/ai/AITransportController
 * Implements AITransport Controller decision logic for AI-controlled players.
 */
import { ActionType } from '@app-types/shared/actions';
import { planFerries, scoreFerryBeachhead, type FerryAssignment } from '@game/ai/AIFerryPlanner';
import type { AIUnitTask, FreecivAIState } from '@game/ai/AIStateStore';
import type { GameInstance } from '@game/runtime/GameTypes';
import type { Unit } from '@game/units/UnitTypes';

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
      actions += await this.executeFerryAssignment(game, playerId, assignment, movedFerries);
    }
    return actions;
  }

  private async executeFerryAssignment(
    game: GameInstance,
    playerId: string,
    assignment: FerryAssignment,
    movedFerries: Set<string>
  ): Promise<number> {
    if (assignment.phase === 'embarked') {
      return Number(
        await game.unitManager.loadUnitOntoTransport(assignment.ferry.id, assignment.passenger.id)
      );
    }
    return assignment.phase === 'rendezvous'
      ? this.executeFerryRendezvous(game, playerId, assignment, movedFerries)
      : this.executeFerryDelivery(game, playerId, assignment, movedFerries);
  }

  private async executeFerryRendezvous(
    game: GameInstance,
    playerId: string,
    assignment: FerryAssignment,
    movedFerries: Set<string>
  ): Promise<number> {
    const { ferry, passenger } = assignment;
    if (ferry.x === passenger.x && ferry.y === passenger.y) {
      return Number(await game.unitManager.loadUnitOntoTransport(ferry.id, passenger.id));
    }
    let actions = 0;
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
    const passengerCanEmbark =
      game.mapManager.getDistance(ferry.x, ferry.y, passenger.x, passenger.y) <= 1 &&
      !passenger.transportedBy &&
      passenger.movementLeft > 0;
    if (passengerCanEmbark) {
      const result = await game.unitManager.executeUnitAction(
        passenger.id,
        ActionType.GOTO,
        ferry.x,
        ferry.y,
        playerId
      );
      actions += Number(result.success);
    }
    return actions;
  }

  private async executeFerryDelivery(
    game: GameInstance,
    playerId: string,
    assignment: FerryAssignment,
    movedFerries: Set<string>
  ): Promise<number> {
    const { ferry, passenger } = assignment;
    const landing = await this.findFerryLanding(
      game,
      ferry,
      passenger,
      assignment.destinationX,
      assignment.destinationY,
      assignment.missionRole
    );
    if (!landing) return 0;
    if (game.unitManager.canUnloadUnit(passenger.id, landing.landX, landing.landY)) {
      return Number(await game.unitManager.unloadUnit(passenger.id, landing.landX, landing.landY));
    }
    if (ferry.movementLeft <= 0 || movedFerries.has(ferry.id)) return 0;
    const result = await game.unitManager.executeUnitAction(
      ferry.id,
      ActionType.GOTO,
      landing.waterX,
      landing.waterY,
      playerId
    );
    if (result.success) movedFerries.add(ferry.id);
    return Number(result.success);
  }

  /**
   * @reference reference/freeciv/ai/default/daiferry.c:dai_gobyboat
   */
  private async findReachableFerryWaypoint(
    game: GameInstance,
    ferry: Unit,
    candidates: Array<{ x: number; y: number }>
  ): Promise<{ x: number; y: number } | null> {
    const eligible = candidates.filter(candidate =>
      game.unitManager.canContinuePathFrom(ferry, candidate.x, candidate.y)
    );
    const routeMap =
      typeof game.pathfindingManager.findPathCosts === 'function'
        ? await game.pathfindingManager.findPathCosts(ferry, eligible)
        : typeof game.pathfindingManager.findPaths === 'function'
          ? await game.pathfindingManager.findPaths(ferry, eligible)
          : undefined;
    const reachable: Array<{ x: number; y: number; turns: number; cost: number }> = [];
    for (const candidate of eligible) {
      const path =
        routeMap?.get(`${candidate.x},${candidate.y}`) ??
        (await game.pathfindingManager.findPath(ferry, candidate.x, candidate.y));
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
