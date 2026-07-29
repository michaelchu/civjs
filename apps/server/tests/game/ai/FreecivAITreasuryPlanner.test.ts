import { planTreasury } from '@game/ai/FreecivAITreasuryPlanner';

const city = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'capital',
    buildings: [],
    goldPerTurn: 0,
    foodPerTurn: 2,
    productionType: 'unit',
    currentProduction: 'warriors',
    happiness: { happy: 0, content: 2, unhappy: 0, angry: 0 },
    ...overrides,
  }) as any;

const base = {
  currentGold: 100,
  netGold: 0,
  cities: [city()],
  unitCount: 2,
  atWar: false,
  unitTypes: {
    warriors: { id: 'warriors', attack: 1, defense: 1, combat: 1 } as any,
  },
  buildingTypes: {},
  buyCost: () => ({ canBuy: true, goldCost: 40 }),
  threat: () => 0,
};

describe('Freeciv AI treasury planner', () => {
  it('maintains a larger reserve during war and deficit', () => {
    const peace = planTreasury(base);
    const war = planTreasury({ ...base, atWar: true, netGold: -10 });
    expect(war.reserve).toBeGreaterThan(peace.reserve);
    expect(war.rates.tax).toBe(60);
  });

  it('rushes urgent affordable defense without spending the reserve', () => {
    const plan = planTreasury({
      ...base,
      currentGold: 500,
      atWar: true,
      unitTypes: {
        warriors: { id: 'warriors', attack: 3, defense: 5, combat: 3 } as any,
      },
      threat: () => 5,
    });
    expect(plan.rushCityIds).toEqual(['capital']);
    expect(500 - 40).toBeGreaterThan(plan.reserve);
  });

  it('sells upkeep buildings to escape insolvency but protects the palace', () => {
    const plan = planTreasury({
      ...base,
      currentGold: 0,
      netGold: -8,
      cities: [city({ buildings: ['palace', 'barracks'] })],
      buildingTypes: {
        palace: { id: 'palace', genus: 'Improvement', cost: 100, upkeep: 1 } as any,
        barracks: { id: 'barracks', genus: 'Improvement', cost: 40, upkeep: 2 } as any,
      },
    });
    expect(plan.sales).toEqual([{ cityId: 'capital', buildingId: 'barracks' }]);
    expect(plan.rushCityIds).toEqual([]);
  });

  it('allocates luxury tax when cities are unhappy', () => {
    const plan = planTreasury({
      ...base,
      cities: [
        city({
          happiness: { happy: 0, content: 1, unhappy: 2, angry: 0 },
        }),
      ],
    });
    expect(plan.rates.luxury).toBe(10);
    expect(plan.rates.tax + plan.rates.luxury + plan.rates.science).toBe(100);
  });
});
