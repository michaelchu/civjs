import { CivilWarService, GAME_DEFAULT_CIVIL_WAR_SIZE } from '@game/services/CivilWarService';
import { EffectsManager } from '@game/managers/EffectsManager';
import type { CityState } from '@game/cities/CityTypes';
import type { PlayerState } from '@game/runtime/GameTypes';
import { createMockDatabaseProvider } from '../../utils/mockDatabaseProvider';

const gameId = '00000000-0000-0000-0000-000000000001';
const sourcePlayerId = '00000000-0000-0000-0000-000000000010';

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: sourcePlayerId,
    userId: '00000000-0000-0000-0000-000000000099',
    isAI: false,
    playerNumber: 0,
    civilization: 'american',
    nation: 'american',
    color: { r: 255, g: 0, b: 0 },
    isAlive: true,
    gold: 101,
    science: 0,
    government: 'despotism',
    isReady: true,
    hasEndedTurn: false,
    isConnected: true,
    lastSeen: new Date(0),
    ...overrides,
  };
}

function makeCity(
  index: number,
  playerId = sourcePlayerId,
  overrides: Partial<CityState> = {}
): CityState {
  return {
    id: `city-${index}`,
    name: `City ${index}`,
    x: index,
    y: 0,
    playerId,
    population: 4,
    size: 4,
    cityRadius: 2,
    founded: 1,
    turnsToComplete: 0,
    history: 0,
    buildings: [],
    specialists: {} as CityState['specialists'],
    tradeRoutes: [],
    happiness: { happy: 0, content: 4, unhappy: 0, angry: 0 },
    worklist: [],
    ...overrides,
  };
}

function makeHarness({
  cityCount = GAME_DEFAULT_CIVIL_WAR_SIZE,
  randomValues = [0],
  cityOverrides = new Map<number, Partial<CityState>>(),
}: {
  cityCount?: number;
  randomValues?: number[];
  cityOverrides?: Map<number, Partial<CityState>>;
} = {}) {
  const cities = new Map<string, CityState>();
  for (let index = 0; index < cityCount; index++) {
    cities.set(
      `city-${index}`,
      makeCity(index, sourcePlayerId, {
        isCapital: index === 0,
        buildings: index === 0 ? ['palace'] : [],
        ...cityOverrides.get(index),
      })
    );
  }
  const source = makePlayer();
  const players = new Map([[source.id, source]]);
  const random = jest.fn(() => randomValues.shift() ?? 0);
  const transferCity = jest.fn(async (cityId: string, newPlayerId: string) => {
    const city = cities.get(cityId);
    if (!city) return false;
    city.playerId = newPlayerId;
    city.isCapital = false;
    return true;
  });
  const establishCivilWarCapital = jest.fn(async (playerId: string, cityId: string) => {
    const capital = cities.get(cityId);
    if (!capital || capital.playerId !== playerId) return false;
    for (const city of cities.values()) {
      if (city.playerId === playerId) city.isCapital = city.id === cityId;
    }
    if (!capital.buildings.includes('palace')) capital.buildings.push('palace');
    return true;
  });
  const research = new Map<
    string,
    { currentTech?: string; techGoal?: string; researchedTechs: Set<string> }
  >([
    [
      source.id,
      {
        currentTech: 'bronze_working',
        techGoal: 'writing',
        researchedTechs: new Set(['alphabet']),
      },
    ],
  ]);
  const seedPlayerResearch = jest.fn(async (playerId: string, state: any) => {
    research.set(playerId, {
      currentTech: state.currentResearch ?? undefined,
      techGoal: state.researchGoal ?? undefined,
      researchedTechs: new Set(state.researchedTechs ?? []),
    });
  });
  const government = new Map([[source.id, { currentGovernment: 'despotism' }]]);
  const loadPlayerGovernment = jest.fn(async (playerId: string, currentGovernment: string) => {
    government.set(playerId, { currentGovernment });
  });
  const startCivilWarRevolution = jest.fn(async (playerId: string) => {
    government.set(playerId, { currentGovernment: 'anarchy' });
    return true;
  });
  const visibility = new Map<
    string,
    {
      explored: Set<string>;
      visible: Set<string>;
      lastSeen: Record<string, Date>;
      remembered: Map<string, unknown>;
    }
  >([
    [
      source.id,
      {
        explored: new Set(['1,1']),
        visible: new Set(['1,1']),
        lastSeen: { '1,1': new Date(0) },
        remembered: new Map([['1,1', { terrain: 'grassland' }]]),
      },
    ],
  ]);
  const restorePlayerVisibility = jest.fn(
    (
      playerId: string,
      explored: Iterable<string>,
      visible: Iterable<string>,
      lastSeen: Record<string, Date>,
      remembered: Record<string, unknown>
    ) => {
      visibility.set(playerId, {
        explored: new Set(explored),
        visible: new Set(visible),
        lastSeen,
        remembered: new Map(Object.entries(remembered)),
      });
    }
  );
  const updatePlayerVisibility = jest.fn();
  const gold = new Map([[source.id, 101]]);
  const economy = {
    getPlayerGold: jest.fn(async (playerId: string) => gold.get(playerId) ?? 0),
    setPlayerGold: jest.fn(async (playerId: string, amount: number) => {
      gold.set(playerId, amount);
      return true;
    }),
    initializePlayer: jest.fn(async (playerId: string, amount: number) => {
      gold.set(playerId, amount);
    }),
  };
  const registerTurnPlayer = jest.fn();

  const service = new CivilWarService({
    gameId,
    rulesetName: 'civ2civ3',
    maxPlayers: 4,
    players,
    databaseProvider: createMockDatabaseProvider(),
    cityManager: {
      getCitiesByPlayer: (playerId: string) =>
        [...cities.values()].filter(city => city.playerId === playerId),
      transferCity,
      establishCivilWarCapital,
    },
    researchManager: {
      getPlayerResearch: playerId => research.get(playerId),
      initializePlayerResearch: async playerId => {
        if (!research.has(playerId)) research.set(playerId, { researchedTechs: new Set() });
      },
      seedPlayerResearch,
    },
    governmentManager: {
      getPlayerGovernment: playerId => government.get(playerId),
      loadPlayerGovernment,
      startCivilWarRevolution,
    },
    visibilityManager: {
      getExploredTiles: playerId => visibility.get(playerId)?.explored ?? new Set(),
      getVisibleTiles: playerId => visibility.get(playerId)?.visible ?? new Set(),
      getLastSeenTiles: playerId => visibility.get(playerId)?.lastSeen ?? {},
      getRememberedTiles: playerId => visibility.get(playerId)?.remembered ?? new Map(),
      restorePlayerVisibility,
      updatePlayerVisibility,
    },
    effectsManager: new EffectsManager('civ2civ3'),
    random,
    currentTurn: () => 42,
    registerTurnPlayer,
    economyManager: economy,
  });

  return {
    service,
    source,
    players,
    cities,
    random,
    transferCity,
    establishCivilWarCapital,
    research,
    loadPlayerGovernment,
    startCivilWarRevolution,
    restorePlayerVisibility,
    updatePlayerVisibility,
    gold,
    registerTurnPlayer,
  };
}

describe('Civ2Civ3 civil war', () => {
  /**
   * @evidence parity
   * @reference reference/freeciv/server/citytools.c:2021-2035 unit_conquer_city()
   * @reference reference/freeciv/server/plrhand.c:2915-2978 civil_war_possible(), civil_war_triggered()
   * @reference reference/freeciv/server/plrhand.c:3008-3157 civil_war()
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:1139-1191
   * @assertion A qualifying C2C3 capital loss rolls before capture-side work, creates an AI rebel, splits the treasury and research, forces one turn of anarchy, and transfers a randomized half of eligible cities.
   * @c2c3-internal-action Civil War
   * @c2c3-internal-scenario normal
   * @c2c3-surface cities
   * @c2c3-surface-scenario normal, boundary
   */
  it('partitions a qualifying empire after its capital falls', async () => {
    const harness = makeHarness({
      // Chance roll, rebel nation, leader, four city transfers, rebel capital.
      randomValues: [0, 0, 0, 0.99, 0.99, 0.99, 0.99, 0],
    });
    const event = {
      playerId: sourcePlayerId,
      lostCityId: 'city-0',
      cityCountBeforeLoss: GAME_DEFAULT_CIVIL_WAR_SIZE,
    };

    expect(harness.service.prepareCapitalLoss(event)).toBe(true);

    // Model the post-conquest state passed to Freeciv's civil_war().
    harness.cities.get('city-0')!.playerId = 'attacker';
    harness.cities.get('city-0')!.isCapital = false;
    harness.cities.get('city-1')!.isCapital = true;
    const result = await harness.service.resolveCapitalLoss({ ...event, civilWarTriggered: true });

    expect(result.activated).toBe(true);
    const rebel = harness.players.get(result.rebelPlayerId!);
    expect(rebel).toMatchObject({
      isAI: true,
      nation: 'confederate',
      government: 'despotism',
      hasEndedTurn: true,
    });
    expect(harness.cities.get('city-1')?.playerId).toBe(sourcePlayerId);
    expect(
      [...harness.cities.values()].filter(city => city.playerId === result.rebelPlayerId)
    ).toHaveLength(4);
    expect(
      [...harness.cities.values()].filter(
        city => city.playerId === result.rebelPlayerId && city.isCapital
      )
    ).toHaveLength(1);
    expect(harness.gold.get(sourcePlayerId)).toBe(51);
    expect(harness.gold.get(result.rebelPlayerId!)).toBe(50);
    expect(harness.research.get(sourcePlayerId)).toEqual({
      currentTech: 'bronze_working',
      techGoal: 'writing',
      researchedTechs: new Set(['alphabet']),
    });
    expect(harness.research.get(result.rebelPlayerId!)).toEqual(
      harness.research.get(sourcePlayerId)
    );
    expect(harness.startCivilWarRevolution).toHaveBeenCalledWith(sourcePlayerId, 42);
    expect(harness.loadPlayerGovernment).toHaveBeenCalledWith(result.rebelPlayerId, 'despotism', 0);
    expect(harness.restorePlayerVisibility).toHaveBeenCalledWith(
      result.rebelPlayerId,
      new Set(['1,1']),
      new Set(['1,1']),
      { '1,1': new Date(0) },
      { '1,1': { terrain: 'grassland' } }
    );
    expect(harness.updatePlayerVisibility).toHaveBeenCalledWith(result.rebelPlayerId);
    expect(harness.registerTurnPlayer).toHaveBeenCalledWith(result.rebelPlayerId);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/server/plrhand.c:2943-2978 civil_war_triggered()
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:1139-1191
   * @assertion C2C3 Despotism starts at 80 percent; a celebrating city subtracts five and the equality boundary does not trigger because Freeciv compares dice strictly below probability.
   * @c2c3-internal-action Civil War
   * @c2c3-internal-scenario boundary
   * @c2c3-surface cities
   * @c2c3-surface-scenario boundary
   */
  it('uses city celebration and the strict chance boundary', () => {
    const celebration = {
      wasHappy: true,
      population: 4,
      happiness: { happy: 2, content: 2, unhappy: 0, angry: 0 },
    };
    const triggering = makeHarness({
      randomValues: [0.74],
      cityOverrides: new Map([[1, celebration]]),
    });
    const boundary = makeHarness({
      randomValues: [0.75],
      cityOverrides: new Map([[1, celebration]]),
    });
    const event = {
      playerId: sourcePlayerId,
      lostCityId: 'city-0',
      cityCountBeforeLoss: GAME_DEFAULT_CIVIL_WAR_SIZE,
    };

    expect(triggering.service.prepareCapitalLoss(event)).toBe(true);
    expect(boundary.service.prepareCapitalLoss(event)).toBe(false);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/game.h:496-498 GAME_DEFAULT_CIVILWARSIZE
   * @reference reference/freeciv/server/plrhand.c:2915-2935 civil_war_possible()
   * @assertion An empire below C2C3's default ten-city civil-war threshold cannot trigger a split and does not consume its chance roll.
   * @c2c3-internal-action Civil War
   * @c2c3-internal-scenario rejected
   * @c2c3-surface cities
   * @c2c3-surface-scenario boundary
   */
  it('rejects an empire below the civil-war city threshold', () => {
    const harness = makeHarness({ cityCount: GAME_DEFAULT_CIVIL_WAR_SIZE - 1 });
    const event = {
      playerId: sourcePlayerId,
      lostCityId: 'city-0',
      cityCountBeforeLoss: GAME_DEFAULT_CIVIL_WAR_SIZE - 1,
    };

    expect(harness.service.prepareCapitalLoss(event)).toBe(false);
    expect(harness.random).not.toHaveBeenCalled();
  });
});
