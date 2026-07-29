import { planWonderCoordination } from '@game/ai/FreecivAIWonderPlanner';

const city = (id: string, overrides: Record<string, unknown> = {}) =>
  ({
    id,
    x: 0,
    y: 0,
    productionPerTurn: 10,
    buildings: [],
    ...overrides,
  }) as any;

const helper = (id: string, x: number, y: number) =>
  ({
    id,
    playerId: 'ai',
    unitTypeId: 'caravan',
    x,
    y,
  }) as any;

const unitTypes = {
  caravan: {
    id: 'caravan',
    cost: 50,
    movement: 1,
    flags: ['HelpWonder'],
    requiredTech: 'trade',
  },
} as any;

const buildingTypes = {
  pyramids: {
    id: 'pyramids',
    genus: 'GreatWonder',
    cost: 200,
    effects: {},
  },
} as any;

describe('Freeciv AI wonder coordination planner', () => {
  it('requisitions only the missing helper shields from the best support city', () => {
    const plan = planWonderCoordination({
      cities: [
        city('wonder', {
          currentProduction: 'pyramids',
          productionType: 'building',
          productionStock: 50,
        }),
        city('near', { x: 2 }),
        city('far', { x: 8, currentProduction: 'caravan', productionType: 'unit' }),
      ],
      units: [helper('existing', 1, 0)],
      unitTypes,
      buildingTypes,
      canBuild: () => true,
      distance: (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
    });

    expect(plan.assignments).toHaveLength(1);
    expect([...plan.productionWants.keys()]).toEqual(['near']);
    expect(plan.productionWants.get('near')?.get('caravan')).toBeGreaterThan(0);
  });

  it('holds delivered helpers until they can finish the wonder together', () => {
    const context = {
      cities: [
        city('wonder', {
          currentProduction: 'pyramids',
          productionType: 'building',
          productionStock: 100,
        }),
      ],
      unitTypes,
      buildingTypes,
      canBuild: () => false,
      distance: () => 0,
    };

    expect(
      planWonderCoordination({ ...context, units: [helper('first', 0, 0)] }).releaseHelpers
    ).toBe(false);
    expect(
      planWonderCoordination({
        ...context,
        units: [helper('first', 0, 0), helper('second', 0, 0)],
      }).releaseHelpers
    ).toBe(true);
  });

  it('raises the helper prerequisite when no support city can build one', () => {
    const plan = planWonderCoordination({
      cities: [
        city('wonder', {
          currentProduction: 'pyramids',
          productionType: 'building',
          productionStock: 0,
        }),
        city('support', { x: 2 }),
      ],
      units: [],
      unitTypes,
      buildingTypes,
      canBuild: () => false,
      distance: () => 2,
    });

    expect(plan.technologyWants.get('trade')).toBe(200);
  });
});
