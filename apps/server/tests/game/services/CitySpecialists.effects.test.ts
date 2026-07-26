/**
 * @reference reference/freeciv/data/classic/effects.ruleset:92-118
 * @reference reference/freeciv/data/classic/cities.ruleset:47-91
 */
import {
  CityCalculationService,
  SpecialistType,
  type CityPlayerContext,
  type CityState,
} from '@game/services/CityCalculationService';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { Effect } from '@shared/data/rulesets/schemas';

function city(specialists: Record<number, number>): CityState {
  return {
    id: 'city-1',
    name: 'Test City',
    x: 0,
    y: 0,
    playerId: 'player-1',
    population: 6,
    size: 6,
    cityRadius: 2,
    founded: 1,
    turnsToComplete: 0,
    history: 0,
    buildings: [],
    specialists,
    tradeRoutes: [],
    happiness: { happy: 0, content: 6, unhappy: 0, angry: 0 },
    worklist: [],
  };
}

function context(cityState: CityState): CityPlayerContext {
  return {
    government: 'communism',
    playerTechs: new Set(),
    playerBuildings: new Set(),
    playerCities: [cityState],
  };
}

function outputs(manager: EffectsManager, cityState: CityState) {
  return new CityCalculationService(manager).calculateCityOutputs(
    cityState,
    { food: 0, shields: 0, trade: 0 },
    undefined,
    context(cityState)
  );
}

function managerWith(effects: Record<string, Effect>): EffectsManager {
  const spy = jest.spyOn(rulesetLoader, 'getEffects').mockReturnValue(effects);
  try {
    const manager = new EffectsManager();
    manager.calculateEffect(EffectType.SPECIALIST_OUTPUT, {});
    return manager;
  } finally {
    spy.mockRestore();
  }
}

describe('specialist output from loaded effects', () => {
  it('uses the classic rule names and values', () => {
    const cityState = city({
      [SpecialistType.SCIENTIST]: 1,
      [SpecialistType.TAX_COLLECTOR]: 1,
      [SpecialistType.ENTERTAINER]: 1,
    });

    const result = outputs(new EffectsManager(), cityState);

    expect(result.science).toBe(3);
    expect(result.gold).toBe(3);
    expect(result.luxury).toBe(2);
  });

  it('keeps unsupported CivJS specialists inert', () => {
    const cityState = city({
      [SpecialistType.WORKER]: 2,
      [SpecialistType.ENGINEER]: 2,
      [SpecialistType.MERCHANT]: 2,
    });

    const result = outputs(new EffectsManager(), cityState);
    const baseline = outputs(new EffectsManager(), city({}));

    expect(result).toEqual(baseline);
  });

  it('changes authoritative output when Specialist_Output changes', () => {
    const cityState = city({ [SpecialistType.SCIENTIST]: 2 });
    const specialistEffect = (value: number): Effect => ({
      id: 'scientist',
      type: 'Specialist_Output',
      value,
      reqs: [
        { type: 'Specialist', name: 'scientist', range: 'Local' },
        { type: 'OutputType', name: 'science', range: 'Local' },
      ],
    });

    expect(outputs(managerWith({ scientist: specialistEffect(3) }), cityState).science).toBe(6);
    expect(outputs(managerWith({ scientist: specialistEffect(7) }), cityState).science).toBe(14);
  });
});
