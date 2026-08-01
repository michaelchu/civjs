/**
 * @reference reference/freeciv/server/citytools.c:924-950 raze_city()
 * @reference reference/freeciv/server/citytools.c:2037-2061 size-one conquest
 * @reference reference/freeciv/server/citytools.c:2135-2142 population loss
 */
import { CityCaptureService } from '@game/services/CityCaptureService';
import type { CityState } from '@game/managers/CityManager';

function capturedCity(population: number): CityState {
  return {
    id: 'city-1',
    name: 'Target',
    playerId: 'old-player',
    x: 5,
    y: 5,
    population,
    size: population,
    cityRadius: 2,
    founded: 1,
    currentProduction: 'warriors',
    productionType: 'unit',
    productionStock: 12,
    turnsToComplete: 2,
    history: 0,
    buildings: ['palace', 'granary', 'great_library'],
    specialists: { 0: 1 } as CityState['specialists'],
    tradeRoutes: [],
    happiness: { happy: 0, content: population, unhappy: 0, angry: 0 },
    worklist: [],
  };
}

const buildings = {
  getBuildingTypes: () =>
    ({
      palace: { genus: 'SmallWonder' },
      granary: { genus: 'Improvement' },
      great_library: { genus: 'GreatWonder' },
    }) as any,
};

describe('CityCaptureService classic conquest', () => {
  it('loses one citizen, removes small wonders, razes improvements, and preserves great wonders', async () => {
    const city = capturedCity(4);
    const updateRoutes = jest.fn().mockResolvedValue(undefined);
    const reconcileCitizenAssignments = jest.fn().mockResolvedValue(true);
    const service = new CityCaptureService(
      new Map([[city.id, city]]),
      updateRoutes,
      buildings as any,
      () => 0,
      undefined,
      reconcileCitizenAssignments
    );

    await expect(service.captureCity(city.id, 'new-player', 'unit-1')).resolves.toEqual({
      success: true,
      populationLoss: 1,
      buildingsDestroyed: ['palace', 'granary'],
      cityDestroyed: false,
    });
    expect(city.playerId).toBe('new-player');
    expect(city.population).toBe(3);
    expect(city.buildings).toEqual(['great_library']);
    expect(city.productionStock).toBe(0);
    expect(city.currentProduction).toBe('warriors');
    expect(city.specialists).toEqual({ 0: 1 });
    expect(updateRoutes).toHaveBeenCalledWith(city.id, 'new-player', 'old-player');
    expect(reconcileCitizenAssignments).toHaveBeenCalledWith(city.id, 'conquest');
  });

  it('rolls capture back when citizen reconciliation fails', async () => {
    const city = capturedCity(4);
    const reconcileCitizenAssignments = jest.fn().mockResolvedValue(false);
    const service = new CityCaptureService(
      new Map([[city.id, city]]),
      jest.fn().mockResolvedValue(undefined),
      buildings as any,
      () => 0,
      undefined,
      reconcileCitizenAssignments
    );

    await expect(service.captureCity(city.id, 'new-player', 'unit-1')).resolves.toEqual({
      success: false,
      populationLoss: 0,
      buildingsDestroyed: [],
      reason: 'Capture operation failed',
    });
    expect(city.playerId).toBe('old-player');
    expect(city.population).toBe(4);
    expect(city.size).toBe(4);
    expect(city.buildings).toEqual(['palace', 'granary', 'great_library']);
  });

  it('signals authoritative destruction for a size-one city without partially transferring it', async () => {
    const city = capturedCity(1);
    const service = new CityCaptureService(
      new Map([[city.id, city]]),
      jest.fn(),
      buildings as any,
      () => 0
    );

    await expect(service.captureCity(city.id, 'new-player', 'unit-1')).resolves.toEqual({
      success: true,
      populationLoss: 1,
      buildingsDestroyed: ['palace', 'granary', 'great_library'],
      cityDestroyed: true,
    });
    expect(city.playerId).toBe('old-player');
    expect(city.population).toBe(1);
  });

  it('rolls back city mutations when route transfer fails', async () => {
    const city = capturedCity(4);
    const service = new CityCaptureService(
      new Map([[city.id, city]]),
      jest.fn().mockRejectedValue(new Error('route failure')),
      buildings as any,
      () => 0
    );

    await expect(service.captureCity(city.id, 'new-player', 'unit-1')).resolves.toEqual({
      success: false,
      populationLoss: 0,
      buildingsDestroyed: [],
      reason: 'Capture operation failed',
    });
    expect(city.playerId).toBe('old-player');
    expect(city.population).toBe(4);
    expect(city.buildings).toEqual(['palace', 'granary', 'great_library']);
    expect(city.productionStock).toBe(12);
  });
});
