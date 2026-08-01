import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { DatabaseProvider } from '@database';
import { games, players } from '@database/schema';
import { PROTOCOL_VERSION } from '@app-types/packet';
import type { GameManager } from '@game/managers/GameManager';
import { GameReplayService, type GameReplay } from './GameReplayService';
import {
  SimulationExecutionError,
  SimulationExecutionService,
  type SimulationExecutionStopReason,
} from './SimulationExecutionService';
import { SimulationGameService } from './SimulationGameService';
import {
  SIMULATION_DIAGNOSTIC_SCHEMA_VERSION,
  SIMULATION_RUN_SCHEMA_VERSION,
  type HeadlessSimulationConfig,
  type HeadlessSimulationRunOptions,
  type SimulationProgressRecord,
  type SimulationRunBundle,
  type SimulationRunManifest,
} from './SimulationTypes';

export const HEADLESS_EXIT_CODES = {
  completed: 0,
  invalidConfiguration: 2,
  turnFailure: 3,
  timeoutOrCancellation: 4,
  outputFailure: 5,
} as const;

export class HeadlessSimulationError extends Error {
  constructor(
    readonly code: 'TURN_FAILURE' | 'TIMEOUT' | 'CANCELLED',
    message: string
  ) {
    super(message);
    this.name = 'HeadlessSimulationError';
  }
}

export class HeadlessSimulationOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeadlessSimulationOutputError';
  }
}

export interface HeadlessSimulationRunResult {
  bundle: SimulationRunBundle;
  outputPath: string;
}

type RunStatus = SimulationRunBundle['result']['status'];
type RunFailure = NonNullable<SimulationRunBundle['failure']>;

interface ExecutionOutcome {
  status: RunStatus;
  failure?: RunFailure;
  aiSummaries: unknown[];
}

interface FailedExecutionOutcome extends ExecutionOutcome {
  failure: RunFailure;
}

interface RunArtifacts {
  replay: GameReplay | null;
  game?: { endReason: string | null; endGameReport: unknown };
  aiPlayers: Array<{ id: string; civilization: string; score: number; isAlive: boolean }>;
  completedTurns: GameReplay['turns'];
  stateHashes: Array<{ turn: number; hash: string }>;
}

/**
 * Single-flight runner for the authoritative game lifecycle. It deliberately
 * owns no browser, socket, or timer concerns; GameManager supplies the same
 * configured TurnManager used by a live game.
 */
export class HeadlessSimulationRunner {
  private running = false;

  constructor(
    private readonly gameManager: GameManager,
    private readonly databaseProvider: DatabaseProvider
  ) {}

  async run(options: HeadlessSimulationRunOptions): Promise<HeadlessSimulationRunResult> {
    if (this.running) throw new Error('A headless simulation run is already active');
    this.running = true;
    try {
      return await this.runSingle(options);
    } finally {
      this.running = false;
    }
  }

  private async runSingle(
    options: HeadlessSimulationRunOptions
  ): Promise<HeadlessSimulationRunResult> {
    const created = await new SimulationGameService(
      this.gameManager,
      this.databaseProvider
    ).createAndStart(options.config, options.runId);
    try {
      return await this.runCreatedGame(created.gameId, options);
    } catch (error) {
      await this.pauseUnexpectedlyActiveRun(created.gameId, error);
      throw error;
    }
  }

  private async runCreatedGame(
    gameId: string,
    options: HeadlessSimulationRunOptions
  ): Promise<HeadlessSimulationRunResult> {
    const manifest = this.createManifest(gameId, options.runId, options.config);
    await this.persistManifest(gameId, manifest);
    const executionService = new SimulationExecutionService(this.gameManager);

    const progress: SimulationProgressRecord[] = [];
    const emitProgress = (record: SimulationProgressRecord): void => {
      progress.push(record);
      options.onProgress?.(record);
    };
    emitProgress({
      schemaVersion: SIMULATION_RUN_SCHEMA_VERSION,
      type: 'run_started',
      runId: options.runId,
      gameId,
    });
    const initialOutcome = await this.executeGame(gameId, options, executionService, emitProgress);
    const artifacts = await this.readArtifacts(gameId);
    const outcome = await this.verifyExecutionOutcome(
      gameId,
      options.runId,
      artifacts.completedTurns,
      initialOutcome,
      emitProgress
    );
    const endReason = resolveSimulationEndReason(
      outcome.status,
      artifacts.game?.endReason,
      outcome.failure?.code
    );
    await this.markCompletedRunIfNeeded(gameId, outcome.status);
    const bundle = this.buildBundle(manifest, outcome, artifacts, progress, endReason);

    emitProgress({
      schemaVersion: SIMULATION_RUN_SCHEMA_VERSION,
      type: 'run_finished',
      runId: options.runId,
      gameId,
      completedTurns: artifacts.completedTurns.length,
      endReason,
      status: outcome.status,
    });
    bundle.diagnostics = {
      ...(bundle.diagnostics as Record<string, unknown>),
      progress,
    };
    await this.writeBundle(options.outputDirectory, bundle);
    return { bundle, outputPath: join(options.outputDirectory, 'run.json') };
  }

  private async executeGame(
    gameId: string,
    options: HeadlessSimulationRunOptions,
    executionService: SimulationExecutionService,
    emitProgress: (record: SimulationProgressRecord) => void
  ): Promise<ExecutionOutcome> {
    const aiSummaries: unknown[] = [];
    try {
      await executionService.runToEnd(gameId, {
        maxTurns: options.config.maxTurns,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        onTurnCompleted: this.createTurnObserver(gameId, options.runId, aiSummaries, emitProgress),
      });
      return { status: 'completed', aiSummaries };
    } catch (error) {
      const outcome = executionFailureOutcome(error, aiSummaries);
      await this.pauseFailedRun(gameId);
      this.emitFailure(options.runId, gameId, outcome.failure, emitProgress);
      return outcome;
    }
  }

  private createTurnObserver(
    gameId: string,
    runId: string,
    aiSummaries: unknown[],
    emitProgress: (record: SimulationProgressRecord) => void
  ): () => Promise<void> {
    return async () => {
      const replay = await this.readReplay(gameId);
      const completedTurns = getCompletedTurns(replay);
      const latest = completedTurns.at(-1);
      if (!latest) return;
      aiSummaries.push({
        turn: latest.turn,
        players: await this.readAISummaries(gameId, latest.turn),
      });
      emitProgress({
        schemaVersion: SIMULATION_RUN_SCHEMA_VERSION,
        type: 'turn_completed',
        runId,
        gameId,
        turn: latest.turn,
        completedTurns: completedTurns.length,
      });
    };
  }

  private async readArtifacts(gameId: string): Promise<RunArtifacts> {
    const replay = await this.readReplay(gameId);
    const game = await this.databaseProvider.getDatabase().query.games.findFirst({
      where: eq(games.id, gameId),
    });
    const aiPlayers = await this.databaseProvider.getDatabase().query.players.findMany({
      where: eq(players.gameId, gameId),
    });
    const completedTurns = getCompletedTurns(replay);
    return {
      replay,
      game,
      aiPlayers,
      completedTurns,
      stateHashes: completedTurns.map(turn => ({
        turn: turn.turn,
        hash: hashState(turn.snapshot),
      })),
    };
  }

  private async verifyExecutionOutcome(
    gameId: string,
    runId: string,
    completedTurns: GameReplay['turns'],
    outcome: ExecutionOutcome,
    emitProgress: (record: SimulationProgressRecord) => void
  ): Promise<ExecutionOutcome> {
    try {
      await this.verifyReplayCheckpoints(gameId, completedTurns);
      return outcome;
    } catch (error) {
      const failure = { code: 'TURN_FAILURE', message: errorMessage(error) } as const;
      await this.pauseFailedRun(gameId);
      this.emitFailure(runId, gameId, failure, emitProgress);
      return { ...outcome, status: 'failed', failure };
    }
  }

  private emitFailure(
    runId: string,
    gameId: string,
    failure: RunFailure,
    emitProgress: (record: SimulationProgressRecord) => void
  ): void {
    emitProgress({
      schemaVersion: SIMULATION_RUN_SCHEMA_VERSION,
      type: 'run_failed',
      runId,
      gameId,
      code: failure.code,
      error: failure.message,
    });
  }

  private async markCompletedRunIfNeeded(gameId: string, status: RunStatus): Promise<void> {
    if (status === 'completed') await this.markCompletedRun(gameId);
  }

  private buildBundle(
    manifest: SimulationRunManifest,
    outcome: ExecutionOutcome,
    artifacts: RunArtifacts,
    progress: SimulationProgressRecord[],
    endReason: string
  ): SimulationRunBundle {
    return {
      schemaVersion: SIMULATION_RUN_SCHEMA_VERSION,
      manifest,
      result: {
        status: outcome.status,
        completedTurns: artifacts.completedTurns.length,
        endReason,
        standings: artifacts.game?.endGameReport ?? buildLiveStandings(artifacts.aiPlayers),
        stateHashes: artifacts.stateHashes,
      },
      replay: artifacts.replay,
      aiSummaries: outcome.aiSummaries,
      diagnostics: {
        schemaVersion: SIMULATION_DIAGNOSTIC_SCHEMA_VERSION,
        progress,
        phases: artifacts.replay?.turns.flatMap(turn => turn.phases) ?? [],
        events: artifacts.replay?.turns.flatMap(turn => turn.events) ?? [],
      },
      ...(outcome.failure ? { failure: outcome.failure } : {}),
    };
  }

  private async pauseUnexpectedlyActiveRun(gameId: string, originalError: unknown): Promise<void> {
    if (this.gameManager.getGameInstance(gameId)?.state !== 'active') return;
    try {
      await this.pauseFailedRun(gameId);
    } catch (cleanupError) {
      throw new Error(
        `${originalError instanceof Error ? originalError.message : String(originalError)}; failed to pause active simulation: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        { cause: originalError }
      );
    }
  }

  private createManifest(
    gameId: string,
    runId: string,
    config: HeadlessSimulationConfig
  ): SimulationRunManifest {
    return {
      schemaVersion: SIMULATION_RUN_SCHEMA_VERSION,
      runId,
      gameId,
      createdAt: new Date().toISOString(),
      codeVersion: process.env.CIVJS_BUILD_ID || 'development-unknown',
      protocolVersion: PROTOCOL_VERSION,
      diagnosticSchemaVersion: SIMULATION_DIAGNOSTIC_SCHEMA_VERSION,
      rulesetId: config.ruleset,
      mapSeed: config.mapSeed,
      authoritativeRandomSeed: config.randomSeed,
      normalizedConfig: config,
      executionMode: 'headless',
      aiImplementationVersion: 'native-civjs-ai-v1',
      randomizationVersion: 'freeciv-random-v1',
    };
  }

  private async persistManifest(gameId: string, manifest: SimulationRunManifest): Promise<void> {
    await this.databaseProvider
      .getDatabase()
      .update(games)
      .set({
        gameState: sql`coalesce(${games.gameState}, '{}'::jsonb) || ${JSON.stringify({ simulationRunManifest: manifest })}::jsonb`,
      })
      .where(eq(games.id, gameId));
  }

  private async pauseFailedRun(gameId: string): Promise<void> {
    const game = this.gameManager.getGameInstance(gameId);
    game?.turnManager.clearTurnTimer();
    if (game) game.state = 'paused';
    await this.databaseProvider
      .getDatabase()
      .update(games)
      .set({
        status: 'paused',
        gameState: sql`jsonb_set(coalesce(${games.gameState}, '{}'::jsonb), '{simulation,runState}', '"paused"'::jsonb, true)`,
      })
      .where(eq(games.id, gameId));
  }

  private async markCompletedRun(gameId: string): Promise<void> {
    await this.databaseProvider
      .getDatabase()
      .update(games)
      .set({
        gameState: sql`jsonb_set(coalesce(${games.gameState}, '{}'::jsonb), '{simulation,runState}', '"ended"'::jsonb, true)`,
      })
      .where(eq(games.id, gameId));
  }

  private async readReplay(gameId: string): Promise<GameReplay | null> {
    return new GameReplayService(this.databaseProvider).getReplay(gameId);
  }

  private async readAISummaries(gameId: string, turn: number): Promise<unknown[]> {
    const aiPlayers = await this.databaseProvider.getDatabase().query.players.findMany({
      where: eq(players.gameId, gameId),
    });
    return aiPlayers.map(player => ({
      playerId: player.id,
      civilization: player.civilization,
      aiLevel: player.aiLevel,
      decisionTrace: (
        (player.aiState as { recentDecisionTrace?: Array<{ turn?: number }> } | null)
          ?.recentDecisionTrace ?? []
      ).filter(entry => entry.turn === turn),
    }));
  }

  private async verifyReplayCheckpoints(gameId: string, turns: GameReplay['turns']): Promise<void> {
    for (const turn of turns) {
      if (!turn.snapshot || turn.endedAt === null) {
        throw new HeadlessSimulationError(
          'TURN_FAILURE',
          `Turn ${turn.turn} does not have a complete replay checkpoint`
        );
      }
      await this.gameManager.reconstructGameAtTurn(gameId, turn.turn);
    }
  }

  private async writeBundle(outputDirectory: string, bundle: SimulationRunBundle): Promise<void> {
    try {
      await mkdir(outputDirectory, { recursive: true });
      const serialized = `${JSON.stringify(sortKeys(bundle), null, 2)}\n`;
      await writeFile(join(outputDirectory, 'run.json'), serialized, 'utf8');
      await writeFile(
        join(outputDirectory, 'manifest.json'),
        `${JSON.stringify(bundle.manifest, null, 2)}\n`,
        'utf8'
      );
    } catch (error) {
      throw new HeadlessSimulationOutputError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

const EXECUTION_FAILURE_BY_REASON: Record<
  SimulationExecutionStopReason,
  { status: RunStatus; code: RunFailure['code'] }
> = {
  turn_failure: { status: 'failed', code: 'TURN_FAILURE' },
  timeout: { status: 'timed_out', code: 'TIMEOUT' },
  cancelled: { status: 'cancelled', code: 'CANCELLED' },
};

function executionFailureOutcome(error: unknown, aiSummaries: unknown[]): FailedExecutionOutcome {
  if (!(error instanceof SimulationExecutionError)) throw error;
  const classification = EXECUTION_FAILURE_BY_REASON[error.reason];
  return {
    status: classification.status,
    failure: { code: classification.code, message: error.message },
    aiSummaries,
  };
}

function getCompletedTurns(replay: GameReplay | null): GameReplay['turns'] {
  return replay?.turns.filter(turn => turn.endedAt !== null) ?? [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildLiveStandings(
  playersToSummarize: Array<{ id: string; civilization: string; score: number; isAlive: boolean }>
) {
  return playersToSummarize
    .map(player => ({
      playerId: player.id,
      civilization: player.civilization,
      score: player.score,
      alive: player.isAlive,
    }))
    .sort((left, right) => right.score - left.score || left.playerId.localeCompare(right.playerId));
}

function hashState(snapshot: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sortKeys(sanitizeForHash(snapshot))))
    .digest('hex');
}

function sanitizeForHash(value: unknown, key?: string): unknown {
  if (
    key &&
    ['id', 'gameId', 'createdAt', 'startedAt', 'endedAt', 'generatedAt', 'lastSeen'].includes(key)
  ) {
    return undefined;
  }
  if (Array.isArray(value))
    return value.map(item => sanitizeForHash(item)).filter(item => item !== undefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([entryKey, entryValue]) => [entryKey, sanitizeForHash(entryValue, entryKey)] as const)
        .filter(([, entryValue]) => entryValue !== undefined)
    );
  }
  return value;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, sortKeys(entryValue)])
  );
}

export function createRunId(): string {
  return randomUUID();
}

export function resolveSimulationEndReason(
  status: SimulationRunBundle['result']['status'],
  gameEndReason?: string | null,
  failureCode?: 'TURN_FAILURE' | 'TIMEOUT' | 'CANCELLED'
): string {
  if (status !== 'completed' && failureCode) return failureCode.toLowerCase();
  return gameEndReason ?? 'completed';
}
