import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
import { DiplomacyManager } from '@game/managers/DiplomacyManager';
import { loadRulesetTechnologies, ResearchManager } from '@game/managers/ResearchManager';
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
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
    it.skip('matches the batched pinned Freeciv research-cost fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv embassy Technology Leakage fixture when an oracle bundle exists', () =>
      undefined);
    it.skip('matches the batched pinned Freeciv Establish Embassy Stay fixture when an oracle bundle exists', () =>
      undefined);
  }
});
