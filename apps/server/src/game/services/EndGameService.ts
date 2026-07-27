import { eq } from 'drizzle-orm';
import type { Server as SocketServer } from 'socket.io';
import type { DatabaseProvider } from '@database';
import { games, players } from '@database/schema';
import type { CityManager } from '@game/managers/CityManager';
import type { CultureManager } from '@game/managers/CultureManager';
import type { DiplomacyManager } from '@game/managers/DiplomacyManager';
import type { ResearchManager } from '@game/managers/ResearchManager';
import type { UnitManager } from '@game/managers/UnitManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
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
  reason: 'conquest' | 'culture' | 'world_peace';
  winnerPlayerId: string;
  winnerPlayerIds: string[];
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
  cultureManager?: CultureManager;
  diplomacyManager?: DiplomacyManager;
  rulesetName?: string;
}

/**
 * Authoritative end-game evaluation and report persistence.
 *
 * Conquest, cultural domination, and world-peace victory checks follow the
 * ordering and thresholds used by Freeciv's server. Score keeps CivJS's
 * currently persisted categories deterministic and inspectable.
 *
 * @reference reference/freeciv/server/srv_main.c:530-624
 * @reference reference/freeciv/server/srv_main.c:3906-3943
 */
export class EndGameService {
  constructor(
    private readonly databaseProvider: DatabaseProvider,
    private readonly io: SocketServer
  ) {}

  async evaluate(context: EvaluationContext): Promise<EndGameEvaluation> {
    const enabled = context.victoryConditions.length ? context.victoryConditions : ['conquest'];
    if (context.playerIds.length < 2) return { ended: false };

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
    let reason: EndGameReport['reason'] | undefined;
    let winners: EndGameStanding[] = [];

    if (
      survivors.length > 1 &&
      this.isEnabled(enabled, 'world_peace', 'worldpeace') &&
      context.diplomacyManager
    ) {
      const peaceStart = await this.getWorldPeaceStart(
        context.gameId,
        context.turn,
        survivors,
        context.diplomacyManager
      );
      const requiredTurns = rulesetLoader.loadGameRulesRuleset(context.rulesetName ?? 'classic')
        .world_peace.victory_turns;
      if (peaceStart !== undefined && context.turn - peaceStart >= requiredTurns) {
        reason = 'world_peace';
        winners = survivors;
      }
    }

    if (!reason && enabled.includes('conquest') && survivors.length === 1) {
      reason = 'conquest';
      winners = survivors;
    }

    if (!reason && enabled.includes('culture') && context.cultureManager && survivors.length > 0) {
      const cultureRules = rulesetLoader.getCultureRules(context.rulesetName ?? 'classic');
      const cultureStandings = await Promise.all(
        survivors.map(async standing => ({
          standing,
          culture: (
            await context.cultureManager!.getPlayerCultureInfo(standing.playerId, context.gameId)
          ).totalCulture,
        }))
      );
      cultureStandings.sort(
        (left, right) =>
          right.culture - left.culture ||
          left.standing.playerId.localeCompare(right.standing.playerId)
      );
      const best = cultureStandings[0];
      const second = cultureStandings[1]?.culture ?? -1;
      if (
        best.culture >= cultureRules.victory_min_points &&
        best.culture > (second * (100 + cultureRules.victory_lead_pct)) / 100
      ) {
        reason = 'culture';
        winners = [best.standing];
      }
    }

    if (!reason || winners.length === 0) return { ended: false };

    const endedAt = new Date();
    const winnerPlayerIds = winners.map(winner => winner.playerId);
    const report: EndGameReport = {
      version: 1,
      gameId: context.gameId,
      turn: context.turn,
      year: context.year,
      reason,
      winnerPlayerId: winnerPlayerIds[0],
      winnerPlayerIds,
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

  private isEnabled(enabled: string[], ...aliases: string[]): boolean {
    return aliases.some(alias => enabled.includes(alias));
  }

  /**
   * Returns the first turn of the current uninterrupted world-peace period.
   * Every living player must have diplomatic contact with somebody and no
   * living pair may be at war. The latest relation transition is the earliest
   * turn for which that state can be proven from persisted diplomacy data.
   */
  private async getWorldPeaceStart(
    gameId: string,
    currentTurn: number,
    survivors: EndGameStanding[],
    diplomacyManager: DiplomacyManager
  ): Promise<number | undefined> {
    const alive = new Set(survivors.map(player => player.playerId));
    const snapshots = await Promise.all(
      survivors.map(player => diplomacyManager.getSnapshot(gameId, player.playerId))
    );
    let peaceStart = 0;
    for (const snapshot of snapshots) {
      const livingRelations = snapshot.nations.filter(nation => alive.has(nation.id));
      if (livingRelations.some(nation => nation.relation.state === 'war')) return undefined;
      const contacts = livingRelations.filter(nation => nation.relation.state !== 'no_contact');
      if (contacts.length === 0) return undefined;
      for (const nation of contacts) {
        peaceStart = Math.max(peaceStart, nation.relation.sinceTurn);
      }
    }
    return Math.min(peaceStart, currentTurn);
  }
}
