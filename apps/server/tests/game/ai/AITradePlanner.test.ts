import { ActionType } from '@app-types/shared/actions';
import { planCaravanTrade } from '@game/ai/AITradePlanner';
import { makeAICity, makeAIUnit } from '../../fixtures/aiFixtures';

describe('Freeciv caravan trade planner', () => {
  const home = makeAICity({
    id: 'home',
    playerId: 'ai',
    x: 0,
    y: 0,
    tradePerTurn: 4,
    tradeRoutes: [],
  });
  const caravan = makeAIUnit({
    id: 'caravan',
    playerId: 'ai',
    unitTypeId: 'caravan',
    homeCityId: home.id,
    x: 0,
    y: 0,
  });
  const type = {
    id: 'caravan',
    movement: 1,
    flags: ['HelpWonder', 'NonMil'],
  } as any;

  it('selects the highest discounted non-war route and records ferry demand', () => {
    const near = makeAICity({
      id: 'near',
      playerId: 'ally',
      x: 3,
      y: 0,
      tradePerTurn: 4,
    });
    const valuable = makeAICity({
      id: 'valuable',
      playerId: 'ally',
      x: 6,
      y: 0,
      tradePerTurn: 8,
    });
    const plan = planCaravanTrade({
      units: [caravan],
      cities: [home, near, valuable],
      getCity: id => (id === home.id ? home : undefined),
      getType: () => type,
      canTradeWith: () => true,
      distance: (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
      continent: x => (x < 5 ? 1 : 2),
      tradeValue: (_source, target) => (target === valuable.id ? 8 : 2),
    });

    expect(plan[0]).toMatchObject({
      targetCity: { id: 'valuable' },
      action: ActionType.TRADE_ROUTE,
      requiresTransport: true,
    });
  });

  it('falls back to marketplace value and excludes hostile destinations', () => {
    const peaceful = makeAICity({
      id: 'peaceful',
      playerId: 'peace',
      x: 4,
      y: 0,
      tradePerTurn: 6,
    });
    const hostile = makeAICity({
      id: 'hostile',
      playerId: 'enemy',
      x: 1,
      y: 0,
      tradePerTurn: 20,
    });
    const plan = planCaravanTrade({
      units: [caravan],
      cities: [home, peaceful, hostile],
      getCity: id => (id === home.id ? home : undefined),
      getType: () => type,
      canTradeWith: owner => owner !== 'enemy',
      distance: (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
      continent: () => 1,
      tradeValue: () => 0,
    });

    expect(plan[0]).toMatchObject({
      targetCity: { id: 'peaceful' },
      action: ActionType.MARKETPLACE,
    });
  });
});
