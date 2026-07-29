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
import {
  isSpaceshipComplete,
  isSpaceshipOptimal,
  normalizeSpaceshipState,
  type SpaceshipState,
} from '@game/services/SpaceshipService';

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
  teamId?: string;
  categoryScores: {
    population: number;
    cities: number;
    units: number;
    technologies: number;
    culture: number;
  };
  spaceship?: SpaceshipState;
}

export interface EndGameReport {
  version: 1;
  gameId: string;
  turn: number;
  year: number;
  reason:
    | 'conquest'
    | 'team'
    | 'allied'
    | 'culture'
    | 'world_peace'
    | 'science'
    | 'scenario'
    | 'max_turns';
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
  maxTurns?: number;
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
        (player?.isAlive ?? true) &&
        !(player?.hasConceded ?? false) &&
        (playerCities.length > 0 || playerUnits.length > 0);
      const spaceship = this.getSpaceshipState(
        player?.spaceshipState,
        context.turn,
        player?.isAI === true
      );
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
        teamId: player?.teamId ?? undefined,
        categoryScores: {
          population: population * 10,
          cities: playerCities.length * 100,
          units: playerUnits.length * 20,
          technologies: technologies * 50,
          culture: history,
        },
        spaceship,
      };
    });

    await Promise.all(
      standings.map(standing =>
        database
          .update(players)
          .set({
            score: standing.score,
            isAlive: standing.alive,
            spaceshipState: standing.spaceship,
          })
          .where(eq(players.id, standing.playerId))
      )
    );

    const survivors = standings.filter(standing => standing.alive);
    let reason: EndGameReport['reason'] | undefined;
    let winners: EndGameStanding[] = [];

    const scenarioWinners = standings.filter(
      standing => playerById.get(standing.playerId)?.isWinner === true
    );
    if (this.isEnabled(enabled, 'scenario') && scenarioWinners.length > 0) {
      reason = 'scenario';
      winners = scenarioWinners;
    }

    if (!reason && this.isEnabled(enabled, 'science', 'spaceship')) {
      const arrived = survivors.filter(
        standing =>
          standing.spaceship?.arrivalTurn !== undefined &&
          standing.spaceship.arrivalTurn <= context.turn
      );
      if (arrived.length > 0) {
        const earliestArrival = Math.min(
          ...arrived.map(standing => standing.spaceship!.arrivalTurn!)
        );
        reason = 'science';
        winners = arrived.filter(standing => standing.spaceship!.arrivalTurn === earliestArrival);
      }
    }

    if (
      !reason &&
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

    if (!reason && enabled.includes('conquest') && survivors.length > 0) {
      const survivingTeams = new Set(
        survivors.map(standing => standing.teamId || `player:${standing.playerId}`)
      );
      if (survivingTeams.size === 1) {
        reason = survivors.length > 1 ? 'team' : 'conquest';
        winners = survivors;
      }
    }

    if (
      !reason &&
      this.isEnabled(enabled, 'allied', 'allied_victory') &&
      survivors.length > 1 &&
      context.diplomacyManager &&
      (await this.areAllSurvivorsAllied(context.gameId, survivors, context.diplomacyManager))
    ) {
      reason = 'allied';
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

    if (!reason && context.maxTurns && context.maxTurns > 0 && context.turn >= context.maxTurns) {
      const bestScore = Math.max(...standings.map(standing => standing.score));
      reason = 'max_turns';
      winners = standings.filter(standing => standing.score === bestScore);
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
    await Promise.all(
      standings.map(standing =>
        database
          .update(players)
          .set({ isWinner: winnerPlayerIds.includes(standing.playerId) })
          .where(eq(players.id, standing.playerId))
      )
    );
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

  private getSpaceshipState(
    persisted: unknown,
    turn: number,
    waitForOptimal: boolean
  ): SpaceshipState {
    const state = normalizeSpaceshipState(persisted);
    const launchReady = waitForOptimal ? isSpaceshipOptimal(state) : isSpaceshipComplete(state);
    // Humans launch at the minimum viable ship in the current native flow;
    // default AI follows Freeciv and waits for the best possible ship.
    if (state.launchedTurn === undefined && launchReady) {
      state.launchedTurn = turn;
      state.arrivalTurn = turn + 10;
    }
    return state;
  }

  private async areAllSurvivorsAllied(
    gameId: string,
    survivors: EndGameStanding[],
    diplomacyManager: DiplomacyManager
  ): Promise<boolean> {
    const snapshots = await Promise.all(
      survivors.map(standing => diplomacyManager.getSnapshot(gameId, standing.playerId))
    );
    return snapshots.every((snapshot, index) =>
      survivors.every((other, otherIndex) => {
        if (index === otherIndex) return true;
        if (survivors[index].teamId && survivors[index].teamId === other.teamId) return true;
        return snapshot.nations.some(
          nation => nation.id === other.playerId && nation.relation.state === 'alliance'
        );
      })
    );
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
