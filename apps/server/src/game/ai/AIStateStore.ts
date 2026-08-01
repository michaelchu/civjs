import type { DatabaseProvider } from '@database';
import { players } from '@database/schema';
import { and, eq } from 'drizzle-orm';
import type { ActionType } from '@app-types/shared/actions';

export interface AIDiplomacyMemory {
  love: number;
  warDesire: number;
  countdown: number;
  lastContactTurn?: number;
  warCountdown?: number;
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
    | 'recover'
    | 'retreat'
    | 'ferry'
    | 'diplomat'
    | 'caravan';
  targetId?: string;
  targetX?: number;
  targetY?: number;
  action?: ActionType;
  transportRequired?: boolean;
  assignedTurn: number;
}

export interface AIDecisionTrace {
  turn: number;
  label: string;
  actions: number;
  input?: {
    cities: number;
    units: number;
    tasks: number;
  };
  economicDelta?: {
    population: number;
    food: number;
    production: number;
    trade: number;
    science: number;
  };
  outcome?: AIDecisionOutcome;
  error?: string;
}

export interface AIDecisionOutcome {
  reportedActions: number;
  citiesDelta: number;
  unitsDelta: number;
  tasksDelta: number;
  taskChanges: number;
  unitsMoved: number;
  productionChanges: number;
  researchChanged: boolean;
  noOp: boolean;
}

export interface AIPlanSnapshot {
  turn: number;
  candidateScores: {
    cityProduction: Record<string, Record<string, number>>;
    research: Record<string, number>;
  };
  selectedActions: {
    cityProduction: Record<string, string | null>;
    research: string | null;
  };
  unitTasks: Record<string, AIUnitTask>;
  treasuryGoal?: AITreasuryGoal;
}

export interface FreecivAIState {
  lastProcessedTurn?: number;
  lastDecisionCount?: number;
  inProgressTurn?: number;
  diplomacy: Record<string, AIDiplomacyMemory>;
  unitTasks: Record<string, AIUnitTask>;
  cityWants: Record<string, Record<string, number>>;
  techWants: Record<string, number>;
  treasuryGoal?: AITreasuryGoal;
  recentPlanSnapshot?: AIPlanSnapshot;
  recentDecisionTrace?: AIDecisionTrace[];
}

export interface AITreasuryGoal {
  cityId: string;
  amount: number;
  reason: string;
}

export function createAIState(): FreecivAIState {
  return {
    diplomacy: {},
    unitTasks: {},
    cityWants: {},
    techWants: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertOptionalNumber(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== 'number') {
    throw new Error(`AI state ${field} is invalid`);
  }
}

function assertTraceNumbers(value: unknown, field: string, keys: readonly string[]): void {
  if (!isRecord(value) || keys.some(key => typeof value[key] !== 'number')) {
    throw new Error(`AI state decision trace ${field} is invalid`);
  }
}

function assertCandidateScores(value: unknown): void {
  if (!isRecord(value) || !isRecord(value.cityProduction) || !isRecord(value.research)) {
    throw new Error('AI state decision trace candidate scores are invalid');
  }
  for (const scores of Object.values(value.cityProduction)) {
    if (!isRecord(scores) || Object.values(scores).some(score => typeof score !== 'number')) {
      throw new Error('AI state decision trace city candidate scores are invalid');
    }
  }
  if (Object.values(value.research).some(score => typeof score !== 'number')) {
    throw new Error('AI state decision trace research candidate scores are invalid');
  }
}

function assertSelectedActions(value: unknown): void {
  if (!isRecord(value) || !isRecord(value.cityProduction)) {
    throw new Error('AI state decision trace selected actions are invalid');
  }
  if (
    Object.values(value.cityProduction).some(
      action => action !== null && typeof action !== 'string'
    )
  ) {
    throw new Error('AI state decision trace city selected actions are invalid');
  }
  if (value.research !== null && typeof value.research !== 'string') {
    throw new Error('AI state decision trace selected research action is invalid');
  }
}

function assertDecisionOutcome(value: unknown): void {
  if (!isRecord(value)) throw new Error('AI state decision outcome is invalid');
  const numericFields = [
    'reportedActions',
    'citiesDelta',
    'unitsDelta',
    'tasksDelta',
    'taskChanges',
    'unitsMoved',
    'productionChanges',
  ];
  if (numericFields.some(field => typeof value[field] !== 'number')) {
    throw new Error('AI state decision outcome counts are invalid');
  }
  if (typeof value.researchChanged !== 'boolean' || typeof value.noOp !== 'boolean') {
    throw new Error('AI state decision outcome flags are invalid');
  }
}

function assertPlanSnapshot(value: unknown): void {
  if (!isRecord(value) || typeof value.turn !== 'number') {
    throw new Error('AI state plan snapshot is invalid');
  }
  assertCandidateScores(value.candidateScores);
  assertSelectedActions(value.selectedActions);
  if (!isRecord(value.unitTasks)) throw new Error('AI state plan snapshot tasks are invalid');
  if (value.treasuryGoal !== undefined && !isTreasuryGoal(value.treasuryGoal)) {
    throw new Error('AI state plan snapshot treasury goal is invalid');
  }
}

function isTreasuryGoal(value: unknown): value is AITreasuryGoal {
  if (!isRecord(value)) return false;
  return (
    typeof value.cityId === 'string' &&
    typeof value.amount === 'number' &&
    Number.isFinite(value.amount) &&
    typeof value.reason === 'string'
  );
}

/**
 * Load the native CivJS AI state. This deliberately rejects partial or legacy
 * shapes: CivJS ports Freeciv behavior but does not support old AI-state
 * formats.
 */
export function assertAIState(value: unknown): FreecivAIState {
  if (!isRecord(value)) throw new Error('AI state is missing');
  const state = value as Partial<FreecivAIState>;
  assertAIStateMaps(state);
  assertOptionalNumber(state.lastProcessedTurn, 'lastProcessedTurn');
  assertOptionalNumber(state.lastDecisionCount, 'lastDecisionCount');
  assertOptionalNumber(state.inProgressTurn, 'inProgressTurn');
  if (state.recentPlanSnapshot !== undefined) assertPlanSnapshot(state.recentPlanSnapshot);
  assertDecisionTrace(state.recentDecisionTrace);
  if (state.treasuryGoal !== undefined && !isTreasuryGoal(state.treasuryGoal)) {
    throw new Error('AI state treasuryGoal is invalid');
  }
  return state as FreecivAIState;
}

function assertAIStateMaps(state: Partial<FreecivAIState>): void {
  for (const field of ['diplomacy', 'unitTasks', 'cityWants', 'techWants'] as const) {
    if (!isRecord(state[field])) throw new Error(`AI state field ${field} is invalid`);
  }
}

function assertDecisionTrace(trace: FreecivAIState['recentDecisionTrace']): void {
  if (trace === undefined) return;
  if (!Array.isArray(trace)) throw new Error('AI state decision trace is invalid');
  for (const entry of trace) assertDecisionTraceEntry(entry);
}

function assertDecisionTraceEntry(entry: unknown): void {
  if (
    !isRecord(entry) ||
    typeof entry.turn !== 'number' ||
    typeof entry.label !== 'string' ||
    typeof entry.actions !== 'number' ||
    (entry.error !== undefined && typeof entry.error !== 'string')
  )
    throw new Error('AI state decision trace entry is invalid');
  assertDecisionTraceDetails(entry);
}

function assertDecisionTraceDetails(entry: Record<string, unknown>): void {
  if (entry.input !== undefined)
    assertTraceNumbers(entry.input, 'input', ['cities', 'units', 'tasks']);
  if (entry.economicDelta !== undefined)
    assertTraceNumbers(entry.economicDelta, 'economic delta', [
      'population',
      'food',
      'production',
      'trade',
      'science',
    ]);
  if (entry.outcome !== undefined) assertDecisionOutcome(entry.outcome);
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
