import { EffectsManager, type EffectContext } from '@game/managers/EffectsManager';
import { CityIllnessService } from '@game/services/CityIllnessService';
import { CityTurnProcessingService } from '@game/services/CityTurnProcessingService';
import type { CityState } from '@game/cities/CityTypes';

function city(overrides: Partial<CityState> = {}): CityState {
  return {
    id: 'ill-city',
    name: 'Ill City',
    x: 2,
    y: 3,
    playerId: 'player-1',
    population: 15,
    size: 15,
    cityRadius: 2,
    founded: 1,
    turnsToComplete: 0,
    history: 0,
    buildings: [],
    specialists: {} as CityState['specialists'],
    tradeRoutes: [],
    happiness: { happy: 0, content: 15, unhappy: 0, angry: 0 },
    worklist: [],
    ...overrides,
  };
}

function effectContext(cityState: CityState, techs: string[] = []): EffectContext {
  return {
    playerId: cityState.playerId,
    cityId: cityState.id,
    cityPopulation: cityState.population,
    cityBuildings: new Set(cityState.buildings),
    playerBuildings: new Set(cityState.buildings),
    playerTechs: new Set(techs),
  };
}

describe('CityIllnessService', () => {
  /**
   * @evidence parity
   * @reference reference/freeciv/common/city.c:2826-2918 city_illness_calc()
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:474-481
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:1751-1757
   * @assertion C2C3 illness accumulates size, recent trade-partner plague, and pollution in tenths of a percent, then applies all active Health_Pct effects with integer truncation.
   * @c2c3-surface random-systems
   * @c2c3-surface-scenario normal, boundary
   */
  it('applies C2C3 Health_Pct after size, trade, and pollution illness', () => {
    const effects = new EffectsManager('civ2civ3');
    const service = new CityIllnessService(effects);
    const source = city({
      id: 'source',
      population: 15,
      pollution: 20,
      tradeRoutes: [{ sourceCity: 'source', partnerCity: 'partner', establishedTurn: 1, value: 1 }],
    });
    const partner = city({ id: 'partner', population: 20, turnPlague: 8 });

    const unprotected = service.calculate(source, [source, partner], 12, effectContext(source));
    expect(unprotected).toMatchObject({
      illnessSize: 63,
      illnessTrade: 8,
      illnessPollution: 10,
      healthPct: 0,
      illness: 81,
    });

    source.buildings = ['aqueduct', 'sewer_system'];
    const protectedCity = service.calculate(
      source,
      [source, partner],
      12,
      effectContext(source, ['medicine'])
    );
    expect(protectedCity).toMatchObject({ healthPct: 90, illness: 8 });
  });

  it('does not calculate any illness component at the C2C3 minimum city size', () => {
    const effects = new EffectsManager('civ2civ3');
    const service = new CityIllnessService(effects);
    const source = city({ id: 'source', population: 5, pollution: 999 });
    const partner = city({ id: 'partner', population: 20, turnPlague: 10 });
    source.tradeRoutes = [
      { sourceCity: 'source', partnerCity: 'partner', establishedTurn: 1, value: 1 },
    ];

    expect(service.calculate(source, [source, partner], 12, effectContext(source))).toMatchObject({
      illness: 0,
      illnessSize: 0,
      illnessTrade: 0,
      illnessPollution: 0,
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/server/cityturn.c:3746-3768
   * @reference reference/freeciv/server/cityturn.c:3885-3895
   * @assertion The city turn resolves illness before food and growth, and stops the remaining city pipeline if the plague removed the city.
   * @c2c3-surface random-systems
   * @c2c3-surface-scenario turn
   */
  it('runs illness before food growth', async () => {
    const cityState = city({ population: 2, size: 2, foodPerTurn: 5 });
    const cities = new Map([[cityState.id, cityState]]);
    const steps: string[] = [];
    const processIllness = jest.fn(async () => {
      steps.push('illness');
      return true;
    });
    const saveCityToDatabase = jest.fn().mockResolvedValue(undefined);
    const service = new CityTurnProcessingService({
      gameId: 'game-1',
      cities,
      callbacks: {},
      effectsManager: new EffectsManager('civ2civ3'),
      refreshCityWithGovernmentEffects: jest.fn(),
      calculateCityOutputs: jest.fn(),
      calculateHappiness: jest.fn(),
      checkPollution: jest.fn().mockResolvedValue(false),
      processIllness,
      reconcileCitizenAssignments: jest.fn().mockResolvedValue(true),
      destroyCity: jest.fn().mockResolvedValue(true),
      saveCityToDatabase,
    });
    jest.spyOn(service, 'processFoodAndGrowth').mockImplementation(async () => {
      steps.push('food');
    });

    await service.processCityTurn(cityState.id, 17);

    expect(processIllness).toHaveBeenCalledWith(cityState.id, 17);
    expect(steps).toEqual(['illness', 'food']);
    expect(saveCityToDatabase).toHaveBeenCalledWith(cityState);
  });

  it('stops the remaining city pipeline when illness removed the city', async () => {
    const cityState = city({ population: 1, size: 1, foodPerTurn: 5 });
    const cities = new Map([[cityState.id, cityState]]);
    const processIllness = jest.fn(async () => {
      cities.delete(cityState.id);
      return false;
    });
    const saveCityToDatabase = jest.fn().mockResolvedValue(undefined);
    const service = new CityTurnProcessingService({
      gameId: 'game-1',
      cities,
      callbacks: {},
      effectsManager: new EffectsManager('civ2civ3'),
      refreshCityWithGovernmentEffects: jest.fn(),
      calculateCityOutputs: jest.fn(),
      calculateHappiness: jest.fn(),
      checkPollution: jest.fn().mockResolvedValue(false),
      processIllness,
      reconcileCitizenAssignments: jest.fn().mockResolvedValue(true),
      destroyCity: jest.fn().mockResolvedValue(true),
      saveCityToDatabase,
    });
    const processFoodAndGrowth = jest.spyOn(service, 'processFoodAndGrowth');

    await service.processCityTurn(cityState.id, 17);

    expect(processIllness).toHaveBeenCalledWith(cityState.id, 17);
    expect(processFoodAndGrowth).not.toHaveBeenCalled();
    expect(saveCityToDatabase).not.toHaveBeenCalled();
  });
});
