import { and, asc, count, desc, eq, isNotNull, lte } from 'drizzle-orm';
import type { DatabaseProvider } from '@database';
import { gameTurns, games, turnEvents, turnPhases } from '@database/schema';
import { gameStateCodec, type AuthoritativeGameState } from './GameStateCodec';

export interface GameReplayTurn {
  id: string;
  turn: number;
  year: number;
  startedAt: Date;
  endedAt: Date | null;
  actions: unknown;
  statistics: unknown;
  snapshot: unknown;
  phases: unknown[];
  events: unknown[];
}

export interface GameReplay {
  gameId: string;
  status: string;
  endGameReport: unknown;
  turns: GameReplayTurn[];
}

/** Durable replay and post-game inspection read model. */
export class GameReplayService {
  constructor(private readonly databaseProvider: DatabaseProvider) {}

  async getReplay(gameId: string, throughTurn?: number): Promise<GameReplay | null> {
    const database = this.databaseProvider.getDatabase();
    const game = await database.query.games.findFirst({ where: eq(games.id, gameId) });
    if (!game) return null;

    const turnPredicate =
      throughTurn === undefined
        ? eq(gameTurns.gameId, gameId)
        : and(eq(gameTurns.gameId, gameId), lte(gameTurns.turnNumber, throughTurn));
    const turns = await database
      .select()
      .from(gameTurns)
      .where(turnPredicate)
      .orderBy(asc(gameTurns.turnNumber));
    const [phases, events] = await Promise.all([
      database
        .select()
        .from(turnPhases)
        .where(eq(turnPhases.gameId, gameId))
        .orderBy(asc(turnPhases.phaseOrder)),
      database
        .select()
        .from(turnEvents)
        .where(eq(turnEvents.gameId, gameId))
        .orderBy(asc(turnEvents.occurredAt)),
    ]);

    return {
      gameId,
      status: game.status,
      endGameReport: game.endGameReport,
      turns: turns.map(turn => ({
        id: turn.id,
        turn: turn.turnNumber,
        year: turn.year,
        startedAt: turn.startedAt,
        endedAt: turn.endedAt,
        actions: turn.playerActions,
        statistics: turn.statistics,
        snapshot: turn.stateSnapshot,
        phases: phases.filter(phase => phase.turnId === turn.id),
        events: events.filter(event => event.turnId === turn.id),
      })),
    };
  }

  async reconstructAtTurn(gameId: string, turn: number): Promise<AuthoritativeGameState | null> {
    const replay = await this.getReplay(gameId, turn);
    const checkpoint = replay?.turns.find(candidate => candidate.turn === turn);
    if (!checkpoint?.snapshot) return null;
    return this.reconstructCheckpoint(checkpoint);
  }

  async getLatestCompletedTurn(
    gameId: string
  ): Promise<{ turn: number; completedTurns: number } | null> {
    const database = this.databaseProvider.getDatabase();
    const completedPredicate = and(eq(gameTurns.gameId, gameId), isNotNull(gameTurns.endedAt));
    const [latestRows, countRows] = await Promise.all([
      database
        .select({ turn: gameTurns.turnNumber })
        .from(gameTurns)
        .where(completedPredicate)
        .orderBy(desc(gameTurns.turnNumber))
        .limit(1),
      database.select({ completedTurns: count() }).from(gameTurns).where(completedPredicate),
    ]);
    const latest = latestRows[0];
    if (!latest) return null;
    return { turn: latest.turn, completedTurns: countRows[0]?.completedTurns ?? 0 };
  }

  reconstructCheckpoint(checkpoint: GameReplayTurn): AuthoritativeGameState {
    if (!checkpoint.snapshot) {
      throw new Error(`Turn ${checkpoint.turn} does not have a replay checkpoint`);
    }
    if (checkpoint.endedAt === null) {
      throw new Error(`Turn ${checkpoint.turn} has not reached a durable replay checkpoint`);
    }
    const failedPhase = checkpoint.phases.find(
      phase =>
        typeof phase === 'object' &&
        phase !== null &&
        ('status' in phase || 'success' in phase) &&
        ((phase as { status?: unknown }).status !== 'completed' ||
          (phase as { success?: unknown }).success !== true)
    );
    if (failedPhase) {
      throw new Error(`Turn ${checkpoint.turn} contains an incomplete or failed replay phase`);
    }
    const snapshot = gameStateCodec.decode(checkpoint.snapshot);
    if (snapshot.turn !== checkpoint.turn) {
      throw new Error(
        `Replay checkpoint turn mismatch: expected ${checkpoint.turn}, received ${snapshot.turn}`
      );
    }
    return snapshot;
  }
}
