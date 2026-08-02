import type { EventTurnContext, GameEventData, UnitMovementAggregate } from './GameEventTypes';

interface TurnMovementBucket {
  context: EventTurnContext;
  players: Map<string, Map<string, UnitMovementAggregate>>;
}

export interface UnitMovementSummary {
  context: EventTurnContext;
  data: Partial<GameEventData>;
}

/** Coalesces noisy movement telemetry without losing its originating turn. */
export class UnitMovementAccumulator {
  private readonly buckets = new Map<string, TurnMovementBucket>();

  get pendingCount(): number {
    let count = 0;
    for (const bucket of this.buckets.values()) {
      for (const units of bucket.players.values()) count += units.size;
    }
    return count;
  }

  record(
    event: {
      unit: { id: string; playerId: string; unitTypeId: string; x: number; y: number };
      previousX?: number;
      previousY?: number;
    },
    context: EventTurnContext
  ): void {
    const bucket = this.getBucket(context);
    let playerMovements = bucket.players.get(event.unit.playerId);
    if (!playerMovements) {
      playerMovements = new Map();
      bucket.players.set(event.unit.playerId, playerMovements);
    }

    const existing = playerMovements.get(event.unit.id);
    if (existing) {
      existing.moveCount += 1;
      existing.toX = event.unit.x;
      existing.toY = event.unit.y;
      return;
    }

    playerMovements.set(event.unit.id, {
      unitId: event.unit.id,
      unitTypeId: event.unit.unitTypeId,
      moveCount: 1,
      fromX: event.previousX ?? event.unit.x,
      fromY: event.previousY ?? event.unit.y,
      toX: event.unit.x,
      toY: event.unit.y,
    });
  }

  drain(): UnitMovementSummary[] {
    const summaries: UnitMovementSummary[] = [];
    for (const bucket of this.buckets.values()) {
      for (const [playerId, units] of bucket.players) {
        const unitMoves = [...units.values()].sort((left, right) =>
          left.unitId.localeCompare(right.unitId)
        );
        summaries.push({
          context: bucket.context,
          data: {
            playerId,
            moveCount: unitMoves.reduce((total, unit) => total + unit.moveCount, 0),
            unitCount: unitMoves.length,
            unitMoves,
          },
        });
      }
    }
    this.buckets.clear();
    return summaries;
  }

  private getBucket(context: EventTurnContext): TurnMovementBucket {
    const key = `${context.turnId ?? 'unassigned'}:${context.turn}:${context.year}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { context: { ...context }, players: new Map() };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }
}
