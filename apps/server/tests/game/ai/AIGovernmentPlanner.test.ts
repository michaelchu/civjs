import { chooseGovernment, rankGovernments } from '@game/ai/AIGovernmentPlanner';
import { EffectType, OutputType } from '@game/managers/EffectsManager';

const city = {
  id: 'capital',
  foodPerTurn: 4,
  productionPerTurn: 4,
  tradePerTurn: 4,
  goldPerTurn: 2,
  sciencePerTurn: 3,
  happiness: { happy: 1, content: 2, unhappy: 0, angry: 0 },
} as any;

describe('Freeciv AI government planner', () => {
  it('chooses an effect-driven upgrade that repays anarchy', () => {
    const choice = chooseGovernment({
      currentGovernmentId: 'despotism',
      availableGovernmentIds: ['despotism', 'republic'],
      cities: [city, { ...city, id: 'second' }],
      units: [],
      atWar: false,
      effect: (government, type, output) =>
        government === 'republic' && type === EffectType.OUTPUT_BONUS && output === OutputType.TRADE
          ? 100
          : 0,
      expectedRevolutionTurns: 1,
      planningHorizon: 20,
    });
    expect(choice?.governmentId).toBe('republic');
    expect(choice!.netGain).toBeGreaterThan(choice!.revolutionCost);
  });

  it('stays put when anarchy costs exceed the long-term gain', () => {
    const choice = chooseGovernment({
      currentGovernmentId: 'despotism',
      availableGovernmentIds: ['despotism', 'monarchy'],
      cities: [city],
      units: [],
      atWar: false,
      effect: (government, type) =>
        government === 'monarchy' && type === EffectType.MAKE_CONTENT ? 1 : 0,
      expectedRevolutionTurns: 5,
      planningHorizon: 2,
    });
    expect(choice).toBeUndefined();
  });

  it('penalizes wartime governments with unit unhappiness', () => {
    const units = Array.from({ length: 8 }, (_, index) => ({ id: `${index}` })) as any;
    const effect = (government: string, type: EffectType) => {
      if (government === 'republic' && type === EffectType.OUTPUT_BONUS) return 20;
      if (government === 'republic' && type === EffectType.UNHAPPY_FACTOR) return 10;
      return 0;
    };
    const peace = chooseGovernment({
      currentGovernmentId: 'monarchy',
      availableGovernmentIds: ['monarchy', 'republic'],
      cities: [city],
      units,
      atWar: false,
      effect,
      expectedRevolutionTurns: 0,
    });
    const war = chooseGovernment({
      currentGovernmentId: 'monarchy',
      availableGovernmentIds: ['monarchy', 'republic'],
      cities: [city],
      units,
      atWar: true,
      effect,
      expectedRevolutionTurns: 0,
    });
    expect(peace?.governmentId).toBe('republic');
    expect(war).toBeUndefined();
  });

  it('amortizes future governments by exact prerequisite distance without revolting early', () => {
    const context = {
      currentGovernmentId: 'despotism',
      availableGovernmentIds: ['despotism', 'republic'],
      cities: [city],
      units: [],
      atWar: false,
      effect: (government: string, type: EffectType, output?: OutputType) =>
        government === 'republic' && type === EffectType.OUTPUT_BONUS && output === OutputType.TRADE
          ? 100
          : 0,
      expectedRevolutionTurns: 0,
    };
    const immediate = rankGovernments({ ...context, researchDistance: () => 0 })[0];
    const future = rankGovernments({
      ...context,
      researchDistance: government => (government === 'republic' ? 4 : 0),
    })[0];

    expect(future.value).toBeLessThan(immediate.value);
    expect(
      chooseGovernment({
        ...context,
        researchDistance: government => (government === 'republic' ? 4 : 0),
      })
    ).toBeUndefined();
  });
});
