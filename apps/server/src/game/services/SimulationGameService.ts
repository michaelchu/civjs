import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { DatabaseProvider } from '@database';
import { games, players, users } from '@database/schema';
import type { GameManager } from '@game/managers/GameManager';
import {
  SIMULATION_DIAGNOSTIC_SCHEMA_VERSION,
  type HeadlessSimulationConfig,
  type SimulationExecutionMode,
} from './SimulationTypes';

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
    const database = this.databaseProvider.getDatabase();
    const hostId = randomUUID();

    await database.insert(users).values({
      id: hostId,
      username: `headless_${runId.slice(0, 12)}`,
      email: `${hostId}@headless.invalid`,
      isGuest: true,
    });

    const gameId = await this.gameManager.createGame({
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
    });

    const simulationState = {
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
    await database
      .update(games)
      .set({
        gameState: sql`coalesce(${games.gameState}, '{}'::jsonb) || ${JSON.stringify({ simulation: simulationState })}::jsonb`,
      })
      .where(eq(games.id, gameId));

    await this.gameManager.ensureMinimumPlayers(gameId, config.aiPlayerCount);
    const createdPlayers = await database.query.players.findMany({
      where: eq(players.gameId, gameId),
    });
    if (
      createdPlayers.length !== config.aiPlayerCount ||
      createdPlayers.some(player => !player.isAI || player.userId !== null)
    ) {
      throw new Error(
        `Simulation setup created ${createdPlayers.length} players; expected ${config.aiPlayerCount} AI players`
      );
    }

    await this.gameManager.startHeadlessGame(gameId, hostId);
    return { gameId, hostId, runId };
  }
}
