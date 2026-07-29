import type { DatabaseProvider } from '@database';
import { players } from '@database/schema';
import { and, eq } from 'drizzle-orm';

export interface AIDiplomacyMemory {
  love: number;
  warDesire: number;
  countdown: number;
  lastContactTurn?: number;
}

export interface AIUnitTask {
  role:
    | 'attack'
    | 'defend'
    | 'guard'
    | 'hunter'
    | 'air'
    | 'paradrop'
    | 'settle'
    | 'worker'
    | 'explore'
    | 'ferry'
    | 'diplomat';
  targetId?: string;
  targetX?: number;
  targetY?: number;
  assignedTurn: number;
}

export interface FreecivAIState {
  version: 1;
  lastProcessedTurn?: number;
  lastDecisionCount?: number;
  diplomacy: Record<string, AIDiplomacyMemory>;
  unitTasks: Record<string, AIUnitTask>;
  cityWants: Record<string, Record<string, number>>;
  techWants: Record<string, number>;
}

export function normalizeAIState(value: unknown): FreecivAIState {
  const state = value && typeof value === 'object' ? (value as Partial<FreecivAIState>) : {};
  return {
    version: 1,
    lastProcessedTurn:
      typeof state.lastProcessedTurn === 'number' ? state.lastProcessedTurn : undefined,
    lastDecisionCount:
      typeof state.lastDecisionCount === 'number' ? state.lastDecisionCount : undefined,
    diplomacy: state.diplomacy && typeof state.diplomacy === 'object' ? state.diplomacy : {},
    unitTasks: state.unitTasks && typeof state.unitTasks === 'object' ? state.unitTasks : {},
    cityWants: state.cityWants && typeof state.cityWants === 'object' ? state.cityWants : {},
    techWants: state.techWants && typeof state.techWants === 'object' ? state.techWants : {},
  };
}

/**
 * Persists the AI's cross-turn assignments and relationship memory in the
 * owning player row, matching Freeciv's player/city/unit AI save callbacks.
 *
 * @reference reference/freeciv/ai/default/daiplayer.c
 * @reference reference/freeciv/ai/default/daicity.c:dai_city_save
 * @reference reference/freeciv/ai/default/daiunit.c:dai_unit_save
 */
export class FreecivAIStateStore {
  private readonly persistenceQueues = new Map<string, Promise<void>>();

  constructor(private readonly databaseProvider?: DatabaseProvider) {}

  async save(gameId: string, playerId: string, state: FreecivAIState): Promise<void> {
    if (!this.databaseProvider) return;
    const key = `${gameId}:${playerId}`;
    const snapshot = structuredClone(state);
    const previous = this.persistenceQueues.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await this.databaseProvider!.getDatabase()
          .update(players)
          .set({ aiState: snapshot })
          .where(and(eq(players.gameId, gameId), eq(players.id, playerId)));
      });
    this.persistenceQueues.set(key, next);
    try {
      await next;
    } finally {
      if (this.persistenceQueues.get(key) === next) this.persistenceQueues.delete(key);
    }
  }
}
