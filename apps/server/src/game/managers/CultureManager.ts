/**
 * @module server/game/managers/CultureManager
 * Culture Manager - Implements Freeciv culture system
 *
 * Direct port of freeciv/common/culture.c and culture.h
 * Handles city and player culture accumulation, history gain,
 * and integration with the effects system.
 *
 * Reference files:
 * - /reference/freeciv/common/culture.c
 * - /reference/freeciv/common/culture.h
 * - /reference/freeciv/gen_headers/enums/effects_enums.def (lines 123-126, 167)
 */

import { logger } from '@utils/logger';
import { DatabaseProvider } from '@database';
import {
  cities,
  players,
  games,
  type City as DatabaseCity,
  type Player as DatabasePlayer,
  type Game,
} from '@database/schema';
import { eq } from 'drizzle-orm';
import { EffectsManager, EffectType, type EffectContext } from './EffectsManager';
import { DEFAULT_RULESET } from '@shared/data/rulesets/defaultRuleset';

// Type definitions for culture calculations
export type CityWithBuildings = Omit<
  DatabaseCity,
  | 'buildings'
  | 'airliftUsedTurn'
  | 'disorderTurns'
  | 'rallyPoint'
  | 'didSellTurn'
  | 'didBuyTurn'
  | 'espionageThefts'
  // These optional runtime fields are absent from pre-illness saves and from
  // focused culture fixtures.  Culture calculations do not consume them.
  | 'illness'
  | 'illnessTrade'
  | 'turnPlague'
> & {
  buildings: string[]; // Building IDs in the city
  airliftUsedTurn?: number | null;
  illness?: number;
  illnessTrade?: number;
  turnPlague?: number | null;
};

export interface PlayerWithTechs extends DatabasePlayer {
  technologies: string[]; // Technology IDs researched by player
}

export interface CultureCalculationResult {
  culture: number;
  historyGain: number;
  breakdown: {
    baseHistory: number;
    performance: number;
    culturePct: number;
    interestGain: number;
  };
}

export interface PlayerCultureResult {
  totalCulture: number;
  nationalHistory: number;
  nationalHistoryGain: number;
  cityCulture: number;
  breakdown: {
    nationalPerformance: number;
    nationalHistory: number;
    nationalCulturePct: number;
    totalCityCulture: number;
  };
}

export interface CultureProcessingResult {
  cities: Record<string, { history: number; culture: number }>;
  players: Record<string, { history: number; totalCulture: number }>;
}

interface RuntimeCultureState {
  getCity?: (cityId: string) => RuntimeCultureCity | undefined;
  getPlayer?: (playerId: string) => { history?: number } | undefined;
  getCities?: (playerId: string) => RuntimeCultureCity[];
  getPlayerTechs?: (playerId: string) => Set<string>;
}

interface RuntimeCultureCity {
  id?: string;
  playerId?: string;
  x?: number;
  y?: number;
  history: number;
  buildings?: string[];
}

/** Match C integer division, which truncates every term toward zero. */
function scaleCultureEffect(value: number, percentage: number): number {
  return Math.trunc((value * (100 + percentage)) / 100);
}

/**
 * CultureManager - Direct port of Freeciv culture system
 *
 * Implements the four core functions from freeciv/common/culture.c:
 * - city_culture() - Calculate current city culture score
 * - city_history_gain() - Calculate city history gain per turn
 * - player_culture() - Calculate total player culture score
 * - nation_history_gain() - Calculate national history gain per turn
 */
export class CultureManager {
  private databaseProvider: DatabaseProvider;
  private effectsManager: EffectsManager;
  private runtimeState: RuntimeCultureState = {};

  constructor(databaseProvider: DatabaseProvider, rulesetName: string = DEFAULT_RULESET) {
    this.databaseProvider = databaseProvider;
    this.effectsManager = new EffectsManager(rulesetName);
  }

  public setRuntimeState(runtimeState: RuntimeCultureState): void {
    this.runtimeState = runtimeState;
  }

  /**
   * Synchronous culture lookup for effect calculations that must remain
   * synchronous (notably unit bribe-cost planning).
   *
   * @reference reference/freeciv/common/culture.c:29-60
   */
  public getRuntimeCityCulture(cityId: string): number | undefined {
    const city = this.runtimeState.getCity?.(cityId);
    if (
      !city ||
      city.id === undefined ||
      city.playerId === undefined ||
      city.x === undefined ||
      city.y === undefined
    ) {
      return undefined;
    }
    return this.calculateRuntimeCityCulture(
      city,
      this.runtimeState.getPlayerTechs?.(city.playerId) ?? new Set()
    );
  }

  public getRuntimePlayerCulture(playerId: string): number | undefined {
    const player = this.runtimeState.getPlayer?.(playerId);
    const cities = this.runtimeState.getCities?.(playerId);
    if (!player || !cities) return undefined;

    const playerTechs = this.runtimeState.getPlayerTechs?.(playerId) ?? new Set<string>();
    const nationalPerformance = this.effectsManager.calculateEffect(EffectType.NATION_PERFORMANCE, {
      playerId,
      playerTechs,
    }).value;
    const culturePct = this.effectsManager.calculateEffect(EffectType.CULTURE_PCT, {
      playerId,
      playerTechs,
    }).value;
    const totalCityCulture = cities.reduce(
      (sum, city) =>
        sum +
        (city.id !== undefined &&
        city.playerId !== undefined &&
        city.x !== undefined &&
        city.y !== undefined
          ? this.calculateRuntimeCityCulture(city, playerTechs)
          : 0),
      0
    );

    return (
      (player.history ?? 0) + scaleCultureEffect(nationalPerformance, culturePct) + totalCityCulture
    );
  }

  private calculateRuntimeCityCulture(city: RuntimeCultureCity, playerTechs: Set<string>): number {
    const context: EffectContext = {
      cityId: city.id!,
      playerId: city.playerId!,
      tileX: city.x!,
      tileY: city.y!,
      cityBuildings: new Set(city.buildings ?? []),
      playerTechs,
    };
    const performance = this.effectsManager.calculateEffect(EffectType.PERFORMANCE, context).value;
    const culturePct = this.effectsManager.calculateEffect(EffectType.CULTURE_PCT, context).value;
    return city.history + scaleCultureEffect(performance, culturePct);
  }

  /**
   * Calculate current culture score of a city
   *
   * Direct port of freeciv city_culture() from culture.c:29
   * Formula: history + performance * (100 + culture_pct) / 100
   *
   * Reference: freeciv/common/culture.c lines 29-34
   */
  public calculateCityCulture(
    city: CityWithBuildings,
    playerTechs?: Set<string>
  ): CultureCalculationResult {
    const context: EffectContext = {
      cityId: city.id,
      playerId: city.playerId,
      tileX: city.x,
      tileY: city.y,
      cityBuildings: new Set(city.buildings),
      playerTechs,
    };

    // Get performance effect (immediate culture boost)
    const performanceEffect = this.effectsManager.calculateEffect(EffectType.PERFORMANCE, context);

    // Get culture percentage modifier
    const culturePctEffect = this.effectsManager.calculateEffect(EffectType.CULTURE_PCT, context);

    // Apply freeciv formula: performance * (100 + culture_pct) / 100
    const adjustedPerformance = scaleCultureEffect(performanceEffect.value, culturePctEffect.value);

    // Total culture = base history + adjusted performance
    const culture = city.history + adjustedPerformance;

    logger.debug(`City ${city.name} culture calculation:`, {
      cityId: city.id,
      baseHistory: city.history,
      performance: performanceEffect.value,
      culturePct: culturePctEffect.value,
      adjustedPerformance,
      totalCulture: culture,
    });

    return {
      culture,
      historyGain: 0, // Will be calculated by calculateCityHistoryGain
      breakdown: {
        baseHistory: city.history,
        performance: performanceEffect.value,
        culturePct: culturePctEffect.value,
        interestGain: 0, // Will be calculated by calculateCityHistoryGain
      },
    };
  }

  /**
   * Calculate how much history a city gains this turn
   *
   * Direct port of freeciv city_history_gain() from culture.c:39
   * Formula: history_effect * (100 + culture_pct) / 100 + history * interest_rate / 1000
   *
   * Reference: freeciv/common/culture.c lines 39-44
   */
  public calculateCityHistoryGain(
    city: CityWithBuildings,
    game: Game,
    playerTechs?: Set<string>
  ): number {
    const context: EffectContext = {
      cityId: city.id,
      playerId: city.playerId,
      tileX: city.x,
      tileY: city.y,
      cityBuildings: new Set(city.buildings),
      playerTechs,
    };

    // Get history effect (base culture generation per turn)
    const historyEffect = this.effectsManager.calculateEffect(EffectType.HISTORY, context);

    // Get culture percentage modifier
    const culturePctEffect = this.effectsManager.calculateEffect(EffectType.CULTURE_PCT, context);

    // Apply culture percentage to history generation
    const adjustedHistory = scaleCultureEffect(historyEffect.value, culturePctEffect.value);

    // Calculate compound interest on existing history
    // game.historyInterestPml is per mille (parts per thousand)
    const interestGain = Math.trunc((city.history * game.historyInterestPml) / 1000);

    const totalGain = adjustedHistory + interestGain;

    logger.debug(`City ${city.name} history gain calculation:`, {
      cityId: city.id,
      baseHistory: historyEffect.value,
      culturePct: culturePctEffect.value,
      adjustedHistory,
      currentHistory: city.history,
      interestRate: game.historyInterestPml,
      interestGain,
      totalGain,
    });

    return totalGain;
  }

  /**
   * Calculate current culture score of a player
   *
   * Direct port of freeciv player_culture() from culture.c:49
   * Formula: player.history + national_performance * (100 + culture_pct) / 100 + sum(city_culture)
   *
   * Reference: freeciv/common/culture.c lines 49-60
   */
  public async calculatePlayerCulture(player: PlayerWithTechs): Promise<PlayerCultureResult> {
    const context: EffectContext = {
      playerId: player.id,
      playerTechs: new Set(player.technologies),
    };

    // Get national performance effect
    const nationalPerformanceEffect = this.effectsManager.calculateEffect(
      EffectType.NATION_PERFORMANCE,
      context
    );

    // Get culture percentage modifier (affects both national and city culture)
    const culturePctEffect = this.effectsManager.calculateEffect(EffectType.CULTURE_PCT, context);

    // Apply freeciv formula: national_performance * (100 + culture_pct) / 100
    const adjustedNationalPerformance = scaleCultureEffect(
      nationalPerformanceEffect.value,
      culturePctEffect.value
    );

    // Get all player cities to sum their culture
    const db = this.databaseProvider.getDatabase();
    const playerCities = await db.select().from(cities).where(eq(cities.playerId, player.id));

    let totalCityCulture = 0;
    for (const city of playerCities) {
      const cityWithBuildings: CityWithBuildings = {
        ...city,
        buildings: Array.isArray(city.buildings) ? (city.buildings as string[]) : [],
      };
      const cityCultureResult = this.calculateCityCulture(
        cityWithBuildings,
        new Set(player.technologies)
      );
      totalCityCulture += cityCultureResult.culture;
    }

    // Total player culture = national history + adjusted national performance + city culture sum
    const totalCulture = player.history + adjustedNationalPerformance + totalCityCulture;

    logger.debug(`Player ${player.id} culture calculation:`, {
      playerId: player.id,
      nationalHistory: player.history,
      nationalPerformance: nationalPerformanceEffect.value,
      culturePct: culturePctEffect.value,
      adjustedNationalPerformance,
      totalCityCulture,
      totalCulture,
    });

    return {
      totalCulture,
      nationalHistory: player.history,
      nationalHistoryGain: 0, // Will be calculated by calculateNationHistoryGain
      cityCulture: totalCityCulture,
      breakdown: {
        nationalPerformance: nationalPerformanceEffect.value,
        nationalHistory: player.history,
        nationalCulturePct: culturePctEffect.value,
        totalCityCulture,
      },
    };
  }

  /**
   * Calculate how much nation-wide history a player gains this turn
   * Does NOT include history gains of individual cities.
   *
   * Direct port of freeciv nation_history_gain() from culture.c:66
   * Formula: national_history * (100 + culture_pct) / 100 + history * interest_rate / 1000
   *
   * Reference: freeciv/common/culture.c lines 66-71
   */
  public calculateNationHistoryGain(player: PlayerWithTechs, game: Game): number {
    const context: EffectContext = {
      playerId: player.id,
      playerTechs: new Set(player.technologies),
    };

    // Get national history effect (national culture generation per turn)
    const nationalHistoryEffect = this.effectsManager.calculateEffect(
      EffectType.NATION_HISTORY,
      context
    );

    // Get culture percentage modifier
    const culturePctEffect = this.effectsManager.calculateEffect(EffectType.CULTURE_PCT, context);

    // Apply culture percentage to national history generation
    const adjustedNationalHistory = scaleCultureEffect(
      nationalHistoryEffect.value,
      culturePctEffect.value
    );

    // Calculate compound interest on existing national history
    const interestGain = Math.trunc((player.history * game.historyInterestPml) / 1000);

    const totalGain = adjustedNationalHistory + interestGain;

    logger.debug(`Player ${player.id} national history gain:`, {
      playerId: player.id,
      baseNationalHistory: nationalHistoryEffect.value,
      culturePct: culturePctEffect.value,
      adjustedNationalHistory,
      currentHistory: player.history,
      interestRate: game.historyInterestPml,
      interestGain,
      totalGain,
    });

    return totalGain;
  }

  /**
   * Process culture gain for all cities and players in a game
   * Called once per turn during turn processing
   */
  public async processCultureGain(gameId: string): Promise<CultureProcessingResult> {
    const db = this.databaseProvider.getDatabase();
    const result: CultureProcessingResult = { cities: {}, players: {} };

    try {
      // Get game settings
      const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
      if (!game) {
        throw new Error(`Game ${gameId} not found`);
      }

      // Get all players in the game
      const gamePlayers = await db.select().from(players).where(eq(players.gameId, gameId));

      // Get all cities in the game
      const gameCities = await db.select().from(cities).where(eq(cities.gameId, gameId));

      await this.processCityCultureGain(db, game, gameCities, gamePlayers, result);
      await this.processPlayerCultureGain(db, game, gamePlayers, result);

      logger.info(
        `Processed culture gain for game ${gameId}: ${gameCities.length} cities, ${gamePlayers.length} players`
      );
      return result;
    } catch (error) {
      logger.error(`Failed to process culture gain for game ${gameId}:`, error);
      throw error;
    }
  }

  private async processCityCultureGain(
    db: any,
    game: any,
    gameCities: any[],
    gamePlayers: any[],
    result: CultureProcessingResult
  ): Promise<void> {
    for (const city of gameCities) {
      const cityWithBuildings: CityWithBuildings = {
        ...city,
        buildings: Array.isArray(city.buildings) ? (city.buildings as string[]) : [],
      };
      const cityPlayer = gamePlayers.find(p => p.id === city.playerId);
      const playerTechs = cityPlayer
        ? new Set(
            Array.isArray(cityPlayer.technologies) ? (cityPlayer.technologies as string[]) : []
          )
        : undefined;
      const historyGain = this.calculateCityHistoryGain(cityWithBuildings, game, playerTechs);
      const history = city.history + historyGain;
      if (historyGain !== 0) {
        await db.update(cities).set({ history }).where(eq(cities.id, city.id));
        logger.debug(`City ${city.name} gained ${historyGain} history (total: ${history})`);
      }
      const runtimeCity = this.runtimeState.getCity?.(city.id);
      if (runtimeCity) runtimeCity.history = history;
      result.cities[city.id] = {
        history,
        culture: this.calculateCityCulture({ ...cityWithBuildings, history }, playerTechs).culture,
      };
    }
  }

  private async processPlayerCultureGain(
    db: any,
    game: any,
    gamePlayers: any[],
    result: CultureProcessingResult
  ): Promise<void> {
    for (const player of gamePlayers) {
      const playerWithTechs: PlayerWithTechs = {
        ...player,
        technologies: Array.isArray(player.technologies) ? (player.technologies as string[]) : [],
      };
      const nationalHistoryGain = this.calculateNationHistoryGain(playerWithTechs, game);
      const history = player.history + nationalHistoryGain;
      if (nationalHistoryGain !== 0) {
        await db.update(players).set({ history }).where(eq(players.id, player.id));
        logger.debug(
          `Player ${player.id} gained ${nationalHistoryGain} national history (total: ${history})`
        );
      }
      const runtimePlayer = this.runtimeState.getPlayer?.(player.id);
      if (runtimePlayer) runtimePlayer.history = history;
      const culture = await this.calculatePlayerCulture({ ...playerWithTechs, history });
      result.players[player.id] = { history, totalCulture: culture.totalCulture };
    }
  }

  /**
   * Get comprehensive culture information for a player
   * Useful for UI display and victory condition checking
   */
  public async getPlayerCultureInfo(playerId: string, _gameId: string) {
    const db = this.databaseProvider.getDatabase();

    const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
    if (!player) {
      throw new Error(`Player ${playerId} not found`);
    }

    const playerWithTechs: PlayerWithTechs = {
      ...player,
      technologies: Array.isArray(player.technologies) ? (player.technologies as string[]) : [],
    };

    const cultureResult = await this.calculatePlayerCulture(playerWithTechs);

    return {
      playerId,
      totalCulture: cultureResult.totalCulture,
      nationalHistory: cultureResult.nationalHistory,
      cityCulture: cultureResult.cityCulture,
      breakdown: cultureResult.breakdown,
    };
  }

  /**
   * Get culture information for a specific city
   * Useful for city dialogs and building requirement checks
   */
  public async getCityCultureInfo(cityId: string) {
    const db = this.databaseProvider.getDatabase();

    const [city] = await db.select().from(cities).where(eq(cities.id, cityId)).limit(1);
    if (!city) {
      throw new Error(`City ${cityId} not found`);
    }

    const [player] = await db.select().from(players).where(eq(players.id, city.playerId)).limit(1);
    if (!player) {
      throw new Error(`Player ${city.playerId} not found`);
    }

    const cityWithBuildings: CityWithBuildings = {
      ...city,
      buildings: Array.isArray(city.buildings) ? (city.buildings as string[]) : [],
    };

    const playerTechs = new Set(
      Array.isArray(player.technologies) ? (player.technologies as string[]) : []
    );
    const cultureResult = this.calculateCityCulture(cityWithBuildings, playerTechs);

    return {
      cityId,
      cityName: city.name,
      culture: cultureResult.culture,
      history: city.history,
      breakdown: cultureResult.breakdown,
    };
  }
}
