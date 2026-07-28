import { and, asc, eq, lte } from 'drizzle-orm';
import type { DatabaseProvider } from '@database';
import { gameTurns, games, turnEvents, turnPhases } from '@database/schema';

export interface GameReplay {
  gameId: string;
  status: string;
  endGameReport: unknown;
  turns: Array<{
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
  }>;
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

  async reconstructAtTurn(gameId: string, turn: number): Promise<unknown | null> {
    const replay = await this.getReplay(gameId, turn);
    const checkpoint = replay?.turns.at(-1);
    if (!checkpoint?.snapshot) return null;
    const snapshot = checkpoint.snapshot as { version?: number };
    if (snapshot.version !== 2) {
      throw new Error(`Unsupported replay snapshot version: ${snapshot.version ?? 'missing'}`);
    }
    return checkpoint.snapshot;
  }
}
