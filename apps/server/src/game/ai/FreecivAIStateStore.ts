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
  lastProcessedTurn?: number;
  lastDecisionCount?: number;
  diplomacy: Record<string, AIDiplomacyMemory>;
  unitTasks: Record<string, AIUnitTask>;
  cityWants: Record<string, Record<string, number>>;
  techWants: Record<string, number>;
}

export function createAIState(): FreecivAIState {
  return {
    diplomacy: {},
    unitTasks: {},
    cityWants: {},
    techWants: {},
  };
}

/**
 * Load the native CivJS AI state. This deliberately rejects partial or legacy
 * shapes: CivJS ports Freeciv behavior but does not support old AI-state
 * formats.
 */
export function assertAIState(value: unknown): FreecivAIState {
  if (!value || typeof value !== 'object') throw new Error('AI state is missing');
  const state = value as Partial<FreecivAIState>;
  for (const field of ['diplomacy', 'unitTasks', 'cityWants', 'techWants'] as const) {
    if (!state[field] || typeof state[field] !== 'object' || Array.isArray(state[field])) {
      throw new Error(`AI state field ${field} is invalid`);
    }
  }
  if (state.lastProcessedTurn !== undefined && typeof state.lastProcessedTurn !== 'number') {
    throw new Error('AI state lastProcessedTurn is invalid');
  }
  if (state.lastDecisionCount !== undefined && typeof state.lastDecisionCount !== 'number') {
    throw new Error('AI state lastDecisionCount is invalid');
  }
  return state as FreecivAIState;
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
