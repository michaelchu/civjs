import { EffectsManager, EffectType, OutputType } from '@game/managers/EffectsManager';
import { DiplomacyManager } from '@game/managers/DiplomacyManager';
import { loadRulesetTechnologies, ResearchManager } from '@game/managers/ResearchManager';
import { UnitManager } from '@game/managers/UnitManager';
import { MapTopology, TopologyFlag, WrapFlag } from '@game/map/MapTopology';
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { ActionType } from '@app-types/shared/actions';
import { CIV2CIV3_ORACLE_BASELINE, loadCiv2Civ3OracleResults } from './Civ2Civ3OracleResults';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

function civ2civ3CityWallsGroundDefense(): number {
  const warrior = rulesetUnitsService.getUnitTypes('civ2civ3').warriors;
  if (!warrior) throw new Error('Civ2Civ3 Warriors unit is missing from the ruleset.');

  return new EffectsManager('civ2civ3').calculateEffect(EffectType.DEFEND_BONUS, {
    playerId: 'oracle-player',
    unitId: 'oracle-warrior',
    unitType: warrior.id,
    unitClass: warrior.rulesetUnitClass,
    unitClassFlags: new Set(warrior.rulesetUnitClassFlags),
    unitTypeFlags: new Set(warrior.flags ?? []),
    tileIsCityCenter: true,
    cityBuildings: new Set(['city_walls']),
  }).value;
}

function civ2civ3MagellansVeteranCombat(): number {
  const destroyer = rulesetUnitsService.getUnitTypes('civ2civ3').destroyer;
  if (!destroyer) throw new Error('Civ2Civ3 Destroyer unit is missing from the ruleset.');

  return new EffectsManager('civ2civ3').calculateEffect(EffectType.VETERAN_COMBAT, {
    playerId: 'oracle-player',
    unitId: 'oracle-destroyer',
    unitType: destroyer.id,
    unitClass: destroyer.rulesetUnitClass,
    unitClassFlags: new Set(destroyer.rulesetUnitClassFlags),
    unitTypeFlags: new Set(destroyer.flags ?? []),
    playerBuildings: new Set(['magellans_expedition']),
  }).value;
}

function civ2civ3VisibilityEffects(): Record<string, number> {
  const effects = new EffectsManager('civ2civ3');
  return {
    reveal_map_without_apollo: effects.calculateEffect(EffectType.REVEAL_MAP, {
      playerBuildings: new Set(),
    }).value,
    reveal_cities_without_internet: effects.calculateEffect(EffectType.REVEAL_CITIES, {
      playerBuildings: new Set(),
    }).value,
    city_vision_base: effects.calculateEffect(EffectType.CITY_VISION_RADIUS_SQ, {
      playerTechs: new Set(),
    }).value,
    reveal_map_apollo: effects.calculateEffect(EffectType.REVEAL_MAP, {
      playerBuildings: new Set(['apollo_program']),
    }).value,
    reveal_cities_internet: effects.calculateEffect(EffectType.REVEAL_CITIES, {
      playerBuildings: new Set(['internet']),
    }).value,
    city_vision_electricity: effects.calculateEffect(EffectType.CITY_VISION_RADIUS_SQ, {
      playerTechs: new Set(['electricity']),
    }).value,
  };
}

function civ2civ3MapTopology(): Record<string, number> {
  const topology = new MapTopology(80, 50, {
    topologyId: TopologyFlag.ISO | TopologyFlag.HEX,
    wrapId: WrapFlag.X | WrapFlag.Y,
  });

  return {
    map_topology_corner_neighbors: topology.getNeighbors(0, 0).length,
  };
}

function civ2civ3SpaceshipEffects(): Record<string, number> {
  const effects = new EffectsManager('civ2civ3');
  return {
    spaceship_enable_space_without_apollo: effects.calculateEffect(EffectType.ENABLE_SPACE, {
      worldBuildings: new Set<string>(),
    }).value,
    spaceship_enable_space_with_apollo: effects.calculateEffect(EffectType.ENABLE_SPACE, {
      worldBuildings: new Set(['apollo_program']),
    }).value,
  };
}

function civ2civ3CityTileEffects(): Record<string, number> {
  const effects = new EffectsManager('civ2civ3');
  const grasslandCenter = {
    tileTerrain: 'grassland',
    tileTerrainClass: 'Land',
    tileTerrainAlterations: new Set(['CanIrrigate']),
    tileExtras: new Set<string>(),
    tileIsCityCenter: true,
    cityBuildings: new Set<string>(),
  };

  return {
    city_center_irrigation_pct: effects.calculateEffect(EffectType.IRRIGATION_PCT, {
      ...grasslandCenter,
      outputType: OutputType.FOOD,
    }).value,
    city_center_shield_add: effects.calculateEffect(EffectType.OUTPUT_ADD_TILE, {
      ...grasslandCenter,
      outputType: OutputType.SHIELD,
    }).value,
    grassland_tile_workable: effects.calculateEffect(EffectType.TILE_WORKABLE, grasslandCenter)
      .value,
    city_center_supermarket_food_pct: effects.calculateEffect(EffectType.OUTPUT_PER_TILE, {
      ...grasslandCenter,
      outputType: OutputType.FOOD,
      cityBuildings: new Set(['supermarket']),
    }).value,
    city_center_pollution_punish_pct: effects.calculateEffect(EffectType.OUTPUT_TILE_PUNISH_PCT, {
      ...grasslandCenter,
      outputType: OutputType.FOOD,
      cityBuildings: new Set(['supermarket']),
      tileExtras: new Set(['pollution']),
    }).value,
    city_center_mining_pct: effects.calculateEffect(EffectType.MINING_PCT, {
      ...grasslandCenter,
      outputType: OutputType.SHIELD,
      cityBuildings: new Set(['supermarket']),
      tileExtras: new Set(['pollution', 'mine']),
    }).value,
    inaccessible_tile_workable: effects.calculateEffect(EffectType.TILE_WORKABLE, {
      tileTerrain: 'inaccessible',
      tileTerrainClass: 'Land',
      tileExtras: new Set<string>(),
      tileIsCityCenter: false,
      cityBuildings: new Set(['supermarket']),
    }).value,
  };
}

function civ2civ3HealthEffects(): Record<string, number> {
  const effects = new EffectsManager('civ2civ3');
  const effectContext = (cityBuildings: string[], playerTechs: string[] = []) => ({
    playerId: 'oracle-player',
    cityId: 'oracle-city',
    cityPopulation: 15,
    cityBuildings: new Set(cityBuildings),
    playerBuildings: new Set(cityBuildings),
    playerTechs: new Set(playerTechs),
  });
  const health = (cityBuildings: string[], playerTechs?: string[]) =>
    effects.calculateEffect(EffectType.HEALTH_PCT, effectContext(cityBuildings, playerTechs)).value;

  return {
    health_pct_base: health([]),
    health_pct_medicine: health([], ['medicine']),
    health_pct_aqueduct: health(['aqueduct'], ['medicine']),
    health_pct_sewer: health(['aqueduct', 'sewer_system'], ['medicine']),
    health_pct_cure: health(['aqueduct', 'sewer_system', 'cure_for_cancer'], ['medicine']),
  };
}

function civ2civ3GainAiLoveEffects(): Record<string, number> {
  const effects = new EffectsManager('civ2civ3');
  const gain = (context: Parameters<EffectsManager['calculateEffect']>[1]) =>
    effects.calculateEffect(EffectType.GAIN_AI_LOVE, context).value;

  return {
    gain_ai_love_without_wonder: gain({
      playerIsAI: false,
      playerBuildings: new Set(),
      worldBuildings: new Set(),
    }),
    gain_ai_love_eiffel: gain({
      playerIsAI: false,
      playerBuildings: new Set(['eiffel_tower']),
      worldBuildings: new Set(['eiffel_tower']),
    }),
    gain_ai_love_united_nations: gain({
      playerIsAI: false,
      playerBuildings: new Set(['united_nations']),
      worldBuildings: new Set(['united_nations']),
    }),
    gain_ai_love_apollo: gain({
      playerIsAI: false,
      playerBuildings: new Set(['eiffel_tower']),
      worldBuildings: new Set(['eiffel_tower', 'apollo_program']),
    }),
    gain_ai_love_cheating_ai: gain({
      playerIsAI: true,
      aiLevel: 'cheating',
      playerBuildings: new Set(),
      worldBuildings: new Set(),
    }),
  };
}

function civ2civ3GainAiLoveOracleEffects(): Pick<
  ReturnType<typeof civ2civ3GainAiLoveEffects>,
  'gain_ai_love_without_wonder' | 'gain_ai_love_eiffel' | 'gain_ai_love_apollo'
> {
  const effects = civ2civ3GainAiLoveEffects();
  return {
    gain_ai_love_without_wonder: effects.gain_ai_love_without_wonder,
    gain_ai_love_eiffel: effects.gain_ai_love_eiffel,
    gain_ai_love_apollo: effects.gain_ai_love_apollo,
  };
}

function civ2civ3ResearchBaseCosts(): Record<string, number> {
  const technologies = loadRulesetTechnologies(rulesetLoader, 'civ2civ3');
  return {
    research_base_cost_alphabet: technologies.alphabet.cost,
    research_base_cost_writing: technologies.writing.cost,
    research_base_cost_electricity: technologies.electricity.cost,
    research_base_cost_advanced_flight: technologies.advanced_flight.cost,
    research_base_cost_fusion_power: technologies.fusion_power.cost,
  };
}

async function civ2civ3EmbassyTechnologyLeakageCost(): Promise<number> {
  const technologies = loadRulesetTechnologies(rulesetLoader, 'civ2civ3');
  const manager = new ResearchManager(
    'civ2civ3-oracle-leakage',
    createMockDatabaseProvider(),
    technologies,
    new EffectsManager('civ2civ3'),
    'civ2civ3'
  );
  for (const playerId of ['learner', 'peer', 'observer']) {
    await manager.initializePlayerResearch(playerId);
  }
  await manager.grantTechnology('peer', 'alphabet');
  manager.setResearchDiplomacyProvider((playerId, targetPlayerId) => ({
    hasRealEmbassy: playerId === 'learner' && targetPlayerId === 'peer',
    hasContact: true,
    targetIsBarbarian: false,
  }));

  const required = manager.getResearchProgress('learner')?.required;
  if (required === undefined) throw new Error('Civ2Civ3 leakage fixture has no research target.');
  return required;
}

async function civ2civ3EmbassyStayRealEmbassy(): Promise<number> {
  const rows = [
    {
      id: 'learner',
      gameId: 'civ2civ3-oracle-embassy',
      playerNumber: 0,
      nation: 'french',
      civilization: 'french',
      leaderName: 'Learner',
      government: 'despotism',
      isAlive: true,
      isAI: false,
      teamId: null,
      knownPlayers: [],
      diplomaticRelations: {},
    },
    {
      id: 'peer',
      gameId: 'civ2civ3-oracle-embassy',
      playerNumber: 1,
      nation: 'german',
      civilization: 'german',
      leaderName: 'Peer',
      government: 'despotism',
      isAlive: true,
      isAI: true,
      teamId: null,
      knownPlayers: [],
      diplomaticRelations: {},
    },
  ];
  const database = {
    query: { players: { findMany: async () => rows } },
    update: () => ({
      set: (data: any) => ({
        where: async () => {
          const relationTarget = Object.keys(data.diplomaticRelations)[0];
          const row = rows.find(candidate => candidate.id !== relationTarget);
          if (!row) throw new Error('Civ2Civ3 embassy fixture could not persist a player.');
          Object.assign(row, data);
        },
      }),
    }),
  };
  const manager = new DiplomacyManager(
    { getDatabase: () => database } as any,
    () => 0,
    () => new Set(),
    new EffectsManager('civ2civ3')
  );

  await manager.establishContact('civ2civ3-oracle-embassy', 'learner', 'peer');
  await manager.establishEmbassy('civ2civ3-oracle-embassy', 'learner', 'peer');
  const learner = await manager.getSnapshot('civ2civ3-oracle-embassy', 'learner');
  return Number(learner.nations[0]?.relation.embassy);
}

async function civ2civ3ZeroMoveSelfNuclear(): Promise<Record<string, number>> {
  const mapWidth = 80;
  const mapHeight = 50;
  const topology = new MapTopology(mapWidth, mapHeight, {
    topologyId: TopologyFlag.ISO | TopologyFlag.HEX,
    wrapId: WrapFlag.X | WrapFlag.Y,
  });
  const tiles = new Map<
    string,
    { x: number; y: number; terrain: string; improvements: string[] }
  >();
  for (let x = 9; x <= 11; x += 1) {
    for (let y = 9; y <= 11; y += 1) {
      tiles.set(`${x},${y}`, { x, y, terrain: 'grassland', improvements: [] });
    }
  }
  const mapData = {
    width: mapWidth,
    height: mapHeight,
    topologyId: topology.topologyId,
    wrapId: topology.wrapId,
    tiles: [],
  };
  const manager = new UnitManager(
    'civ2civ3-oracle-nuclear',
    createMockDatabaseProvider(),
    mapWidth,
    mapHeight,
    {
      getTile: (x: number, y: number) => tiles.get(`${x},${y}`),
      getTopology: () => topology,
      getMapData: () => mapData,
      updateTileProperty: (x: number, y: number, property: string, value: unknown) => {
        const tile = tiles.get(`${x},${y}`);
        if (tile) Object.assign(tile, { [property]: value });
      },
    },
    {
      foundCity: async () => 'unused-city',
      requestPath: async () => ({ success: false }),
      broadcastUnitMoved: () => undefined,
      getCityAt: () => null,
      applyNuclearCityDamage: async () => [],
    },
    new EffectsManager('civ2civ3'),
    () => 0.99,
    rulesetUnitsService.getUnitTypes('civ2civ3')
  );
  const nuclear = await manager.createUnit('oracle-player', 'nuclear', 10, 10);
  nuclear.movementLeft = 0;
  const hexNeighbor = await manager.createUnit('oracle-player', 'warriors', 11, 11);
  const action = await manager.executeUnitAction(
    nuclear.id,
    ActionType.NUCLEAR_EXPLOSION,
    10,
    10,
    'oracle-player'
  );

  return {
    nuclear_self_action_succeeded: Number(action.success),
    nuclear_self_origin_units_removed: Number(!manager.getUnit(nuclear.id)),
    nuclear_self_hex_neighbor_destroyed: Number(!manager.getUnit(hexNeighbor.id)),
  };
}

async function civ2civ3NonNativeTransportDisembark(): Promise<Record<string, number>> {
  const mapWidth = 80;
  const mapHeight = 50;
  const topology = new MapTopology(mapWidth, mapHeight, {
    topologyId: TopologyFlag.ISO | TopologyFlag.HEX,
    wrapId: WrapFlag.X | WrapFlag.Y,
  });
  const origin = { x: 10, y: 10 };
  const target = topology.getNeighbors(origin.x, origin.y)[0];
  if (!target) throw new Error('Civ2Civ3 transport fixture has no adjacent target tile.');
  const followup = topology
    .getNeighbors(target.x, target.y)
    .find(position => position.x !== origin.x || position.y !== origin.y);
  if (!followup) throw new Error('Civ2Civ3 transport fixture has no follow-up tile.');

  const tiles = new Map<
    string,
    { x: number; y: number; terrain: string; improvements: string[] }
  >();
  for (const position of [origin, target, followup]) {
    tiles.set(`${position.x},${position.y}`, {
      ...position,
      terrain: position === origin ? 'ocean' : 'grassland',
      improvements: [],
    });
  }
  const manager = new UnitManager(
    'civ2civ3-oracle-transport-disembark',
    createMockDatabaseProvider(),
    mapWidth,
    mapHeight,
    {
      getTile: (x: number, y: number) =>
        tiles.get(`${x},${y}`) ?? { x, y, terrain: 'grassland', improvements: [] },
      getTopology: () => topology,
    },
    {
      foundCity: async () => 'unused-city',
      requestPath: async () => ({ success: false }),
      broadcastUnitMoved: () => undefined,
      getCityAt: () => null,
    },
    new EffectsManager('civ2civ3'),
    Math.random,
    rulesetUnitsService.getUnitTypes('civ2civ3')
  );
  const transport = await manager.createUnit('oracle-player', 'trireme', origin.x, origin.y);
  const cargo = await manager.createUnit(
    'oracle-player',
    'horsemen',
    origin.x,
    origin.y,
    undefined,
    transport.id
  );
  await manager.seedUnitState(cargo.id, { movementLeft: 12 });
  const disembark = await manager.executeUnitAction(
    cargo.id,
    ActionType.UNLOAD_UNIT,
    target.x,
    target.y,
    'oracle-player'
  );
  const followupMoveSucceeded = await manager
    .moveUnit(cargo.id, followup.x, followup.y)
    .then(() => true)
    .catch(() => false);

  return {
    non_native_disembark_succeeded: Number(disembark.success),
    non_native_disembark_transported: Number(Boolean(cargo.transportedBy)),
    non_native_disembark_followup_move_succeeded: Number(followupMoveSucceeded),
  };
}

async function civ2civ3TransportEmbark(): Promise<Record<string, number>> {
  const mapWidth = 80;
  const mapHeight = 50;
  const topology = new MapTopology(mapWidth, mapHeight, {
    topologyId: TopologyFlag.ISO | TopologyFlag.HEX,
    wrapId: WrapFlag.X | WrapFlag.Y,
  });
  const origin = { x: 10, y: 10 };
  const target = topology.getNeighbors(origin.x, origin.y)[0];
  if (!target) throw new Error('Civ2Civ3 embark fixture has no adjacent target tile.');
  const tiles = new Map<string, { x: number; y: number; terrain: string; improvements: string[] }>([
    [`${origin.x},${origin.y}`, { ...origin, terrain: 'grassland', improvements: [] }],
    [`${target.x},${target.y}`, { ...target, terrain: 'ocean', improvements: [] }],
  ]);
  const manager = new UnitManager(
    'civ2civ3-oracle-transport-embark',
    createMockDatabaseProvider(),
    mapWidth,
    mapHeight,
    {
      getTile: (x: number, y: number) =>
        tiles.get(`${x},${y}`) ?? { x, y, terrain: 'grassland', improvements: [] },
      getTopology: () => topology,
    },
    {
      foundCity: async () => 'unused-city',
      requestPath: async () => ({ success: false }),
      broadcastUnitMoved: () => undefined,
      getCityAt: () => null,
    },
    new EffectsManager('civ2civ3'),
    Math.random,
    rulesetUnitsService.getUnitTypes('civ2civ3')
  );
  const cargo = await manager.createUnit('oracle-player', 'alpine_troops', origin.x, origin.y);
  const transport = await manager.createUnit('oracle-player', 'helicopter', target.x, target.y);
  const embarked = await manager
    .moveUnit(cargo.id, target.x, target.y)
    .then(() => true)
    .catch(() => false);

  return {
    transport_embark_succeeded: Number(embarked),
    transport_embark_transported: Number(cargo.transportedBy === transport.id),
  };
}

async function civ2civ3VeteranWarriorUpgrade(): Promise<Record<string, number>> {
  const databaseProvider = createMockDatabaseProvider();
  const manager = new UnitManager(
    'civ2civ3-oracle-upgrade',
    databaseProvider,
    80,
    50,
    undefined,
    {
      foundCity: async () => 'unused-city',
      requestPath: async () => ({ success: false }),
      broadcastUnitMoved: () => undefined,
      getCityAt: (x, y) =>
        x === 10 && y === 10 ? { id: 'upgrade-city', playerId: 'oracle' } : null,
    },
    new EffectsManager('civ2civ3'),
    Math.random,
    rulesetUnitsService.getUnitTypes('civ2civ3')
  );
  manager.setPlayerTechsProvider(() => new Set(['gunpowder', 'invention']));
  const warrior = await manager.createUnit('oracle', 'warriors', 10, 10);
  warrior.veteranLevel = 2;
  warrior.movementLeft = 3;
  const database = databaseProvider.getDatabase() as any;
  database.where.mockResolvedValueOnce([{ gold: 100 }]);

  const result = await manager.executeUnitAction(
    warrior.id,
    ActionType.UPGRADE_UNIT,
    undefined,
    undefined,
    'oracle'
  );
  const goldSpent = Number(result.message?.match(/for (\d+) gold/)?.[1]);
  if (!result.success || !Number.isFinite(goldSpent)) {
    throw new Error(`Civ2Civ3 upgrade fixture failed: ${result.message ?? 'unknown error'}`);
  }
  return {
    upgrade_action_succeeded: Number(result.success),
    upgrade_is_musketeer: Number(warrior.unitTypeId === 'musketeers'),
    upgrade_veteran_level: warrior.veteranLevel,
    upgrade_gold_spent: goldSpent,
  };
}

describe('Civ2Civ3 Freeciv oracle parity', () => {
  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:1861-1890
   * @assertion A ground defender in a walled city receives the c2c3 city and City Walls Defend_Bonus effects cumulatively.
   * @c2c3-surface combat
   * @c2c3-surface-scenario normal
   */
  it('applies the c2c3 City Walls ground-defense fixture', () => {
    expect(civ2civ3CityWallsGroundDefense()).toBe(150);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3372-3380
   * @reference reference/freeciv/server/unittools.c:238-278
   * @assertion A c2c3 sea combat unit receives Magellan's Expedition's +50 Veteran_Combat effect only through its owning player's wonder.
   * @c2c3-surface combat
   * @c2c3-surface-scenario normal
   */
  it('applies the c2c3 Magellan Veteran_Combat fixture', () => {
    expect(civ2civ3MagellansVeteranCombat()).toBe(50);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:2616-2625
   * @reference reference/freeciv/common/combat.c:499-526
   * @assertion Civ2Civ3's SDI Defense supplies a 100 percent Nuke_Proof effect for a foreign, non-team nuclear attacker and does not protect against its own team.
   * @c2c3-surface combat
   * @c2c3-surface-scenario boundary
   */
  it('applies the c2c3 SDI Nuke_Proof diplomatic requirements', () => {
    const effects = new EffectsManager('civ2civ3');
    const cityContext = { cityBuildings: new Set(['sdi_defense']) };

    expect(
      effects.calculateEffect(EffectType.NUKE_PROOF, {
        ...cityContext,
        diplomaticRelations: new Set(['Foreign']),
      }).value
    ).toBe(100);
    expect(
      effects.calculateEffect(EffectType.NUKE_PROOF, {
        ...cityContext,
        diplomaticRelations: new Set(['Foreign', 'Team']),
      }).value
    ).toBe(0);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:387-405
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:2899-2905
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3544-3550
   * @assertion CivJS evaluates the c2c3 base and Electricity city-vision radii plus the Apollo and Internet player knowledge effects only when their owning player has the required wonder.
   * @c2c3-surface terrain-visibility
   * @c2c3-surface-scenario normal, boundary
   */
  it('applies the c2c3 visibility-effect fixture', () => {
    expect(civ2civ3VisibilityEffects()).toEqual({
      reveal_map_without_apollo: 0,
      reveal_cities_without_internet: 0,
      city_vision_base: 5,
      reveal_map_apollo: 1,
      reveal_cities_internet: 1,
      city_vision_electricity: 10,
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/city.c:1281-1371
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:2831-2857
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3803-3809
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3863-3974
   * @assertion C2C3 evaluates automatic center irrigation and shields, Supermarket farmland output, pollution punishment, Mine output, and inaccessible-tile workability from the active city-and-tile context.
   * @c2c3-surface city-economy
   * @c2c3-surface-scenario normal, boundary
   */
  it('applies the c2c3 city-tile effect fixture', () => {
    expect(civ2civ3CityTileEffects()).toEqual({
      city_center_irrigation_pct: 100,
      city_center_shield_add: 1,
      grassland_tile_workable: 1,
      city_center_supermarket_food_pct: 50,
      city_center_pollution_punish_pct: 50,
      city_center_mining_pct: 100,
      inaccessible_tile_workable: 0,
    });
  });

  it('applies the c2c3 city health-effect fixture', () => {
    expect(civ2civ3HealthEffects()).toEqual({
      health_pct_base: 0,
      health_pct_medicine: 30,
      health_pct_aqueduct: 60,
      health_pct_sewer: 90,
      health_pct_cure: 100,
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/ai/default/daidiplomacy.c:1129-1138
   * @reference reference/freeciv/common/player.h:566
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:57-63
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3041-3048
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3674-3681
   * @assertion CivJS evaluates the target player's C2C3 Gain_AI_Love effects: Eiffel Tower and United Nations grant ten each, Apollo Program suppresses those wonders, and a Cheating AI target grants forty.
   * @c2c3-surface default-ai
   * @c2c3-surface-scenario normal, boundary
   */
  it('applies the c2c3 AI-love effect fixture', () => {
    expect(civ2civ3GainAiLoveEffects()).toEqual({
      gain_ai_love_without_wonder: 0,
      gain_ai_love_eiffel: 10,
      gain_ai_love_united_nations: 10,
      gain_ai_love_apollo: 0,
      gain_ai_love_cheating_ai: 40,
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/tech.c:225-275
   * @reference reference/freeciv/common/tech.c:544-606
   * @reference reference/freeciv/data/civ2civ3/game.ruleset:308-339
   * @assertion CivJS derives the c2c3 base technology costs from Freeciv's recursive Linear formula before player-specific research modifiers.
   * @c2c3-surface research-government
   * @c2c3-surface-scenario normal
   */
  it('applies the c2c3 research base-cost fixture', () => {
    expect(civ2civ3ResearchBaseCosts()).toEqual({
      research_base_cost_alphabet: 10,
      research_base_cost_writing: 20,
      research_base_cost_electricity: 300,
      research_base_cost_advanced_flight: 570,
      research_base_cost_fusion_power: 770,
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/research.c:941-1038
   * @reference reference/freeciv/common/player.c:205-255
   * @reference reference/freeciv/data/civ2civ3/game.ruleset:340-352
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3794-3800
   * @assertion With one known Alphabet held by a player with a real embassy, c2c3 subtracts one third of the Tech_Cost_Factor-adjusted cost from a three-player research game.
   * @c2c3-surface research-government
   * @c2c3-surface-scenario normal
   */
  it('applies the c2c3 embassy Technology Leakage fixture', async () => {
    await expect(civ2civ3EmbassyTechnologyLeakageCost()).resolves.toBe(20);
  });

  const oracle = loadCiv2Civ3OracleResults();

  if (oracle) {
    /**
     * @evidence parity
     * @reference reference/freeciv/common/city.c:1281-1371
     * @reference reference/freeciv/common/scriptcore/api_game_effects.c:116-179
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:2831-2857
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3803-3809
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3863-3974
     * @assertion CivJS and the pinned Freeciv c2c3 server expose identical context-sensitive tile-output and workability effects.
     * @c2c3-surface city-economy
     * @c2c3-surface-scenario differential
     */
    it('matches the batched pinned Freeciv city-tile effects fixture', () => {
      expect(oracle.baseline).toEqual(CIV2CIV3_ORACLE_BASELINE);
      expect(oracle.results).toMatchObject(civ2civ3CityTileEffects());
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/game.ruleset:810-815
     * @reference reference/freeciv/common/map.h:390-431
     * @reference reference/freeciv/server/maphand.c:651-668
     * @assertion CivJS and the pinned Freeciv C2C3 server give a wrapped ISO-hex map corner the same six first-ring neighbors.
     * @c2c3-surface map-generation
     * @c2c3-surface-scenario differential
     */
    it('matches the batched pinned Freeciv map-topology fixture', () => {
      expect(oracle.baseline).toEqual(CIV2CIV3_ORACLE_BASELINE);
      expect(oracle.results).toMatchObject(civ2civ3MapTopology());
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/common/city.c:2849-2918 city_illness_calc()
     * @reference reference/freeciv/common/scriptcore/api_game_effects.c:65-78
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:474-481
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:1751-1757
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:2662-2668
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:2996-3002
     * @assertion CivJS and the pinned Freeciv c2c3 server expose identical accumulated Health_Pct values for Medicine, Aqueduct, Sewer System, and Cure For Cancer.
     * @c2c3-surface random-systems
     * @c2c3-surface-scenario differential
     */
    it('matches the batched pinned Freeciv city-health effects fixture', () => {
      expect(oracle.baseline).toEqual(CIV2CIV3_ORACLE_BASELINE);
      expect(oracle.results).toMatchObject(civ2civ3HealthEffects());
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/common/scriptcore/api_game_effects.c:65-78
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3041-3048
     * @assertion CivJS and the pinned Freeciv c2c3 server expose the same player Gain_AI_Love values before and after Eiffel Tower and Apollo Program.
     * @c2c3-surface default-ai
     * @c2c3-surface-scenario differential
     */
    it('matches the batched pinned Freeciv AI-love effects fixture', () => {
      expect(oracle.baseline).toEqual(CIV2CIV3_ORACLE_BASELINE);
      expect(oracle.results).toMatchObject(civ2civ3GainAiLoveOracleEffects());
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:1861-1890
     * @assertion CivJS and the pinned Freeciv c2c3 server expose the same controlled City Walls ground-defense result.
     * @c2c3-surface combat
     * @c2c3-surface-scenario differential
     */
    it('matches the batched pinned Freeciv City Walls fixture', () => {
      expect(oracle.baseline).toEqual(CIV2CIV3_ORACLE_BASELINE);
      expect(civ2civ3CityWallsGroundDefense()).toBe(oracle.results.city_walls_ground_defense);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3372-3380
     * @reference reference/freeciv/server/unittools.c:238-278
     * @assertion CivJS and the pinned Freeciv c2c3 server expose the same Magellan's Expedition Veteran_Combat bonus for a sea unit.
     * @c2c3-surface combat
     * @c2c3-surface-scenario differential
     */
    it('matches the batched pinned Freeciv Magellan Veteran_Combat fixture', () => {
      expect(oracle.baseline).toEqual(CIV2CIV3_ORACLE_BASELINE);
      expect(civ2civ3MagellansVeteranCombat()).toBe(oracle.results.magellans_veteran_combat);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/game.ruleset:810-815
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:173-187
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:765-770
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:4135-4141
     * @reference reference/freeciv/server/unithand.c:4739-4805
     * @reference reference/freeciv/server/unittools.c:3039-3065
     * @assertion CivJS and the pinned Freeciv c2c3 server both allow a zero-movement Explode Nuclear action and remove the actor and an in-range default ISO-hex neighbor.
     * @c2c3-action Explode Nuclear
     * @c2c3-scenario normal, boundary
     * @c2c3-surface combat
     * @c2c3-surface-scenario differential
     */
    it('matches the batched pinned Freeciv zero-movement self-nuclear fixture', async () => {
      expect(oracle.baseline).toEqual(CIV2CIV3_ORACLE_BASELINE);
      await expect(civ2civ3ZeroMoveSelfNuclear()).resolves.toEqual({
        nuclear_self_action_succeeded: oracle.results.nuclear_self_action_succeeded,
        nuclear_self_origin_units_removed: oracle.results.nuclear_self_origin_units_removed,
        nuclear_self_hex_neighbor_destroyed: oracle.results.nuclear_self_hex_neighbor_destroyed,
      });
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1344-1352
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:4534-4542
     * @reference reference/freeciv/common/unit.c:2199-2217
     * @reference reference/freeciv/server/actiontools.c:64-110
     * @reference reference/freeciv/server/unithand.c:918-941
     * @assertion CivJS and the pinned Freeciv c2c3 server both move a Horsemen passenger off its ocean transport with Transport Disembark 2, remove its transport state, and exhaust the movement required for a follow-up step.
     * @c2c3-action Transport Disembark 2
     * @c2c3-scenario normal
     * @c2c3-surface movement-transport
     * @c2c3-surface-scenario differential
     */
    it('matches the batched pinned Freeciv non-native transport-disembark fixture', async () => {
      expect(oracle.baseline).toEqual(CIV2CIV3_ORACLE_BASELINE);
      await expect(civ2civ3NonNativeTransportDisembark()).resolves.toEqual({
        non_native_disembark_succeeded: oracle.results.non_native_disembark_succeeded,
        non_native_disembark_transported: oracle.results.non_native_disembark_transported,
        non_native_disembark_followup_move_succeeded:
          oracle.results.non_native_disembark_followup_move_succeeded,
      });
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1354-1364
     * @reference reference/freeciv/data/civ2civ3/units.ruleset:913-943
     * @reference reference/freeciv/server/unithand.c:976-1005
     * @assertion CivJS and the pinned Freeciv c2c3 server both let Alpine Troops enter an adjacent Helicopter through Transport Embark and retain the passenger relationship.
     * @c2c3-action Transport Embark
     * @c2c3-scenario normal
     * @c2c3-surface movement-transport
     * @c2c3-surface-scenario differential
     */
    it('matches the batched pinned Freeciv transport-embark fixture', async () => {
      expect(oracle.baseline).toEqual(CIV2CIV3_ORACLE_BASELINE);
      await expect(civ2civ3TransportEmbark()).resolves.toEqual({
        transport_embark_succeeded: oracle.results.transport_embark_succeeded,
        transport_embark_transported: oracle.results.transport_embark_transported,
      });
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1034-1039
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:465-473
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:4618-4625
     * @reference reference/freeciv/common/unittype.c:1757-1771
     * @reference reference/freeciv/server/unittools.c:1558-1597
     * @assertion CivJS and the pinned Freeciv c2c3 server upgrade the same veteran Warrior to Musketeers for the same effect-adjusted price and veteran loss.
     * @c2c3-action Upgrade Unit
     * @c2c3-scenario normal
     * @c2c3-surface cities
     * @c2c3-surface-scenario differential
     */
    it('matches the batched pinned Freeciv Upgrade Unit fixture', async () => {
      expect(oracle.baseline).toEqual(CIV2CIV3_ORACLE_BASELINE);
      await expect(civ2civ3VeteranWarriorUpgrade()).resolves.toEqual({
        upgrade_action_succeeded: oracle.results.upgrade_action_succeeded,
        upgrade_is_musketeer: oracle.results.upgrade_is_musketeer,
        upgrade_veteran_level: oracle.results.upgrade_veteran_level,
        upgrade_gold_spent: oracle.results.upgrade_gold_spent,
      });
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:387-405
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:2899-2905
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3544-3550
     * @assertion CivJS and the pinned Freeciv c2c3 server expose identical player knowledge and city-vision effect values.
     * @c2c3-surface terrain-visibility
     * @c2c3-surface-scenario differential
     */
    it('matches the batched pinned Freeciv visibility-effects fixture', () => {
      expect(oracle.baseline).toEqual(CIV2CIV3_ORACLE_BASELINE);
      expect(oracle.results).toMatchObject(civ2civ3VisibilityEffects());
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:2907-2913
     * @assertion CivJS and the pinned Freeciv c2c3 server agree that Apollo Program enables space construction world-wide.
     * @c2c3-surface victory-space
     * @c2c3-surface-scenario differential
     */
    it('matches the batched pinned Freeciv spaceship-enablement fixture', () => {
      expect(oracle.baseline).toEqual(CIV2CIV3_ORACLE_BASELINE);
      expect(oracle.results).toMatchObject(civ2civ3SpaceshipEffects());
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/common/tech.c:225-275
     * @reference reference/freeciv/common/tech.c:544-606
     * @reference reference/freeciv/data/civ2civ3/game.ruleset:308-339
     * @assertion CivJS and the pinned Freeciv c2c3 server expose the same pre-modifier recursive technology costs.
     * @c2c3-surface research-government
     * @c2c3-surface-scenario differential
     */
    it('matches the batched pinned Freeciv research-cost fixture', () => {
      expect(oracle.baseline).toEqual(CIV2CIV3_ORACLE_BASELINE);
      expect(oracle.results).toMatchObject(civ2civ3ResearchBaseCosts());
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/common/research.c:941-1038
     * @reference reference/freeciv/common/player.c:205-255
     * @reference reference/freeciv/data/civ2civ3/game.ruleset:340-352
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3794-3800
     * @assertion CivJS and the pinned Freeciv c2c3 server calculate the same research cost after a real embassy qualifies a known technology for leakage.
     * @c2c3-surface research-government
     * @c2c3-surface-scenario differential
     */
    it('matches the batched pinned Freeciv embassy Technology Leakage fixture', async () => {
      expect(oracle.baseline).toEqual(CIV2CIV3_ORACLE_BASELINE);
      await expect(civ2civ3EmbassyTechnologyLeakageCost()).resolves.toBe(
        oracle.results.tech_leakage_embassy_cost
      );
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:421-433
     * @reference reference/freeciv/common/actions.c:177-186
     * @reference reference/freeciv/server/diplomats.c:476-541
     * @reference reference/freeciv/server/diplhand.c:696-714
     * @assertion CivJS and the pinned Freeciv c2c3 server both persist a real unilateral embassy after the Diplomat Establish Embassy Stay fixture.
     * @c2c3-surface diplomacy-espionage
     * @c2c3-surface-scenario differential
     */
    it('matches the batched pinned Freeciv Establish Embassy Stay fixture', async () => {
      expect(oracle.baseline).toEqual(CIV2CIV3_ORACLE_BASELINE);
      await expect(civ2civ3EmbassyStayRealEmbassy()).resolves.toBe(
        oracle.results.embassy_stay_real_embassy
      );
    });
  } else {
    it.skip('matches the batched pinned Freeciv city-tile effects fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv map-topology fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv AI-love effects fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv City Walls fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv Magellan Veteran_Combat fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv zero-movement self-nuclear fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv non-native transport-disembark fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv Upgrade Unit fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv visibility-effects fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv spaceship-enablement fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv research-cost fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv embassy Technology Leakage fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv Establish Embassy Stay fixture when an oracle bundle exists', () =>
      undefined);
  }
});
