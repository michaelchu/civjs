import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { DatabaseProvider } from '@database';
import { games, players, users } from '@database/schema';
import type { GameManager } from '@game/managers/GameManager';
import {
  SIMULATION_DIAGNOSTIC_SCHEMA_VERSION,
  type HeadlessSimulationConfig,
  type SimulationExecutionMode,
} from '../config/SimulationTypes';

export interface CreatedSimulationGame {
  gameId: string;
  hostId: string;
  runId: string;
}

/**
 * Application-level simulation creation. Both the future live runner and the
 * headless runner use this boundary so AI-only setup cannot drift into a
 * second game-construction path.
 */
export class SimulationGameService {
  constructor(
    private readonly gameManager: GameManager,
    private readonly databaseProvider: DatabaseProvider
  ) {}

  async createAndStart(
    config: HeadlessSimulationConfig,
    runId: string,
    executionMode: SimulationExecutionMode = 'headless'
  ): Promise<CreatedSimulationGame> {
    const hostId = randomUUID();
    let gameId: string | undefined;

    try {
      await this.createSyntheticHost(hostId, runId);
      gameId = await this.createSimulationGame(config, hostId, executionMode);
      await this.persistSimulationState(gameId, config, runId, executionMode);
      await this.createAIPlayers(gameId, config.aiPlayerCount);
      await this.gameManager.startHeadlessGame(gameId, hostId);
      return { gameId, hostId, runId };
    } catch (error) {
      await this.cleanupFailedSetup(gameId, hostId, error);
      throw error;
    }
  }

  private async createSyntheticHost(hostId: string, runId: string): Promise<void> {
    await this.databaseProvider
      .getDatabase()
      .insert(users)
      .values({
        id: hostId,
        username: `headless_${runId.slice(0, 12)}`,
        email: `${hostId}@headless.invalid`,
        isGuest: true,
      });
  }

  private createSimulationGame(
    config: HeadlessSimulationConfig,
    hostId: string,
    executionMode: SimulationExecutionMode
  ): Promise<string> {
    return this.gameManager.createGame({
      name: config.name,
      hostId,
      gameType: 'single',
      maxPlayers: config.aiPlayerCount,
      mapWidth: config.mapWidth,
      mapHeight: config.mapHeight,
      mapSeed: config.mapSeed,
      ruleset: config.ruleset,
      turnTimeLimit: config.turnTimeLimit,
      maxTurns: config.maxTurns,
      victoryConditions: config.victoryConditions,
      aiLevel: config.aiLevel,
      randomSeed: config.randomSeed,
      terrainSettings: config.terrainSettings,
      scenarioSetup: config.scenarioSetup,
      executionMode,
    });
  }

  private async persistSimulationState(
    gameId: string,
    config: HeadlessSimulationConfig,
    runId: string,
    executionMode: SimulationExecutionMode
  ): Promise<void> {
    const simulation = {
      enabled: true,
      aiPlayerCount: config.aiPlayerCount,
      speed: 'fast',
      runState: 'running',
      maxTurns: config.maxTurns,
      victoryConditions: config.victoryConditions,
      spectatorVisibility: 'omniscient',
      strategy: {
        provider: 'native',
        reviewIntervalTurns: 0,
        eventDrivenReviews: false,
      },
      diagnostics: {
        level: 'standard',
        schemaVersion: SIMULATION_DIAGNOSTIC_SCHEMA_VERSION,
      },
      runId,
      executionMode,
    };
    await this.databaseProvider
      .getDatabase()
      .update(games)
      .set({
        gameState: sql`coalesce(${games.gameState}, '{}'::jsonb) || ${JSON.stringify({ simulation })}::jsonb`,
      })
      .where(eq(games.id, gameId));
  }

  private async createAIPlayers(gameId: string, expectedCount: number): Promise<void> {
    await this.gameManager.ensureMinimumPlayers(gameId, expectedCount);
    const createdPlayers = await this.databaseProvider.getDatabase().query.players.findMany({
      where: eq(players.gameId, gameId),
    });
    const hasOnlyAIPlayers = createdPlayers.every(player => player.isAI && player.userId === null);
    if (createdPlayers.length === expectedCount && hasOnlyAIPlayers) return;
    throw new Error(
      `Simulation setup created ${createdPlayers.length} players; expected ${expectedCount} AI players`
    );
  }

  private async cleanupFailedSetup(
    gameId: string | undefined,
    hostId: string,
    originalError: unknown
  ): Promise<void> {
    const cleanupErrors: string[] = [];
    await this.tryDeleteGame(gameId, hostId, cleanupErrors);
    await this.tryDeleteHost(hostId, cleanupErrors);
    if (cleanupErrors.length === 0) return;
    throw new Error(
      `${errorMessage(originalError)}; simulation setup cleanup failed: ${cleanupErrors.join('; ')}`,
      { cause: originalError }
    );
  }

  private async tryDeleteGame(
    gameId: string | undefined,
    hostId: string,
    cleanupErrors: string[]
  ): Promise<void> {
    if (!gameId) return;
    try {
      await this.gameManager.deleteGame(gameId, hostId);
    } catch (error) {
      cleanupErrors.push(errorMessage(error));
    }
  }

  private async tryDeleteHost(hostId: string, cleanupErrors: string[]): Promise<void> {
    try {
      await this.databaseProvider.getDatabase().delete(users).where(eq(users.id, hostId));
    } catch (error) {
      cleanupErrors.push(errorMessage(error));
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
