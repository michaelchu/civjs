import { SpecialistType, type CityState } from '@game/managers/CityManager';
import type { Unit } from '@game/managers/UnitManager';
import { TemperatureType, type MapTile, type TerrainType } from '@game/map/MapTypes';

export function makeAIUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'unit',
    gameId: 'game',
    playerId: 'ai',
    unitTypeId: 'warriors',
    x: 0,
    y: 0,
    movementLeft: 3,
    health: 100,
    veteranLevel: 0,
    experience: 0,
    fortified: false,
    ...overrides,
  };
}

export function makeAICity(overrides: Partial<CityState> = {}): CityState {
  return {
    id: 'city',
    name: 'City',
    x: 0,
    y: 0,
    playerId: 'ai',
    population: 3,
    size: 3,
    cityRadius: 2,
    founded: 0,
    turnsToComplete: 0,
    currentProduction: null,
    productionType: null,
    buildings: [],
    specialists: {
      [SpecialistType.SCIENTIST]: 0,
      [SpecialistType.TAX_COLLECTOR]: 0,
      [SpecialistType.ENTERTAINER]: 0,
      [SpecialistType.WORKER]: 0,
      [SpecialistType.ENGINEER]: 0,
      [SpecialistType.MERCHANT]: 0,
    },
    tradeRoutes: [],
    happiness: { happy: 0, content: 3, unhappy: 0, angry: 0 },
    worklist: [],
    history: 0,
    ...overrides,
  };
}

export function makeAITile(
  overrides: Partial<MapTile> & Pick<MapTile, 'x' | 'y'> = { x: 0, y: 0 }
): MapTile {
  const { x, y, ...rest } = overrides;
  return {
    x,
    y,
    terrain: 'grassland',
    riverMask: 0,
    elevation: 0,
    continentId: 1,
    isExplored: true,
    isVisible: true,
    hasRoad: false,
    hasRailroad: false,
    improvements: [],
    unitIds: [],
    properties: {},
    temperature: TemperatureType.TEMPERATE,
    wetness: 50,
    ...rest,
  };
}

export function makeTerrainTile(
  x: number,
  y: number,
  terrain: TerrainType = 'grassland',
  overrides: Omit<Partial<MapTile>, 'x' | 'y' | 'terrain'> = {}
): MapTile {
  return makeAITile({ x, y, terrain, ...overrides });
}
