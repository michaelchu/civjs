import {
  UnitSupportManager,
  GoldUpkeepStyle,
  UnitSupportData,
} from '@game/managers/UnitSupportManager';
import { EffectsManager } from '@game/managers/EffectsManager';

function makeUnit(overrides?: Partial<UnitSupportData>): UnitSupportData {
  return {
    unitId: overrides?.unitId ?? 'u',
    unitType: overrides?.unitType ?? 'warrior',
    unitTypeFlags: overrides?.unitTypeFlags,
    homeCity: overrides?.homeCity ?? 'c1',
    currentLocation: overrides?.currentLocation ?? 'c1',
    upkeep: overrides?.upkeep ?? { food: 1, shield: 1, gold: 0 },
    isAwayFromHome: overrides?.isAwayFromHome ?? false,
    isMilitaryUnit: overrides?.isMilitaryUnit ?? true,
    isFieldUnit: overrides?.isFieldUnit ?? false,
  };
}

describe('UnitSupportManager.calculateCityUnitSupport', () => {
  test('C2C3 Despotism applies food support before citizen consumption', () => {
    const mgr = new UnitSupportManager('g1');
    const units: UnitSupportData[] = [makeUnit(), makeUnit(), makeUnit()];

    const res = mgr.calculateCityUnitSupport('city-1', 'p1', 'despotism', 1, units) as any;

    // C2C3's Despotism free-unit effect applies to gold, not shield upkeep.
    // @reference reference/freeciv/data/civ2civ3/effects.ruleset:921-928
    expect(res.upkeepCosts.shield).toBe(3);
    expect(res.upkeepCosts.food).toBe(2); // Four C2C3 free food slots cover all three units.
    expect(res.upkeepCosts.gold).toBe(0); // Mixed C2C3 gold upkeep is national.
    // freeUnitsSupported uses min across resources (shield=2, food=2, gold=0) => 0
    expect(res.freeUnitsSupported).toBe(0);
    expect(res.unitsRequiringUpkeep).toBe(3);
    expect(res.happinessEffect).toBe(0);
  });

  test('C2C3 Monarchy applies its food support and mixed gold upkeep', () => {
    const mgr = new UnitSupportManager('g1');
    const units: UnitSupportData[] = [
      makeUnit({ upkeep: { food: 1, shield: 1, gold: 1 } }),
      makeUnit({ upkeep: { food: 1, shield: 1, gold: 1 } }),
    ];

    const res = mgr.calculateCityUnitSupport('city-2', 'p1', 'monarchy', 2, units) as any;

    // C2C3 Monarchy has no shield-free support effect.
    expect(res.upkeepCosts.shield).toBe(2);
    // The base four free food slots cover both units, leaving population consumption only.
    expect(res.upkeepCosts.food).toBe(4);
    // Mixed C2C3 gold upkeep is paid nationally.
    expect(res.upkeepCosts.gold).toBe(0);
  });

  test('C2C3 adds a free food support slot at city size five', () => {
    const mgr = new UnitSupportManager('g1');
    const units = Array.from({ length: 5 }, (_, index) =>
      makeUnit({ unitId: `u-${index}`, upkeep: { food: 1, shield: 0, gold: 0 } })
    );

    const res = mgr.calculateCityUnitSupport('city-5', 'p1', 'despotism', 5, units) as any;

    // C2C3 supplies four base food-support slots and one more at size five.
    expect(res.upkeepCosts.food).toBe(10);
  });

  test('republic: the first military unhappiness point is made content', () => {
    const mgr = new UnitSupportManager('g1');
    const units: UnitSupportData[] = [
      makeUnit({ isAwayFromHome: true }),
      makeUnit({ isAwayFromHome: true }),
    ];

    const res = mgr.calculateCityUnitSupport('city-3', 'p1', 'republic', 1, units) as any;

    expect(res.happinessEffect).toBe(1);
  });

  test('field units cause war unhappiness even while stationed at home', () => {
    const mgr = new UnitSupportManager('g1');
    const units: UnitSupportData[] = [
      makeUnit({ isFieldUnit: true }),
      makeUnit({ isFieldUnit: true }),
    ];

    const res = mgr.calculateCityUnitSupport('city-field', 'p1', 'republic', 1, units) as any;

    expect(res.happinessEffect).toBe(1);
  });

  test('nation gold upkeep style: city does not pay gold upkeep', () => {
    const mgr = new UnitSupportManager('g1');
    mgr.setGoldUpkeepStyle(GoldUpkeepStyle.NATION);

    const units: UnitSupportData[] = [
      makeUnit({ upkeep: { food: 0, shield: 0, gold: 2 } }),
      makeUnit({ upkeep: { food: 0, shield: 1, gold: 1 } }),
    ];

    const res = mgr.calculateCityUnitSupport('city-4', 'p1', 'despotism', 1, units) as any;

    // City should not pay any gold upkeep
    expect(res.upkeepCosts.gold).toBe(0);
    // Shield has no Despotism free-support effect; Food is citizen consumption only.
    expect(res.upkeepCosts.shield).toBe(1);
    expect(res.upkeepCosts.food).toBe(2);
  });

  test('mixed gold upkeep style: city does not pay unit gold upkeep', () => {
    const mgr = new UnitSupportManager('g1', new EffectsManager('civ2civ3'));
    const unit = makeUnit({ upkeep: { food: 0, shield: 0, gold: 2 } });

    const res = mgr.calculateCityUnitSupport('city-mixed', 'p1', 'despotism', 1, [unit]) as any;

    expect(res.upkeepCosts.gold).toBe(0);
  });

  test('C2C3 Fundamentalism gives Fanatic-flagged units zero upkeep', () => {
    const mgr = new UnitSupportManager('g1', new EffectsManager('civ2civ3'));
    const fanatic = makeUnit({
      unitType: 'fanatics',
      unitTypeFlags: new Set(['Fanatic']),
      upkeep: { food: 0, shield: 0, gold: 2 },
    });
    const regular = makeUnit({
      unitType: 'warriors',
      upkeep: { food: 0, shield: 0, gold: 2 },
    });
    const fanatics = Array.from({ length: 5 }, (_, index) => ({
      ...fanatic,
      unitId: `fanatic-${index}`,
    }));
    const regulars = Array.from({ length: 5 }, (_, index) => ({
      ...regular,
      unitId: `regular-${index}`,
    }));

    mgr.setGoldUpkeepStyle(GoldUpkeepStyle.CITY);
    const fundamentalism = mgr.calculateCityUnitSupport(
      'fanatic-city',
      'p1',
      'fundamentalism',
      1,
      fanatics
    ) as any;
    const regularFundamentalism = mgr.calculateCityUnitSupport(
      'fanatic-city',
      'p1',
      'fundamentalism',
      1,
      regulars
    ) as any;

    // @reference reference/freeciv/common/unittype.c:152-156 utype_upkeep_cost()
    // @reference reference/freeciv/data/civ2civ3/effects.ruleset:1670-1676
    expect(fundamentalism.upkeepCosts.gold).toBe(0);
    expect(regularFundamentalism.upkeepCosts.gold).toBeGreaterThan(0);

    mgr.setGoldUpkeepStyle(GoldUpkeepStyle.NATION);
    expect(mgr.calculateNationalUnitSupport('p1', 'fundamentalism', [fanatic]).gold).toBe(0);
    expect(mgr.calculateNationalUnitSupport('p1', 'republic', [fanatic]).gold).toBeGreaterThan(0);
  });

  test('single-arg overload rejects on non-existent city', async () => {
    const mgr = new UnitSupportManager('g1');
    await expect(mgr.calculateCityUnitSupport('non-existent-city')).rejects.toThrow(
      'City not found: non-existent-city'
    );
  });
});
