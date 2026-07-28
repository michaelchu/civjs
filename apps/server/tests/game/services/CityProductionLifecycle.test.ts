/**
 * @reference reference/freeciv/server/cityturn.c:2681-2683
 * @reference reference/freeciv/server/cityturn.c:2784-2786
 * @reference reference/freeciv/server/cityturn.c:3054-3062
 * @reference reference/freeciv/server/cityhand.c:348-356
 * @reference reference/freeciv/common/improvement.c:306-326
 * @reference reference/freeciv/common/unittype.c:1517-1537
 */
import { BUILDING_TYPES, type CityState } from '@game/managers/CityManager';
import { EffectsManager } from '@game/managers/EffectsManager';
import { CityProductionService } from '@game/services/CityProductionService';
import {
  CityTurnProcessingService,
  type CityTurnProcessingDependencies,
} from '@game/services/CityTurnProcessingService';

function city(overrides: Partial<CityState> = {}): CityState {
  return {
    id: 'production-city',
    name: 'Production City',
    x: 2,
    y: 3,
    playerId: 'player-1',
    population: 2,
    size: 2,
    cityRadius: 2,
    founded: 1,
    currentProduction: null,
    productionType: null,
    turnsToComplete: 0,
    productionStock: 0,
    foodStock: 0,
    foodPerTurn: 0,
    productionPerTurn: 0,
    tradePerTurn: 0,
    sciencePerTurn: 0,
    history: 0,
    buildings: [],
    specialists: {} as CityState['specialists'],
    tradeRoutes: [],
    happiness: { happy: 0, content: 2, unhappy: 0, angry: 0 },
    worklist: [],
    defenseStrength: 1,
    ...overrides,
  };
}

function turnService(
  cityState: CityState,
  onComplete: jest.Mock = jest.fn()
): CityTurnProcessingService {
  const dependencies: CityTurnProcessingDependencies = {
    gameId: 'game-1',
    cities: new Map([[cityState.id, cityState]]),
    callbacks: { onCityProductionComplete: onComplete },
    effectsManager: new EffectsManager(),
    refreshCityWithGovernmentEffects: jest.fn(),
    calculateCityOutputs: jest.fn(),
    calculateHappiness: jest.fn(),
    checkPollution: jest.fn().mockResolvedValue(false),
    saveCityToDatabase: jest.fn().mockResolvedValue(undefined),
  };

  return new CityTurnProcessingService(dependencies);
}

describe('city production lifecycle', () => {
  it('suppresses surplus production while a city is in civil disorder', async () => {
    const cityState = city({
      currentProduction: 'warriors',
      productionType: 'unit',
      foodPerTurn: 3,
      productionPerTurn: 4,
      sciencePerTurn: 2,
      goldPerTurn: 1,
      happiness: { happy: 0, content: 0, unhappy: 1, angry: 0 },
    });
    const onTurn = jest.fn();
    const service = new CityTurnProcessingService({
      gameId: 'game-1',
      cities: new Map([[cityState.id, cityState]]),
      callbacks: { onCityTurnProcessed: onTurn },
      effectsManager: new EffectsManager(),
      refreshCityWithGovernmentEffects: jest.fn(),
      calculateCityOutputs: jest.fn(),
      calculateHappiness: jest.fn(),
      applyCityHappiness: jest.fn(),
      getPlayerGovernment: () => 'despotism',
      checkPollution: jest.fn().mockResolvedValue(false),
      saveCityToDatabase: jest.fn().mockResolvedValue(undefined),
    });

    await service.processCityTurn(cityState.id, 1);

    expect(cityState.foodStock).toBe(0);
    expect(cityState.productionStock).toBe(0);
    expect(cityState.sciencePerTurn).toBe(0);
    expect(cityState.goldPerTurn).toBe(0);
    expect(onTurn).toHaveBeenCalledWith(cityState);
  });

  it('retains excess shields after completing a building', async () => {
    const cityState = city({
      currentProduction: 'granary',
      productionType: 'building',
      productionStock: 38,
      productionPerTurn: 5,
    });
    const onComplete = jest.fn().mockResolvedValue(undefined);

    await turnService(cityState, onComplete).processCityTurn(cityState.id, 7);

    expect(cityState.buildings).toContain('granary');
    expect(cityState.currentProduction).toBeNull();
    expect(cityState.productionStock).toBe(3);
    expect(cityState.shieldStock).toBe(3);
    expect(onComplete).toHaveBeenCalledWith(
      cityState,
      expect.objectContaining({ kind: 'building', value: 'granary' })
    );
  });

  it('retains excess shields after completing a unit', async () => {
    const cityState = city({
      currentProduction: 'warriors',
      productionType: 'unit',
      productionStock: 9,
      productionPerTurn: 5,
    });

    await turnService(cityState).processCityTurn(cityState.id, 7);

    expect(cityState.currentProduction).toBeNull();
    expect(cityState.productionStock).toBe(4);
    expect(cityState.shieldStock).toBe(4);
  });

  it('advances to and removes the next authoritative worklist item', async () => {
    const cityState = city({
      currentProduction: 'warriors',
      productionType: 'unit',
      productionStock: 9,
      productionPerTurn: 2,
      worklist: [
        { kind: 'building', value: 'granary' },
        { kind: 'unit', value: 'explorer' },
      ],
    });

    await turnService(cityState).processCityTurn(cityState.id, 7);

    expect(cityState.currentProduction).toBe('granary');
    expect(cityState.productionType).toBe('building');
    expect(cityState.worklist).toEqual([{ kind: 'unit', value: 'explorer' }]);
    expect(cityState.productionStock).toBe(1);
  });

  it('recovers an idle city by promoting its first valid worklist item', async () => {
    const cityState = city({
      currentProduction: null,
      productionType: null,
      productionPerTurn: 3,
      worklist: [{ kind: 'building', value: 'granary' }],
    });

    await turnService(cityState).processCityTurn(cityState.id, 7);

    expect(cityState.currentProduction).toBe('granary');
    expect(cityState.productionType).toBe('building');
    expect(cityState.worklist).toEqual([]);
    expect(cityState.productionStock).toBe(3);
  });

  it('charges unit population cost without consuming the final citizen', async () => {
    const completed = city({
      population: 2,
      size: 2,
      currentProduction: 'settlers',
      productionType: 'unit',
      productionStock: 39,
      productionPerTurn: 2,
    });
    await turnService(completed).processCityTurn(completed.id, 7);
    expect(completed.population).toBe(1);
    expect(completed.currentProduction).toBeNull();

    const blocked = city({
      population: 1,
      size: 1,
      currentProduction: 'settlers',
      productionType: 'unit',
      productionStock: 40,
      productionPerTurn: 2,
    });
    const onComplete = jest.fn();
    await turnService(blocked, onComplete).processCityTurn(blocked.id, 7);
    expect(blocked.population).toBe(1);
    expect(blocked.currentProduction).toBe('settlers');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('uses Freeciv rush premiums and the authoritative production stock', () => {
    const buildingCity = city({
      currentProduction: 'granary',
      productionType: 'building',
    });
    const unitCity = city({
      id: 'unit-city',
      currentProduction: 'warriors',
      productionType: 'unit',
    });
    const service = new CityProductionService(
      new Map([
        [buildingCity.id, buildingCity],
        [unitCity.id, unitCity],
      ]),
      BUILDING_TYPES,
      async () => 1_000,
      jest.fn().mockResolvedValue(true)
    );

    expect(service.calculateBuyCost(buildingCity.id)).toEqual({
      canBuy: true,
      goldCost: 160,
      shieldsRemaining: 40,
    });
    expect(service.calculateBuyCost(unitCity.id)).toEqual({
      canBuy: true,
      goldCost: 50,
      shieldsRemaining: 10,
    });

    buildingCity.productionStock = 10;
    expect(service.calculateBuyCost(buildingCity.id).goldCost).toBe(60);
  });

  it('rush buying fills the stock consumed by turn processing', async () => {
    const cityState = city({
      currentProduction: 'warriors',
      productionType: 'unit',
      productionStock: 4,
    });
    const spendGold = jest.fn().mockResolvedValue(true);
    const service = new CityProductionService(
      new Map([[cityState.id, cityState]]),
      BUILDING_TYPES,
      async () => 100,
      spendGold
    );

    await expect(service.buyProduction(cityState.id, cityState.playerId)).resolves.toEqual({
      success: true,
      goldSpent: 13,
      completed: true,
    });
    expect(cityState.productionStock).toBe(10);
    expect(cityState.shieldStock).toBe(10);
    expect(spendGold).toHaveBeenCalledWith(cityState.playerId, 13);
  });
});
