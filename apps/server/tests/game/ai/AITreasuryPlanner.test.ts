import { planTreasury } from '@game/ai/AITreasuryPlanner';
import type { CityState } from '@game/managers/CityManager';
import { makeAICity } from '../../fixtures/aiFixtures';

const city = (overrides: Partial<CityState> = {}) =>
  makeAICity({
    id: 'capital',
    buildings: [],
    goldPerTurn: 0,
    foodPerTurn: 2,
    productionType: 'unit',
    currentProduction: 'warriors',
    happiness: { happy: 0, content: 2, unhappy: 0, angry: 0 },
    ...overrides,
  });

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

  /**
   * @evidence parity
   * @reference reference/freeciv/ai/default/daihand.c:494-517
   * @reference reference/freeciv/ai/default/daihand.c:636-649
   * @assertion A strict majority of eligible cities may trigger celebration, while every rate remains valid.
   */
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

  /**
   * @evidence parity
   * @reference reference/freeciv/ai/default/daihand.c:494-517
   * @assertion An exact half of eligible cities must not trigger celebration because Freeciv requires more than half.
   */
  it('requires a strict majority before choosing celebration', () => {
    const eligible = city({
      size: 4,
      foodPerTurn: 2,
      tradePerTurn: 10,
      happiness: { happy: 2, content: 2, unhappy: 0, angry: 0 },
    });
    const plan = planTreasury({
      ...base,
      cities: [eligible, city({ id: 'blocked', size: 2, foodPerTurn: 0 })],
      canRaptureGrow: true,
      maxRate: 60,
    });

    expect(plan.celebrationCityIds).toEqual([]);
    expect(plan.rates.luxury).toBe(0);
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

  /**
   * @evidence parity
   * @reference reference/freeciv/ai/default/daihand.c:240-247
   * @reference reference/freeciv/ai/default/daihand.c:636-649
   * @assertion Tax, luxury, and science rates must stay within the government limit and total 100.
   */
  it('preserves valid constrained tax rates', () => {
    const plan = planTreasury({
      ...base,
      maxRate: 34,
    });

    expect(Object.values(plan.rates).every(rate => rate >= 0 && rate <= 34)).toBe(true);
    expect(plan.rates.tax + plan.rates.luxury + plan.rates.science).toBe(100);
  });

  it('does not celebrate in away mode even when a majority is eligible', () => {
    const celebrant = city({
      size: 5,
      tradePerTurn: 20,
      foodPerTurn: 3,
      happiness: { happy: 3, content: 2, unhappy: 0, angry: 0 },
    });
    const plan = planTreasury({
      ...base,
      cities: [celebrant, { ...celebrant, id: 'second' }],
      canRaptureGrow: true,
      awayMode: true,
    });

    expect(plan.celebrationCityIds).toEqual([]);
    expect(plan.rates.luxury).toBe(0);
  });

  it('sells low-value upkeep before strategically valuable infrastructure', () => {
    const plan = planTreasury({
      ...base,
      currentGold: -60,
      netGold: -10,
      cities: [
        city({
          buildings: ['marketplace', 'granary'],
          foodPerTurn: -1,
          grossTradePerTurn: 12,
          happiness: { happy: 0, content: 1, unhappy: 2, angry: 0 },
        }),
      ],
      buildingTypes: {
        marketplace: {
          id: 'marketplace',
          genus: 'Improvement',
          cost: 20,
          upkeep: 2,
          effects: {},
        } as any,
        granary: {
          id: 'granary',
          genus: 'Improvement',
          cost: 100,
          upkeep: 2,
          effects: {
            foodBonus: 1,
            happinessEffect: 1,
            corruptionReduction: 10,
          },
        } as any,
      },
    });

    expect(plan.sales).toEqual([
      { cityId: 'capital', buildingId: 'marketplace' },
      { cityId: 'capital', buildingId: 'granary' },
    ]);
  });

  it.each([
    {
      name: 'expansion unit',
      city: city({ currentProduction: 'settlers' }),
      unitTypes: {
        ...base.unitTypes,
        settlers: {
          id: 'settlers',
          attack: 0,
          defense: 1,
          combat: 0,
          canFoundCity: true,
        } as any,
      },
    },
    {
      name: 'starvation recovery',
      city: city({ foodPerTurn: -2 }),
      unitTypes: base.unitTypes,
    },
    {
      name: 'strategic building',
      city: city({ productionType: 'building', currentProduction: 'aqueduct', size: 8 }),
      unitTypes: base.unitTypes,
      buildingTypes: {
        aqueduct: {
          id: 'aqueduct',
          genus: 'Improvement',
          cost: 80,
          effects: { maxCitySize: 10 },
        } as any,
      },
    },
  ])('rushes affordable $name production when its benefit repays cost', scenario => {
    const plan = planTreasury({
      ...base,
      currentGold: 500,
      cities: [scenario.city],
      unitTypes: scenario.unitTypes,
      buildingTypes: scenario.buildingTypes ?? {},
      buyCost: () => ({ canBuy: true, goldCost: 20 }),
    });

    expect(plan.rushCityIds).toEqual(['capital']);
  });

  it('ignores unavailable and zero-cost purchases', () => {
    const unavailable = planTreasury({
      ...base,
      currentGold: 500,
      threat: () => 10,
      buyCost: () => ({ canBuy: false, goldCost: 40 }),
    });
    const free = planTreasury({
      ...base,
      currentGold: 500,
      threat: () => 10,
      buyCost: () => ({ canBuy: true, goldCost: 0 }),
    });

    expect(unavailable.rushCityIds).toEqual([]);
    expect(free.rushCityIds).toEqual([]);
  });
});
