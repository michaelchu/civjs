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

  it('uses rate-limited luxury when a majority can grow by celebration', () => {
    const celebrant = city({
      size: 4,
      foodPerTurn: 2,
      tradePerTurn: 10,
      happiness: { happy: 2, content: 2, unhappy: 0, angry: 0 },
    });
    const plan = planTreasury({
      ...base,
      cities: [
        celebrant,
        { ...celebrant, id: 'second' },
        city({ id: 'blocked', size: 2, foodPerTurn: 0 }),
      ],
      canRaptureGrow: true,
      maxRate: 60,
    });

    expect(plan.celebrationCityIds).toEqual(['capital', 'second']);
    expect(plan.rates.luxury).toBe(60);
    expect(Math.max(...Object.values(plan.rates))).toBeLessThanOrEqual(60);
    expect(plan.rates.tax + plan.rates.luxury + plan.rates.science).toBe(100);
  });

  it('persists an unaffordable rush target and raises tax until it is funded', () => {
    const waiting = planTreasury({
      ...base,
      currentGold: 50,
      atWar: true,
      threat: () => 5,
      buyCost: () => ({ canBuy: true, goldCost: 100 }),
    });
    expect(waiting.rushCityIds).toEqual([]);
    expect(waiting.savingsGoal).toEqual({
      cityId: 'capital',
      amount: waiting.reserve + 100,
      reason: 'rush warriors',
    });

    const saving = planTreasury({
      ...base,
      currentGold: 80,
      atWar: true,
      threat: () => 5,
      buyCost: () => ({ canBuy: true, goldCost: 100 }),
      existingSavingsGoal: waiting.savingsGoal,
    });
    expect(saving.rates.tax).toBe(60);
    expect(saving.savingsGoal?.cityId).toBe('capital');

    const funded = planTreasury({
      ...base,
      currentGold: 500,
      atWar: true,
      threat: () => 5,
      buyCost: () => ({ canBuy: true, goldCost: 100 }),
      existingSavingsGoal: waiting.savingsGoal,
    });
    expect(funded.rushCityIds).toEqual(['capital']);
    expect(funded.savingsGoal).toBeUndefined();
  });
});
