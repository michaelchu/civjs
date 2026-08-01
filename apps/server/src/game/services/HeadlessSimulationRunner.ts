import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { DatabaseProvider } from '@database';
import { games, players } from '@database/schema';
import { PROTOCOL_VERSION } from '@app-types/packet';
import type { GameManager } from '@game/managers/GameManager';
import { GameReplayService, type GameReplay } from './GameReplayService';
import { SimulationExecutionError, SimulationExecutionService } from './SimulationExecutionService';
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
    const manifest = this.createManifest(created.gameId, options.runId, options.config);
    await this.persistManifest(created.gameId, manifest);
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
      gameId: created.gameId,
    });

    let status: SimulationRunBundle['result']['status'] = 'completed';
    let failure: SimulationRunBundle['failure'];
    const aiSummaries: unknown[] = [];
    try {
      await executionService.runToEnd(created.gameId, {
        maxTurns: options.config.maxTurns,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        onTurnCompleted: async () => {
          const replay = await this.readReplay(created.gameId);
          const latest = replay?.turns.filter(turn => turn.endedAt !== null).at(-1);
          if (!latest) return;
          aiSummaries.push({
            turn: latest.turn,
            players: await this.readAISummaries(created.gameId, latest.turn),
          });
          emitProgress({
            schemaVersion: SIMULATION_RUN_SCHEMA_VERSION,
            type: 'turn_completed',
            runId: options.runId,
            gameId: created.gameId,
            turn: latest.turn,
            completedTurns: replay?.turns.filter(turn => turn.endedAt !== null).length,
          });
        },
      });
    } catch (error) {
      if (error instanceof SimulationExecutionError) {
        status =
          error.reason === 'timeout'
            ? 'timed_out'
            : error.reason === 'cancelled'
              ? 'cancelled'
              : 'failed';
        const code =
          error.reason === 'timeout'
            ? 'TIMEOUT'
            : error.reason === 'cancelled'
              ? 'CANCELLED'
              : 'TURN_FAILURE';
        failure = { code, message: error.message };
        await this.pauseFailedRun(created.gameId);
        emitProgress({
          schemaVersion: SIMULATION_RUN_SCHEMA_VERSION,
          type: 'run_failed',
          runId: options.runId,
          gameId: created.gameId,
          code,
          error: error.message,
        });
      } else {
        throw error;
      }
    }

    const replay = await this.readReplay(created.gameId);
    const game = await this.databaseProvider.getDatabase().query.games.findFirst({
      where: eq(games.id, created.gameId),
    });
    const aiPlayers = await this.databaseProvider.getDatabase().query.players.findMany({
      where: eq(players.gameId, created.gameId),
    });
    const completedTurns = replay?.turns.filter(turn => turn.endedAt !== null) ?? [];
    const stateHashes = completedTurns.map(turn => ({
      turn: turn.turn,
      hash: hashState(turn.snapshot),
    }));
    try {
      await this.verifyReplayCheckpoints(created.gameId, completedTurns);
    } catch (error) {
      const alreadyReported = failure !== undefined;
      status = 'failed';
      failure = {
        code: 'TURN_FAILURE',
        message: error instanceof Error ? error.message : String(error),
      };
      await this.pauseFailedRun(created.gameId);
      if (!alreadyReported) {
        emitProgress({
          schemaVersion: SIMULATION_RUN_SCHEMA_VERSION,
          type: 'run_failed',
          runId: options.runId,
          gameId: created.gameId,
          code: failure.code,
          error: failure.message,
        });
      }
    }

    const endReason =
      (game?.endReason as string | null | undefined) ?? failure?.code.toLowerCase() ?? 'completed';
    if (status === 'completed') await this.markCompletedRun(created.gameId);
    const bundle: SimulationRunBundle = {
      schemaVersion: SIMULATION_RUN_SCHEMA_VERSION,
      manifest,
      result: {
        status,
        completedTurns: completedTurns.length,
        endReason,
        standings: game?.endGameReport ?? buildLiveStandings(aiPlayers),
        stateHashes,
      },
      replay,
      aiSummaries,
      diagnostics: {
        schemaVersion: SIMULATION_DIAGNOSTIC_SCHEMA_VERSION,
        progress,
        phases: replay?.turns.flatMap(turn => turn.phases) ?? [],
        events: replay?.turns.flatMap(turn => turn.events) ?? [],
      },
      ...(failure ? { failure } : {}),
    };

    emitProgress({
      schemaVersion: SIMULATION_RUN_SCHEMA_VERSION,
      type: 'run_finished',
      runId: options.runId,
      gameId: created.gameId,
      completedTurns: completedTurns.length,
      endReason,
      status,
    });
    bundle.diagnostics = {
      ...(bundle.diagnostics as Record<string, unknown>),
      progress,
    };
    await this.writeBundle(options.outputDirectory, bundle);
    return { bundle, outputPath: join(options.outputDirectory, 'run.json') };
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
