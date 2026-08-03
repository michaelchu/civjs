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
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';
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
  onComplete: jest.Mock = jest.fn(),
  unitTypes = rulesetUnitsService.getUnitTypes(),
  reconcileCitizenAssignments: jest.Mock = jest.fn().mockResolvedValue(true),
  onGameplayEvent: jest.Mock = jest.fn(),
  effectsManager: EffectsManager = new EffectsManager()
): CityTurnProcessingService {
  const dependencies: CityTurnProcessingDependencies = {
    gameId: 'game-1',
    cities: new Map([[cityState.id, cityState]]),
    callbacks: { onCityProductionComplete: onComplete },
    onGameplayEvent,
    effectsManager,
    unitTypes,
    refreshCityWithGovernmentEffects: jest.fn(),
    calculateCityOutputs: jest.fn(),
    calculateHappiness: jest.fn(),
    reconcileCitizenAssignments,
    destroyCity: jest.fn().mockResolvedValue(true),
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
      reconcileCitizenAssignments: jest.fn().mockResolvedValue(true),
      destroyCity: jest.fn().mockResolvedValue(true),
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

  /**
   * @evidence parity
   * @reference reference/freeciv/common/actions.c:829-833
   * @reference reference/freeciv/server/cityturn.c:2681-2683
   * @assertion C2C3 production completes a building through the internal Finish Building lifecycle and carries excess shields into the next production target.
   * @c2c3-internal-action Finish Building
   * @c2c3-internal-scenario normal
   * @c2c3-surface cities
   * @c2c3-surface-scenario normal, turn
   */
  it('retains excess shields after completing a building', async () => {
    const cityState = city({
      currentProduction: 'granary',
      productionType: 'building',
      productionStock: 38,
      productionPerTurn: 5,
    });
    const onComplete = jest.fn().mockResolvedValue(undefined);

    await turnService(
      cityState,
      onComplete,
      rulesetUnitsService.getUnitTypes('civ2civ3'),
      undefined,
      undefined,
      new EffectsManager('civ2civ3')
    ).processCityTurn(cityState.id, 7);

    expect(cityState.buildings).toContain('granary');
    expect(cityState.currentProduction).toBeNull();
    expect(cityState.productionStock).toBe(3);
    expect(cityState.shieldStock).toBe(3);
    expect(onComplete).toHaveBeenCalledWith(
      cityState,
      expect.objectContaining({ kind: 'building', value: 'granary' })
    );
  });

  it('publishes a gameplay event after production completion callbacks finish', async () => {
    const cityState = city({
      currentProduction: 'granary',
      productionType: 'building',
      productionStock: 38,
      productionPerTurn: 5,
    });
    const onComplete = jest.fn().mockResolvedValue(undefined);
    const onGameplayEvent = jest.fn();

    await turnService(cityState, onComplete, undefined, undefined, onGameplayEvent).processCityTurn(
      cityState.id,
      7
    );

    expect(onGameplayEvent).toHaveBeenCalledWith({
      type: 'production_completed',
      city: cityState,
      item: { kind: 'building', value: 'granary' },
    });
    expect(onComplete.mock.invocationCallOrder[0]).toBeLessThan(
      onGameplayEvent.mock.invocationCallOrder[0]
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/actions.c:829-833
   * @reference reference/freeciv/server/cityturn.c:2784-2786
   * @assertion C2C3 production completes a unit through the internal Finish Unit lifecycle and carries excess shields into the next production target.
   * @c2c3-internal-action Finish Unit
   * @c2c3-internal-scenario normal
   * @c2c3-surface cities
   * @c2c3-surface-scenario normal, turn
   */
  it('retains excess shields after completing a unit', async () => {
    const cityState = city({
      currentProduction: 'warriors',
      productionType: 'unit',
      productionStock: 9,
      productionPerTurn: 5,
    });

    await turnService(
      cityState,
      undefined,
      rulesetUnitsService.getUnitTypes('civ2civ3'),
      undefined,
      undefined,
      new EffectsManager('civ2civ3')
    ).processCityTurn(cityState.id, 7);

    expect(cityState.currentProduction).toBeNull();
    expect(cityState.productionStock).toBe(4);
    expect(cityState.shieldStock).toBe(4);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/actions.c:829-833
   * @reference reference/freeciv/server/cityturn.c:2681-2683
   * @assertion A C2C3 building completes exactly at its shield cost with no carryover.
   * @c2c3-internal-action Finish Building
   * @c2c3-internal-scenario boundary
   * @c2c3-surface cities
   * @c2c3-surface-scenario boundary
   */
  it('completes a C2C3 building exactly at its shield boundary', async () => {
    const cityState = city({
      currentProduction: 'granary',
      productionType: 'building',
      productionStock: 39,
      productionPerTurn: 1,
    });

    await turnService(
      cityState,
      undefined,
      rulesetUnitsService.getUnitTypes('civ2civ3'),
      undefined,
      undefined,
      new EffectsManager('civ2civ3')
    ).processCityTurn(cityState.id, 7);

    expect(cityState.currentProduction).toBeNull();
    expect(cityState.productionStock).toBe(0);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/actions.c:829-833
   * @reference reference/freeciv/server/cityturn.c:2681-2683
   * @assertion A C2C3 building one shield short remains in production rather than completing.
   * @c2c3-internal-action Finish Building
   * @c2c3-internal-scenario rejected
   * @c2c3-surface cities
   * @c2c3-surface-scenario boundary
   */
  it('does not finish a C2C3 building below its shield cost', async () => {
    const cityState = city({
      currentProduction: 'granary',
      productionType: 'building',
      productionStock: 38,
      productionPerTurn: 1,
    });

    await turnService(
      cityState,
      undefined,
      rulesetUnitsService.getUnitTypes('civ2civ3'),
      undefined,
      undefined,
      new EffectsManager('civ2civ3')
    ).processCityTurn(cityState.id, 7);

    expect(cityState.currentProduction).toBe('granary');
    expect(cityState.productionStock).toBe(39);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/actions.c:829-833
   * @reference reference/freeciv/server/cityturn.c:2784-2786
   * @assertion A C2C3 unit completes exactly at its shield boundary with no carryover.
   * @c2c3-internal-action Finish Unit
   * @c2c3-internal-scenario boundary
   * @c2c3-surface cities
   * @c2c3-surface-scenario boundary
   */
  it('completes a C2C3 unit exactly at its shield boundary', async () => {
    const cityState = city({
      currentProduction: 'warriors',
      productionType: 'unit',
      productionStock: 9,
      productionPerTurn: 1,
    });

    await turnService(
      cityState,
      undefined,
      rulesetUnitsService.getUnitTypes('civ2civ3'),
      undefined,
      undefined,
      new EffectsManager('civ2civ3')
    ).processCityTurn(cityState.id, 7);

    expect(cityState.currentProduction).toBeNull();
    expect(cityState.productionStock).toBe(0);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/actions.c:829-833
   * @reference reference/freeciv/server/cityturn.c:2784-2786
   * @assertion A C2C3 unit one shield short remains in production rather than completing.
   * @c2c3-internal-action Finish Unit
   * @c2c3-internal-scenario rejected
   * @c2c3-surface cities
   * @c2c3-surface-scenario boundary
   */
  it('does not finish a C2C3 unit below its shield cost', async () => {
    const cityState = city({
      currentProduction: 'warriors',
      productionType: 'unit',
      productionStock: 8,
      productionPerTurn: 1,
    });

    await turnService(
      cityState,
      undefined,
      rulesetUnitsService.getUnitTypes('civ2civ3'),
      undefined,
      undefined,
      new EffectsManager('civ2civ3')
    ).processCityTurn(cityState.id, 7);

    expect(cityState.currentProduction).toBe('warriors');
    expect(cityState.productionStock).toBe(9);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/city.c:747-801
   * @reference reference/freeciv/server/cityturn.c:3004-3062
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3811-3827
   * @assertion A C2C3 Manufacturing Plant grants two unit build slots, consuming two same-unit worklist entries and twenty shields in one turn without spilling into the following Granary.
   * @c2c3-internal-action Finish Unit
   * @c2c3-internal-scenario normal
   * @c2c3-surface cities
   * @c2c3-surface-scenario turn
   */
  it('uses C2C3 Manufacturing Plant unit build slots only for matching unit worklist entries', async () => {
    const cityState = city({
      currentProduction: 'warriors',
      productionType: 'unit',
      productionStock: 20,
      productionPerTurn: 0,
      buildings: ['mfg_plant'],
      worklist: [
        { kind: 'unit', value: 'warriors' },
        { kind: 'building', value: 'granary' },
      ],
    });
    const onComplete = jest.fn();

    await turnService(
      cityState,
      onComplete,
      rulesetUnitsService.getUnitTypes('civ2civ3'),
      undefined,
      undefined,
      new EffectsManager('civ2civ3')
    ).processCityTurn(cityState.id, 7);

    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete.mock.calls.map(([, completed]) => completed.value)).toEqual([
      'warriors',
      'warriors',
    ]);
    expect(cityState.productionStock).toBe(0);
    expect(cityState.currentProduction).toBe('granary');
    expect(cityState.worklist).toEqual([]);
  });

  it('converts Wealth production without accumulating or completing shields', async () => {
    const cityState = city({
      currentProduction: 'capitalization',
      productionType: 'building',
      productionStock: 80,
      shieldStock: 80,
      productionPerTurn: 5,
      turnsToComplete: 16,
    });

    await turnService(cityState).processCityTurn(cityState.id, 7);

    expect(cityState.currentProduction).toBe('capitalization');
    expect(cityState.productionType).toBe('building');
    expect(cityState.productionStock).toBe(0);
    expect(cityState.shieldStock).toBe(0);
    expect(cityState.turnsToComplete).toBe(0);
  });

  it('reconstructs a missing production type for a persisted active target', async () => {
    const cityState = city({
      currentProduction: 'warriors',
      productionType: null,
      productionStock: 0,
      productionPerTurn: 1,
    });

    await turnService(cityState).processCityTurn(cityState.id, 7);

    expect(cityState.productionType).toBe('unit');
    expect(cityState.currentProduction).toBe('warriors');
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

  it('keeps a civ2civ3 settler ready until the city can pay its population cost', async () => {
    const civ2civ3Units = rulesetUnitsService.getUnitTypes('civ2civ3');
    const onComplete = jest.fn();
    const blocked = city({
      population: 2,
      size: 2,
      currentProduction: 'settlers',
      productionType: 'unit',
      productionStock: civ2civ3Units.settlers!.cost - 1,
      productionPerTurn: 2,
    });

    await turnService(blocked, onComplete, civ2civ3Units).processCityTurn(blocked.id, 7);

    expect(blocked.population).toBe(2);
    expect(blocked.currentProduction).toBe('settlers');
    expect(blocked.productionStock).toBe(civ2civ3Units.settlers!.cost + 1);
    expect(onComplete).not.toHaveBeenCalled();

    blocked.population = 3;
    blocked.size = 3;
    await turnService(blocked, onComplete, civ2civ3Units).processCityTurn(blocked.id, 8);

    expect(blocked.population).toBe(1);
    expect(blocked.currentProduction).toBeNull();
    expect(onComplete).toHaveBeenCalledWith(
      blocked,
      expect.objectContaining({ kind: 'unit', value: 'settlers' })
    );
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
    const wealthCity = city({
      id: 'wealth-city',
      currentProduction: 'capitalization',
      productionType: 'building',
    });
    const service = new CityProductionService(
      new Map([
        [buildingCity.id, buildingCity],
        [unitCity.id, unitCity],
        [wealthCity.id, wealthCity],
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
    expect(service.calculateBuyCost(wealthCity.id)).toEqual({
      canBuy: false,
      goldCost: 0,
      shieldsRemaining: 0,
      reason: 'Wealth is an ongoing conversion and cannot be rushed',
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
