import {
  amortize,
  chooseCityProduction,
  chooseResearch,
  rankCitySites,
  rankMilitaryTargets,
} from '@game/ai/FreecivAIPlanner';

const city = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'capital',
    name: 'Capital',
    x: 2,
    y: 2,
    playerId: 'ai',
    population: 3,
    size: 3,
    cityRadius: 2,
    founded: 0,
    turnsToComplete: 0,
    productionPerTurn: 5,
    goldPerTurn: 1,
    foodPerTurn: 2,
    history: 0,
    buildings: [],
    specialists: {},
    tradeRoutes: [],
    happiness: { happy: 0, content: 3, unhappy: 0, angry: 0 },
    worklist: [],
    ...overrides,
  }) as any;

const unit = (id: string, unitTypeId: string, overrides: Record<string, unknown> = {}) =>
  ({
    id,
    gameId: 'game',
    playerId: 'ai',
    unitTypeId,
    x: 2,
    y: 2,
    movementLeft: 3,
    health: 100,
    veteranLevel: 0,
    experience: 0,
    fortified: false,
    ...overrides,
  }) as any;

describe('Freeciv AI want planner', () => {
  it('discounts delayed benefit using Freeciv MORT', () => {
    expect(amortize(100, 0)).toBe(100);
    expect(amortize(100, 10)).toBeLessThan(100);
    expect(amortize(100, 20)).toBeLessThan(amortize(100, 10));
  });

  it('requisitions a defender when a threatened city is undefended', () => {
    const choice = chooseCityProduction({
      city: city({ defenseStrength: 0 }),
      cities: [city()],
      units: [],
      nearbyEnemyStrength: 8,
      unitTypes: {
        settler: {
          id: 'settler',
          name: 'Settler',
          cost: 40,
          movement: 3,
          combat: 0,
          range: 1,
          sight: 2,
          visionLayer: 'Main',
          canFoundCity: true,
          canBuildImprovements: true,
          unitClass: 'civilian',
          rulesetUnitClassFlags: [],
          cargoClasses: [],
          bombardRate: 0,
          paratroopersRange: 0,
        },
        defender: {
          id: 'defender',
          name: 'Defender',
          cost: 20,
          movement: 3,
          combat: 1,
          attack: 1,
          defense: 4,
          range: 1,
          sight: 2,
          visionLayer: 'Main',
          canFoundCity: false,
          canBuildImprovements: false,
          unitClass: 'military',
          rulesetUnitClassFlags: [],
          cargoClasses: [],
          bombardRate: 0,
          paratroopersRange: 0,
        },
      },
      buildingTypes: {},
      canBuild: () => true,
    });

    expect(choice?.value).toEqual({ kind: 'unit', id: 'defender' });
    expect(choice?.reason).toContain('defense');
  });

  it('prefers a useful unlock over the cheapest technology', () => {
    const cheap = {
      id: 'cheap',
      name: 'Cheap',
      cost: 10,
      requirements: [],
      flags: [],
    };
    const useful = {
      id: 'useful',
      name: 'Useful',
      cost: 30,
      requirements: [],
      flags: [],
    };
    const choice = chooseResearch({
      available: [cheap, useful],
      catalogue: [cheap, useful],
      unitTypes: {
        strong_unit: {
          id: 'strong_unit',
          name: 'Strong',
          cost: 40,
          movement: 6,
          combat: 6,
          attack: 6,
          defense: 4,
          range: 1,
          sight: 2,
          visionLayer: 'Main',
          canFoundCity: false,
          canBuildImprovements: false,
          unitClass: 'military',
          rulesetUnitClassFlags: [],
          requiredTech: 'useful',
          cargoClasses: [],
          bombardRate: 0,
          paratroopersRange: 0,
        },
      },
      buildingTypes: {},
      governmentTechs: new Set(),
      militaryPressure: 1,
      cityCount: 2,
    });

    expect(choice?.value.id).toBe('useful');
    expect(choice?.reason).toContain('unit:strong_unit');
  });

  it('ranks profitable vulnerable targets ahead of expensive fights', () => {
    const attacker = unit('attacker', 'attacker');
    const worker = unit('worker', 'worker', { playerId: 'enemy', x: 4, y: 2 });
    const defender = unit('defender', 'defender', { playerId: 'enemy', x: 3, y: 2 });
    const types: Record<string, any> = {
      attacker: { id: 'attacker', cost: 20, attack: 4, defense: 2, combat: 4, movement: 3 },
      worker: {
        id: 'worker',
        cost: 40,
        attack: 0,
        defense: 1,
        combat: 0,
        movement: 3,
        canBuildImprovements: true,
      },
      defender: { id: 'defender', cost: 20, attack: 2, defense: 8, combat: 2, movement: 3 },
    };

    const ranked = rankMilitaryTargets(
      attacker,
      types.attacker,
      [defender, worker],
      id => types[id],
      target => Math.abs(target.x - attacker.x)
    );

    expect(ranked[0].unit.id).toBe('worker');
  });

  it('ranks productive city sites while discounting danger and travel', () => {
    const poor = {
      x: 1,
      y: 1,
      terrain: 'desert',
      resource: undefined,
    } as any;
    const rich = {
      x: 3,
      y: 1,
      terrain: 'grassland',
      resource: 'wheat',
    } as any;
    const dangerous = {
      x: 2,
      y: 1,
      terrain: 'grassland',
      resource: 'wheat',
    } as any;
    const yields: Record<string, { food: number; shields: number; trade: number }> = {
      desert: { food: 0, shields: 1, trade: 0 },
      grassland: { food: 2, shields: 1, trade: 1 },
    };

    const ranked = rankCitySites(
      [poor, dangerous, rich],
      () => [],
      terrain => yields[terrain],
      tile => tile.x,
      () => 6,
      tile => (tile === dangerous ? 4 : 0)
    );

    expect(ranked[0].tile).toBe(rich);
  });
});
