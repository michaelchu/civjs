import { rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { UnitProductionValidationService } from '@game/services/UnitProductionValidationService';

describe('UnitProductionValidationService', () => {
  const units = rulesetUnitsService.getUnitTypes('civ2civ3');
  const validator = new UnitProductionValidationService(units);

  const facts = (overrides: Record<string, unknown> = {}) => ({
    playerTechnologies: new Set<string>(),
    localTerrain: 'grassland',
    adjacentTerrains: [],
    ...overrides,
  });

  it('requires a coastal city tile for Transports', () => {
    const transport = units.transport;

    expect(
      validator.canBuildUnit(transport, facts({ playerTechnologies: new Set(['engineering']) }))
    ).toBe(false);
    expect(
      validator.canBuildUnit(
        transport,
        facts({
          playerTechnologies: new Set(['engineering']),
          adjacentTerrains: ['ocean'],
        })
      )
    ).toBe(true);
  });

  it('evaluates Fanatics government and technology requirements', () => {
    const fanatics = units.fanatics;
    const researched = new Set(['guerilla_warfare']);

    expect(
      validator.canBuildUnit(
        fanatics,
        facts({ playerTechnologies: researched, government: 'democracy' })
      )
    ).toBe(false);
    expect(
      validator.canBuildUnit(
        fanatics,
        facts({ playerTechnologies: researched, government: 'fundamentalism' })
      )
    ).toBe(true);
  });

  it('requires the active Enable_Nuke effect for Nuclear production', () => {
    const nuclear = units.nuclear;
    const researched = new Set(['nuclear_fission']);

    expect(validator.canBuildUnit(nuclear, facts({ playerTechnologies: researched }))).toBe(false);
    expect(
      validator.canBuildUnit(nuclear, facts({ playerTechnologies: researched, nukeEnabled: true }))
    ).toBe(true);
  });

  it('does not obsolete a unit until its replacement prerequisites are met', () => {
    expect(validator.canBuildUnit(units.worker, facts())).toBe(true);
    expect(
      validator.canBuildUnit(units.worker, facts({ playerTechnologies: new Set(['explosives']) }))
    ).toBe(false);
  });

  it('supports resource requirements when a ruleset declares them', () => {
    const resourceUnit = {
      ...units.warriors,
      buildRequirements: [{ type: 'Good', name: 'Iron', range: 'City', present: true }],
    };

    expect(validator.canBuildUnit(resourceUnit, facts())).toBe(false);
    expect(validator.canBuildUnit(resourceUnit, facts({ cityGoods: new Set(['iron']) }))).toBe(
      true
    );
  });
});
