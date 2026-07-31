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
import { rulesetBuildingsService } from '@game/services/RulesetBuildingsService';
import { calculatePlayerScore } from '@game/services/PlayerScoreService';

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
  spaceshipStateSink?: (playerId: string, state: SpaceshipState) => void;
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

    const standings = context.playerIds.map(playerId =>
      this.buildStanding(context, playerId, playerById)
    );

    await Promise.all(
      standings.map(async standing => {
        await database
          .update(players)
          .set({
            score: standing.score,
            isAlive: standing.alive,
            spaceshipState: standing.spaceship,
          })
          .where(eq(players.id, standing.playerId));
        if (standing.spaceship) {
          context.spaceshipStateSink?.(standing.playerId, standing.spaceship);
        }
      })
    );

    const survivors = standings.filter(standing => standing.alive);
    const result = await this.determineWinners(context, enabled, standings, survivors, playerById);
    const reason = result?.reason;
    const winners = result?.winners ?? [];

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

  private buildStanding(
    context: EvaluationContext,
    playerId: string,
    playerById: Map<string, any>
  ): EndGameStanding {
    const player = playerById.get(playerId);
    const cities = context.cityManager.getPlayerCities(playerId);
    const units = context.unitManager.getPlayerUnits(playerId);
    const population = cities.reduce((total, city) => total + city.size, 0);
    const technologies = context.researchManager.getResearchedTechs(playerId).length;
    const history = player?.history ?? 0;
    const rulesetName = context.rulesetName ?? 'classic';
    const buildingTypes = rulesetBuildingsService.getBuildingTypes(rulesetName);
    const greatWonders = cities.reduce(
      (total, city) =>
        total +
        (city.buildings ?? []).filter(
          buildingId => buildingTypes[buildingId]?.genus === 'GreatWonder'
        ).length,
      0
    );
    const alive = this.isPlayerAlive(player, cities.length, units.length);
    const spaceship = this.getSpaceshipState(
      player?.spaceshipState,
      context.turn,
      player?.isAI === true,
      population
    );
    const score = calculatePlayerScore({
      cities,
      researchedTechs: context.researchManager.getResearchedTechs(playerId),
      history,
      greatWonders,
      unitsBuilt: player?.unitsBuilt ?? 0,
      unitsKilled: player?.unitsKilled ?? 0,
      spaceship,
      currentTurn: context.turn,
    });
    return {
      playerId,
      civilization: player?.civilization ?? playerId,
      score,
      cities: cities.length,
      population,
      units: units.length,
      technologies,
      history,
      alive,
      teamId: player?.teamId ?? undefined,
      categoryScores: {
        population,
        cities: greatWonders * 5,
        units: Math.floor(Math.max(0, player?.unitsBuilt ?? 0) / 10),
        technologies: technologies * 2,
        culture: Math.floor(Math.max(0, history) / 50),
      },
      spaceship,
    };
  }

  private isPlayerAlive(player: any, cityCount: number, unitCount: number): boolean {
    return (
      (player?.isAlive ?? true) &&
      !(player?.hasConceded ?? false) &&
      (cityCount > 0 || unitCount > 0)
    );
  }

  private async determineWinners(
    context: EvaluationContext,
    enabled: string[],
    standings: EndGameStanding[],
    survivors: EndGameStanding[],
    playerById: Map<string, any>
  ): Promise<{ reason: EndGameReport['reason']; winners: EndGameStanding[] } | undefined> {
    const scenario = this.findScenarioWinner(enabled, standings, playerById);
    if (scenario) return scenario;
    const science = this.findScienceWinner(enabled, context.turn, survivors);
    if (science) return science;
    const peace = await this.findWorldPeaceWinner(context, enabled, survivors);
    if (peace) return peace;
    const conquest = this.findConquestWinner(enabled, survivors);
    if (conquest) return conquest;
    const allied = await this.findAlliedWinner(context, enabled, survivors);
    if (allied) return allied;
    const culture = await this.findCultureWinner(context, enabled, survivors);
    if (culture) return culture;
    return this.findMaxTurnWinner(context, standings);
  }

  private findScenarioWinner(
    enabled: string[],
    standings: EndGameStanding[],
    playerById: Map<string, any>
  ) {
    const winners = standings.filter(s => playerById.get(s.playerId)?.isWinner === true);
    return this.isEnabled(enabled, 'scenario') && winners.length > 0
      ? { reason: 'scenario' as const, winners }
      : undefined;
  }

  private findScienceWinner(enabled: string[], turn: number, survivors: EndGameStanding[]) {
    if (!this.isEnabled(enabled, 'science', 'spaceship')) return undefined;
    const arrived = survivors.filter(
      s => s.spaceship?.arrivalTurn !== undefined && s.spaceship.arrivalTurn <= turn
    );
    if (!arrived.length) return undefined;
    const earliest = Math.min(...arrived.map(s => s.spaceship!.arrivalTurn!));
    return {
      reason: 'science' as const,
      winners: arrived.filter(s => s.spaceship!.arrivalTurn === earliest),
    };
  }

  private async findWorldPeaceWinner(
    context: EvaluationContext,
    enabled: string[],
    survivors: EndGameStanding[]
  ) {
    if (
      !this.isEnabled(enabled, 'world_peace', 'worldpeace') ||
      survivors.length <= 1 ||
      !context.diplomacyManager
    )
      return undefined;
    const peaceStart = await this.getWorldPeaceStart(
      context.gameId,
      context.turn,
      survivors,
      context.diplomacyManager
    );
    const required = rulesetLoader.loadGameRulesRuleset(context.rulesetName ?? 'classic')
      .world_peace.victory_turns;
    return peaceStart !== undefined && context.turn - peaceStart >= required
      ? { reason: 'world_peace' as const, winners: survivors }
      : undefined;
  }

  private findConquestWinner(enabled: string[], survivors: EndGameStanding[]) {
    if (!enabled.includes('conquest') || !survivors.length) return undefined;
    const teams = new Set(survivors.map(s => s.teamId || `player:${s.playerId}`));
    return teams.size === 1
      ? {
          reason: (survivors.length > 1 ? 'team' : 'conquest') as EndGameReport['reason'],
          winners: survivors,
        }
      : undefined;
  }

  private async findAlliedWinner(
    context: EvaluationContext,
    enabled: string[],
    survivors: EndGameStanding[]
  ) {
    if (
      !this.isEnabled(enabled, 'allied', 'allied_victory') ||
      survivors.length <= 1 ||
      !context.diplomacyManager
    )
      return undefined;
    const allied = await this.areAllSurvivorsAllied(
      context.gameId,
      survivors,
      context.diplomacyManager
    );
    return allied ? { reason: 'allied' as const, winners: survivors } : undefined;
  }

  private async findCultureWinner(
    context: EvaluationContext,
    enabled: string[],
    survivors: EndGameStanding[]
  ) {
    if (!enabled.includes('culture') || !context.cultureManager || !survivors.length)
      return undefined;
    const rules = rulesetLoader.getCultureRules(context.rulesetName ?? 'classic');
    const scores = await Promise.all(
      survivors.map(async standing => ({
        standing,
        culture: (
          await context.cultureManager!.getPlayerCultureInfo(standing.playerId, context.gameId)
        ).totalCulture,
      }))
    );
    scores.sort(
      (a, b) => b.culture - a.culture || a.standing.playerId.localeCompare(b.standing.playerId)
    );
    const [best, second] = scores;
    return best &&
      best.culture >= rules.victory_min_points &&
      best.culture > ((second?.culture ?? -1) * (100 + rules.victory_lead_pct)) / 100
      ? { reason: 'culture' as const, winners: [best.standing] }
      : undefined;
  }

  private findMaxTurnWinner(context: EvaluationContext, standings: EndGameStanding[]) {
    if (!(context.maxTurns && context.maxTurns > 0 && context.turn >= context.maxTurns))
      return undefined;
    const teamScores = new Map<string, number>();
    for (const standing of standings.filter(candidate => candidate.alive)) {
      const teamKey = standing.teamId ?? `player:${standing.playerId}`;
      teamScores.set(teamKey, (teamScores.get(teamKey) ?? 0) + standing.score);
    }
    const best = Math.max(...teamScores.values());
    const winningTeams = new Set(
      [...teamScores.entries()].filter(([, score]) => score === best).map(([team]) => team)
    );
    return {
      reason: 'max_turns' as const,
      winners: standings.filter(standing =>
        winningTeams.has(standing.teamId ?? `player:${standing.playerId}`)
      ),
    };
  }

  private isEnabled(enabled: string[], ...aliases: string[]): boolean {
    return aliases.some(alias => enabled.includes(alias));
  }

  private getSpaceshipState(
    persisted: unknown,
    turn: number,
    waitForOptimal: boolean,
    population: number
  ): SpaceshipState {
    const state = normalizeSpaceshipState(persisted);
    const launchReady = waitForOptimal ? isSpaceshipOptimal(state) : isSpaceshipComplete(state);
    // Humans launch at the minimum viable ship in the current native flow;
    // default AI follows Freeciv and waits for the best possible ship.
    if (state.launchedTurn === undefined && launchReady) {
      state.launchedTurn = turn;
      state.arrivalTurn = turn + 10;
      if (state.population === undefined) state.population = population;
      if (state.successRate === undefined) state.successRate = 100;
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
