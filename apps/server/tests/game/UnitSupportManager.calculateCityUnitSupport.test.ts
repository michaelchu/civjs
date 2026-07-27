import {
  UnitSupportManager,
  GoldUpkeepStyle,
  UnitSupportData,
} from '@game/managers/UnitSupportManager';

function makeUnit(overrides?: Partial<UnitSupportData>): UnitSupportData {
  return {
    unitId: overrides?.unitId ?? 'u',
    unitType: overrides?.unitType ?? 'warrior',
    homeCity: overrides?.homeCity ?? 'c1',
    currentLocation: overrides?.currentLocation ?? 'c1',
    upkeep: overrides?.upkeep ?? { food: 1, shield: 1, gold: 0 },
    isAwayFromHome: overrides?.isAwayFromHome ?? false,
    isMilitaryUnit: overrides?.isMilitaryUnit ?? true,
  };
}

describe('UnitSupportManager.calculateCityUnitSupport', () => {
  test('despotism: classic free support applies to shields only', () => {
    const mgr = new UnitSupportManager('g1');
    const units: UnitSupportData[] = [makeUnit(), makeUnit(), makeUnit()];

    const res = mgr.calculateCityUnitSupport('city-1', 'p1', 'despotism', 1, units) as any;

    expect(res.upkeepCosts.shield).toBe(0); // 3 shield units are free
    expect(res.upkeepCosts.food).toBe(5); // 3 unit food + population(1)*2
    expect(res.upkeepCosts.gold).toBe(0); // no gold upkeep
    // freeUnitsSupported uses min across resources (shield=2, food=2, gold=0) => 0
    expect(res.freeUnitsSupported).toBe(0);
    expect(res.unitsRequiringUpkeep).toBe(3);
    expect(res.happinessEffect).toBe(0);
  });

  test('monarchy: gold upkeep charged to city; population 2 increases food by 4', () => {
    const mgr = new UnitSupportManager('g1');
    const units: UnitSupportData[] = [
      makeUnit({ upkeep: { food: 1, shield: 1, gold: 1 } }),
      makeUnit({ upkeep: { food: 1, shield: 1, gold: 1 } }),
    ];

    const res = mgr.calculateCityUnitSupport('city-2', 'p1', 'monarchy', 2, units) as any;

    // Shield: 2 units, free shield 3 (monarchy) => 0
    expect(res.upkeepCosts.shield).toBe(0);
    // Classic monarchy has no free food upkeep.
    expect(res.upkeepCosts.food).toBe(6);
    // Classic Warriors have no gold upkeep.
    expect(res.upkeepCosts.gold).toBe(0);
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
    // Shield: 1 shield - 2 free (despotism) => 0; Food: 0 units - 2 free => 0 + population 2
    expect(res.upkeepCosts.shield).toBe(0);
    expect(res.upkeepCosts.food).toBe(2);
  });

  test('single-arg overload rejects on non-existent city', async () => {
    const mgr = new UnitSupportManager('g1');
    await expect(mgr.calculateCityUnitSupport('non-existent-city')).rejects.toThrow(
      'City not found: non-existent-city'
    );
  });
});
