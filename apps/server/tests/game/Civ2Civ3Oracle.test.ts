import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
import { loadRulesetTechnologies } from '@game/managers/ResearchManager';
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

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

  const oracleConfigured = [
    process.env.FREECIV_ORACLE_BIN,
    process.env.FREECIV_ORACLE_DATA,
    process.env.FREECIV_ORACLE_SOURCE,
  ].every(Boolean);

  if (oracleConfigured) {
    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:1861-1890
     * @assertion CivJS and the pinned Freeciv c2c3 server expose the same controlled City Walls ground-defense result.
     * @c2c3-surface combat
     * @c2c3-surface-scenario differential
     */
    it('matches the pinned Freeciv server scenario', () => {
      const repositoryRoot = resolve(process.cwd(), '..', '..');
      const output = execFileSync(
        process.execPath,
        [resolve(repositoryRoot, 'tools/run-freeciv-oracle.mjs'), '--scenario=civ2civ3-city-walls'],
        { encoding: 'utf8', env: process.env }
      );
      const oracle = JSON.parse(output) as {
        baseline: { commit: string; version: string };
        results: Record<string, number>;
      };

      expect(oracle.baseline).toEqual({
        version: '3.3.90.5-dev',
        commit: '440b3c9650d3052792296868cb15591bd40612ea',
      });
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
    it('matches the pinned Freeciv research-cost scenario', () => {
      const repositoryRoot = resolve(process.cwd(), '..', '..');
      const output = execFileSync(
        process.execPath,
        [
          resolve(repositoryRoot, 'tools/run-freeciv-oracle.mjs'),
          '--scenario=civ2civ3-research-cost',
        ],
        { encoding: 'utf8', env: process.env }
      );
      const oracle = JSON.parse(output) as {
        baseline: { commit: string; version: string };
        results: Record<string, number>;
      };

      expect(oracle.baseline).toEqual({
        version: '3.3.90.5-dev',
        commit: '440b3c9650d3052792296868cb15591bd40612ea',
      });
      expect(civ2civ3ResearchBaseCosts()).toEqual(oracle.results);
    });
  } else {
    it.skip('matches the pinned Freeciv server scenario when the oracle is configured', () =>
      undefined);
    it.skip('matches the pinned Freeciv research-cost scenario when the oracle is configured', () =>
      undefined);
  }
});
