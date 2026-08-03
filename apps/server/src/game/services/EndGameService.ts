/**
 * @module server/game/services/EndGameService
 * Provides the server-side End Game Service service.
 */
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
  normalizeSpaceshipState,
  spaceshipArrival,
  updateSpaceshipArrival,
  type SpaceshipState,
} from '@game/services/SpaceshipService';
import { rulesetBuildingsService } from '@game/services/RulesetBuildingsService';
import { DEFAULT_RULESET } from '@shared/data/rulesets/defaultRuleset';
import {
  calculatePlayerScoreBreakdown,
  calculatePlayerScore,
} from '@game/services/PlayerScoreService';

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
    unitsKilled: number;
    technologies: number;
    culture: number;
    spaceship: number;
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

export interface EndGameConditionTelemetry {
  enabled: boolean;
  met: boolean;
  reason: string;
  winnerPlayerIds: string[];
  progress: Record<string, unknown>;
}

export interface EndGameTelemetry {
  version: 1;
  gameId: string;
  turn: number;
  year: number;
  enabledConditions: string[];
  survivors: number;
  standings: Array<{
    playerId: string;
    civilization: string;
    score: number;
    cities: number;
    population: number;
    units: number;
    technologies: number;
    alive: boolean;
    teamId?: string;
    history: number;
    spaceship?: SpaceshipState;
  }>;
  conditions: Record<string, EndGameConditionTelemetry>;
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
  telemetrySink?: (telemetry: EndGameTelemetry) => void;
}

interface EndGameEvaluationDetails {
  worldPeaceStart?: number;
  worldPeaceRequired?: number;
  allSurvivorsAllied?: boolean;
  cultureScores?: Array<{ playerId: string; culture: number }>;
}

interface WinnerCandidate {
  condition: string;
  result?: { reason: EndGameReport['reason']; winners: EndGameStanding[] };
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
    const details: EndGameEvaluationDetails = {};
    const evaluation = await this.determineWinners(
      context,
      enabled,
      standings,
      survivors,
      playerById,
      details
    );
    context.telemetrySink?.(
      this.buildTelemetry(context, enabled, standings, survivors, evaluation.candidates, details)
    );
    const reason = evaluation.selected?.reason;
    const winners = evaluation.selected?.winners ?? [];

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
    const rulesetName = context.rulesetName ?? DEFAULT_RULESET;
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
    const spaceship = this.getSpaceshipState(player?.spaceshipState, context.year);
    const scoreInputs = {
      cities,
      researchedTechs: context.researchManager.getResearchedTechs(playerId),
      history,
      greatWonders,
      unitsBuilt: player?.unitsBuilt ?? 0,
      unitsKilled: player?.unitsKilled ?? 0,
      spaceship,
      currentTurn: context.turn,
      currentYear: context.year,
    };
    const scoreBreakdown = calculatePlayerScoreBreakdown(scoreInputs);
    const score = calculatePlayerScore(scoreInputs);
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
        population: scoreBreakdown.population,
        cities: scoreBreakdown.wonders,
        units: scoreBreakdown.unitsBuilt,
        unitsKilled: scoreBreakdown.unitsKilled,
        technologies: scoreBreakdown.technologies,
        culture: scoreBreakdown.culture,
        spaceship: scoreBreakdown.spaceship,
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
    playerById: Map<string, any>,
    details: EndGameEvaluationDetails
  ): Promise<{ selected?: WinnerCandidate['result']; candidates: WinnerCandidate[] }> {
    const candidates: WinnerCandidate[] = [];
    candidates.push({
      condition: 'scenario',
      result: this.findScenarioWinner(enabled, standings, playerById),
    });
    candidates.push({
      condition: 'science',
      result: this.findScienceWinner(enabled, context.year, context.turn, standings, survivors),
    });
    candidates.push({
      condition: 'world_peace',
      result: await this.findWorldPeaceWinner(context, enabled, survivors, details),
    });
    candidates.push({
      condition: 'conquest',
      result: this.findConquestWinner(enabled, survivors),
    });
    candidates.push({
      condition: 'allied',
      result: await this.findAlliedWinner(context, enabled, survivors, details),
    });
    candidates.push({
      condition: 'culture',
      result: await this.findCultureWinner(context, enabled, survivors, details),
    });
    candidates.push({
      condition: 'max_turns',
      result: this.findMaxTurnWinner(context, standings),
    });
    return { selected: candidates.find(candidate => candidate.result)?.result, candidates };
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

  private findScienceWinner(
    enabled: string[],
    year: number,
    turn: number,
    standings: EndGameStanding[],
    survivors: EndGameStanding[]
  ) {
    if (!this.isEnabled(enabled, 'science', 'spaceship')) return undefined;
    const arrived = survivors.filter(standing =>
      this.hasSpaceshipArrived(standing.spaceship, year, turn)
    );
    if (!arrived.length) return undefined;
    const ranked = arrived
      .map(standing => ({
        standing,
        arrival: this.getSpaceshipArrival(standing.spaceship, turn),
      }))
      .sort(
        (left, right) =>
          left.arrival - right.arrival ||
          left.standing.playerId.localeCompare(right.standing.playerId)
      );
    const firstArrival = ranked[0]?.standing;
    if (!firstArrival) return undefined;
    const winners = firstArrival.teamId
      ? standings.filter(standing => standing.teamId === firstArrival.teamId)
      : [firstArrival];
    return {
      reason: 'science' as const,
      winners,
    };
  }

  private async findWorldPeaceWinner(
    context: EvaluationContext,
    enabled: string[],
    survivors: EndGameStanding[],
    details: EndGameEvaluationDetails
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
    const required = rulesetLoader.loadGameRulesRuleset(context.rulesetName ?? DEFAULT_RULESET)
      .world_peace.victory_turns;
    details.worldPeaceStart = peaceStart;
    details.worldPeaceRequired = required;
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
    survivors: EndGameStanding[],
    details: EndGameEvaluationDetails
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
    details.allSurvivorsAllied = allied;
    return allied ? { reason: 'allied' as const, winners: survivors } : undefined;
  }

  private async findCultureWinner(
    context: EvaluationContext,
    enabled: string[],
    survivors: EndGameStanding[],
    details: EndGameEvaluationDetails
  ) {
    if (!enabled.includes('culture') || !context.cultureManager || !survivors.length)
      return undefined;
    const rules = rulesetLoader.getCultureRules(context.rulesetName ?? DEFAULT_RULESET);
    const scores = await Promise.all(
      survivors.map(async standing => ({
        standing,
        culture: (
          await context.cultureManager!.getPlayerCultureInfo(standing.playerId, context.gameId)
        ).totalCulture,
      }))
    );
    details.cultureScores = scores.map(({ standing, culture }) => ({
      playerId: standing.playerId,
      culture,
    }));
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

  private buildTelemetry(
    context: EvaluationContext,
    enabled: string[],
    standings: EndGameStanding[],
    survivors: EndGameStanding[],
    candidates: WinnerCandidate[],
    details: EndGameEvaluationDetails
  ): EndGameTelemetry {
    const candidate = (condition: string) =>
      candidates.find(entry => entry.condition === condition)?.result;
    const enabledFor = (...aliases: string[]) => this.isEnabled(enabled, ...aliases);
    const condition = (
      name: string,
      aliases: string[],
      reason: string,
      progress: Record<string, unknown>
    ): EndGameConditionTelemetry => {
      const selected = candidate(name);
      const isEnabled = enabledFor(...aliases);
      const met = isEnabled && (selected?.winners.length ?? 0) > 0;
      return {
        enabled: isEnabled,
        met,
        reason: !isEnabled ? 'disabled' : met ? 'met' : reason,
        winnerPlayerIds: selected?.winners.map(winner => winner.playerId) ?? [],
        progress,
      };
    };

    const cultureRules = rulesetLoader.getCultureRules(context.rulesetName ?? DEFAULT_RULESET);
    const cultureScores = details.cultureScores ?? [];
    const survivingTeams = [
      ...new Set(survivors.map(standing => standing.teamId ?? `player:${standing.playerId}`)),
    ].sort();
    const peaceElapsed =
      details.worldPeaceStart === undefined
        ? 0
        : Math.max(0, context.turn - details.worldPeaceStart);

    return {
      version: 1,
      gameId: context.gameId,
      turn: context.turn,
      year: context.year,
      enabledConditions: [...enabled],
      survivors: survivors.length,
      standings: standings.map(standing => ({
        playerId: standing.playerId,
        civilization: standing.civilization,
        score: standing.score,
        cities: standing.cities,
        population: standing.population,
        units: standing.units,
        technologies: standing.technologies,
        alive: standing.alive,
        ...(standing.teamId ? { teamId: standing.teamId } : {}),
        history: standing.history,
        ...(standing.spaceship ? { spaceship: standing.spaceship } : {}),
      })),
      conditions: {
        scenario: condition('scenario', ['scenario'], 'no_scenario_winner', {
          flaggedWinnerIds: candidate('scenario')?.winners.map(winner => winner.playerId) ?? [],
        }),
        science: condition('science', ['science', 'spaceship'], 'no_arrived_spaceship', {
          players: standings.map(standing => ({
            playerId: standing.playerId,
            status: standing.spaceship?.status,
            launchYear: standing.spaceship?.launchYear,
            arrivalYear: standing.spaceship?.arrivalYear,
            launchedTurn: standing.spaceship?.launchedTurn,
            arrivalTurn: standing.spaceship?.arrivalTurn,
            arrived: this.hasSpaceshipArrived(standing.spaceship, context.year, context.turn),
          })),
        }),
        world_peace: condition(
          'world_peace',
          ['world_peace', 'worldpeace'],
          context.diplomacyManager
            ? 'no_uninterrupted_peace_period'
            : 'diplomacy_manager_unavailable',
          {
            peaceStartTurn: details.worldPeaceStart,
            requiredTurns: details.worldPeaceRequired,
            elapsedTurns: peaceElapsed,
          }
        ),
        conquest: condition(
          'conquest',
          ['conquest'],
          survivors.length === 0 ? 'no_surviving_players' : 'multiple_surviving_teams',
          { survivingTeams, survivors: survivors.map(standing => standing.playerId) }
        ),
        allied: condition(
          'allied',
          ['allied', 'allied_victory'],
          context.diplomacyManager ? 'not_all_survivors_allied' : 'diplomacy_manager_unavailable',
          {
            allSurvivorsAllied: details.allSurvivorsAllied ?? false,
            survivors: survivors.map(standing => standing.playerId),
          }
        ),
        culture: condition(
          'culture',
          ['culture'],
          context.cultureManager ? 'below_threshold_or_lead' : 'culture_manager_unavailable',
          {
            minimumPoints: cultureRules.victory_min_points,
            leadPercent: cultureRules.victory_lead_pct,
            players: cultureScores,
          }
        ),
        max_turns: condition('max_turns', ['max_turns'], 'turn_limit_not_reached', {
          currentTurn: context.turn,
          maxTurns: context.maxTurns ?? null,
        }),
      },
    };
  }

  /**
   * End-game evaluation observes an already-launched ship; it never launches
   * one. Native Freeciv requires a player launch request, while its default AI
   * launches a fully-built ship during AI management.
   *
   * @reference reference/freeciv/server/spacerace.c:167-201
   * @reference reference/freeciv/ai/default/daihand.c:98-110
   */
  private getSpaceshipState(persisted: unknown, year: number): SpaceshipState {
    const state = normalizeSpaceshipState(persisted);
    // Saves created before the year-based model have only a turn arrival and
    // their persisted derived values. Keep those intact while callers migrate
    // them; new ships always use the source-aligned year fields.
    if (state.arrivalYear === undefined && state.arrivalTurn !== undefined) return state;
    return updateSpaceshipArrival(state, year);
  }

  private hasSpaceshipArrived(
    spaceship: SpaceshipState | undefined,
    year: number,
    turn: number
  ): boolean {
    return (
      spaceship?.status === 'arrived' ||
      (spaceship?.arrivalYear !== undefined && spaceship.arrivalYear <= year) ||
      (spaceship?.arrivalYear === undefined &&
        spaceship?.arrivalTurn !== undefined &&
        spaceship.arrivalTurn <= turn)
    );
  }

  private getSpaceshipArrival(spaceship: SpaceshipState | undefined, turn: number): number {
    if (!spaceship) return Number.POSITIVE_INFINITY;
    return spaceshipArrival(spaceship) ?? spaceship.arrivalTurn ?? turn;
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
