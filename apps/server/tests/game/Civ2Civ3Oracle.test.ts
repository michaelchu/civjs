import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
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
    it.skip('matches the batched pinned Freeciv City Walls fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv Magellan Veteran_Combat fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv zero-movement self-nuclear fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv visibility-effects fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv research-cost fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv embassy Technology Leakage fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv Establish Embassy Stay fixture when an oracle bundle exists', () =>
      undefined);
  }
});
