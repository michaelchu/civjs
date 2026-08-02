import {
  getInitialRulesetSettings,
  resolveInitialTechnologyIds,
  resolveStartingUnitTypeIds,
  selectRandomInitialTechnology,
} from '@game/services/RulesetInitialSetupService';
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';

describe('RulesetInitialSetupService', () => {
  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/game.ruleset:810-827
   * @reference reference/freeciv/common/game.h:387-396
   * @assertion Civ2Civ3 explicitly replaces Freeciv's default start-unit string with cwsx and grants one random starting technology.
   * @c2c3-surface research-government
   * @c2c3-surface-scenario normal
   */
  it('loads the C2C3 start-unit and initial-technology settings from the source ruleset', () => {
    expect(getInitialRulesetSettings('civ2civ3')).toEqual({
      startUnits: 'cwsx',
      techLevel: 1,
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/server/gamehand.c:112-190
   * @reference reference/freeciv/common/unittype.c:1951-1962
   * @reference reference/freeciv/common/unittype.c:2348-2369
   * @reference reference/freeciv/data/civ2civ3/game.ruleset:810-827
   * @assertion C2C3's cwsx roles resolve to Settlers, Workers, Diplomats, and Explorers even before their optional build technologies are known, because Freeciv falls back to the first non-unique role unit.
   * @c2c3-surface map-generation
   * @c2c3-surface-scenario normal
   */
  it('resolves C2C3 cwsx roles with the source fallback for unavailable specialists', () => {
    const settings = getInitialRulesetSettings('civ2civ3');
    const unitTypes = rulesetUnitsService.getUnitTypes('civ2civ3');

    expect(
      resolveStartingUnitTypeIds(settings.startUnits, unitTypes, { playerTechs: new Set() })
    ).toEqual(['settlers', 'worker', 'diplomat', 'explorer']);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/unittype.c:2100-2118
   * @reference reference/freeciv/common/unittype.c:2348-2369
   * @reference reference/freeciv/data/civ2civ3/units.ruleset:606-647
   * @reference reference/freeciv/data/civ2civ3/units.ruleset:2402-2568
   * @assertion Once advanced role candidates are buildable, Freeciv's start-role resolver replaces obsolete Workers and Diplomats with Engineers and Spies.
   * @c2c3-surface map-generation
   * @c2c3-surface-scenario boundary
   */
  it('selects buildable non-obsolete role units before using the fallback', () => {
    const unitTypes = rulesetUnitsService.getUnitTypes('civ2civ3');

    expect(
      resolveStartingUnitTypeIds('cwsx', unitTypes, {
        playerTechs: new Set(['alphabet', 'espionage', 'explosives', 'seafaring']),
      })
    ).toEqual(['settlers', 'engineers', 'spy', 'explorer']);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/server/techtools.c:939-958
   * @reference reference/freeciv/common/tech.h:242-258
   * @assertion Initial random technology selection uses Freeciv advance IDs and reservoir sampling rather than converted JSON key order.
   * @c2c3-surface research-government
   * @c2c3-surface-scenario boundary
   */
  it('selects initial technologies in source advance order with reservoir sampling', () => {
    const calls: number[] = [];
    const random = {
      next: (size: number) => {
        calls.push(size);
        return size === 1 ? 0 : size - 1;
      },
    };
    const technologies = {
      later: { id: 'later', name: 'Later', freeciv_id: 9, requirements: [] },
      first: { id: 'first', name: 'First', freeciv_id: 1, requirements: [] },
      blocked: {
        id: 'blocked',
        name: 'Blocked',
        freeciv_id: 5,
        requirements: ['first'],
      },
    } as any;

    expect(selectRandomInitialTechnology(technologies, new Set(), random)).toBe('first');
    expect(calls).toEqual([1, 2]);

    calls.length = 0;
    expect(selectRandomInitialTechnology(technologies, new Set(['first']), random)).toBe('blocked');
    expect(calls).toEqual([1, 2]);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/server/techtools.c:1188-1225
   * @reference reference/freeciv/data/civ2civ3/game.ruleset:810-827
   * @assertion A C2C3 player receives exactly one source-selected root technology before the first research target is chosen.
   * @c2c3-surface research-government
   * @c2c3-surface-scenario normal
   */
  it('resolves the C2C3 techlevel grant before research begins', () => {
    const random = { next: (size: number) => (size === 1 ? 0 : size - 1) };

    expect(resolveInitialTechnologyIds('civ2civ3', 'french', random)).toEqual(['alphabet']);
  });
});
