import { eq } from 'drizzle-orm';
import type { Server as SocketServer } from 'socket.io';
import type { DatabaseProvider } from '@database';
import { games, players } from '@database/schema';
import type { CityManager } from '@game/managers/CityManager';
import type { ResearchManager } from '@game/managers/ResearchManager';
import type { UnitManager } from '@game/managers/UnitManager';
import { PacketType, PROTOCOL_VERSION } from '@app-types/packet';

export interface EndGameStanding {
  playerId: string;
  civilization: string;
  score: number;
  cities: number;
  population: number;
  units: number;
  technologies: number;
  history: number;
  alive: boolean;
}

export interface EndGameReport {
  version: 1;
  gameId: string;
  turn: number;
  year: number;
  reason: 'conquest';
  winnerPlayerId: string;
  standings: EndGameStanding[];
  endedAt: string;
}

export interface EndGameEvaluation {
  ended: boolean;
  report?: EndGameReport;
}

interface EvaluationContext {
  gameId: string;
  turn: number;
  year: number;
  victoryConditions: string[];
  playerIds: string[];
  cityManager: CityManager;
  unitManager: UnitManager;
  researchManager: ResearchManager;
}

/**
 * Authoritative end-game evaluation and report persistence.
 *
 * The release-supported victory is conquest: after a game has at least two
 * participants, exactly one living civilization may retain cities or units.
 * Score follows Freeciv's category-based approach while keeping CivJS's
 * currently persisted categories deterministic and inspectable.
 */
export class EndGameService {
  constructor(
    private readonly databaseProvider: DatabaseProvider,
    private readonly io: SocketServer
  ) {}

  async evaluate(context: EvaluationContext): Promise<EndGameEvaluation> {
    const enabled = context.victoryConditions.length ? context.victoryConditions : ['conquest'];
    if (!enabled.includes('conquest') || context.playerIds.length < 2) return { ended: false };

    const database = this.databaseProvider.getDatabase();
    const persistedPlayers = await database.query.players.findMany({
      where: eq(players.gameId, context.gameId),
    });
    const playerById = new Map(persistedPlayers.map(player => [player.id, player]));

    const standings = context.playerIds.map(playerId => {
      const player = playerById.get(playerId);
      const playerCities = context.cityManager.getPlayerCities(playerId);
      const playerUnits = context.unitManager.getPlayerUnits(playerId);
      const population = playerCities.reduce((total, city) => total + city.size, 0);
      const technologies = context.researchManager.getResearchedTechs(playerId).length;
      const history = player?.history ?? 0;
      const alive =
        (player?.isAlive ?? true) && (playerCities.length > 0 || playerUnits.length > 0);
      const score =
        population * 10 +
        playerCities.length * 100 +
        playerUnits.length * 20 +
        technologies * 50 +
        history;
      return {
        playerId,
        civilization: player?.civilization ?? playerId,
        score,
        cities: playerCities.length,
        population,
        units: playerUnits.length,
        technologies,
        history,
        alive,
      };
    });

    await Promise.all(
      standings.map(standing =>
        database
          .update(players)
          .set({ score: standing.score, isAlive: standing.alive })
          .where(eq(players.id, standing.playerId))
      )
    );

    const survivors = standings.filter(standing => standing.alive);
    if (survivors.length !== 1) return { ended: false };

    const endedAt = new Date();
    const report: EndGameReport = {
      version: 1,
      gameId: context.gameId,
      turn: context.turn,
      year: context.year,
      reason: 'conquest',
      winnerPlayerId: survivors[0].playerId,
      standings: standings.sort(
        (left, right) => right.score - left.score || left.playerId.localeCompare(right.playerId)
      ),
      endedAt: endedAt.toISOString(),
    };

    await database
      .update(games)
      .set({
        status: 'ended',
        endedAt,
        winnerPlayerId: report.winnerPlayerId,
        endReason: report.reason,
        endGameReport: report,
      })
      .where(eq(games.id, context.gameId));
    this.io.to(`game:${context.gameId}`).emit('packet', {
      version: PROTOCOL_VERSION,
      type: PacketType.ENDGAME_REPORT,
      data: report,
    });
    this.io.to(`game:${context.gameId}`).emit('game-ended', report);
    return { ended: true, report };
  }
}
