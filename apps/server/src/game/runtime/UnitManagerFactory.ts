/**
 * @module server/game/runtime/UnitManagerFactory
 * Defines Unit Manager Factory game runtime wiring.
 */
import type { DatabaseProvider } from '@database';
import type { CityManager } from '@game/managers/CityManager';
import type { EffectsManager } from '@game/managers/EffectsManager';
import type { MapManager } from '@game/managers/MapManager';
import type { ResearchManager } from '@game/managers/ResearchManager';
import { UnitManager, type UnitManagerCallbacks } from '@game/managers/UnitManager';
import type { FreecivIdentityAllocator } from '@game/random/FreecivIdentityAllocator';
import type { RandomSource } from '@game/random/FreecivRandom';
import type { UnitType } from '@game/services/RulesetUnitsService';
import type { PlayerState } from './GameTypes';

type RuntimeCallbacks = Pick<
  UnitManagerCallbacks,
  | 'foundCity'
  | 'requestPath'
  | 'broadcastUnitMoved'
  | 'broadcastUnitDestroyed'
  | 'broadcastUnitInfo'
  | 'broadcastHutEvent'
  | 'broadcastMapChanged'
>;

export function createRuntimeUnitManager(input: {
  gameId: string;
  databaseProvider: DatabaseProvider;
  mapWidth: number;
  mapHeight: number;
  mapManager: MapManager;
  cityManager: CityManager;
  researchManager: ResearchManager;
  effectsManager: EffectsManager;
  random: RandomSource;
  identities: FreecivIdentityAllocator;
  unitTypes: Record<string, UnitType>;
  players: Map<string, PlayerState>;
  callbacks: RuntimeCallbacks;
}): UnitManager {
  const { cityManager, researchManager, players } = input;
  const callbacks: UnitManagerCallbacks = {
    ...input.callbacks,
    canFoundCityAt: (x, y, playerId) => cityManager.canFoundCityAt(x, y, playerId),
    getCityAt: (x, y) => {
      const city = cityManager.getCityAt(x, y);
      return city
        ? {
            id: city.id,
            playerId: city.playerId,
            buildings: city.buildings,
            population: city.population,
          }
        : null;
    },
    applyCityPopulationLoss: cityId => cityManager.applyCityPopulationLoss(cityId),
    getCityNames: () => cityManager.getAllCities().map(city => city.name),
    getPlayerNation: playerId => {
      const player = players.get(playerId);
      return player?.nation ?? player?.civilization;
    },
    getPlayerBuildings: playerId =>
      cityManager.getCitiesByPlayer(playerId).flatMap(city => city.buildings),
    reserveAirlift: (sourceCityId, destinationCityId, playerId, turn) =>
      cityManager.reserveAirlift(sourceCityId, destinationCityId, playerId, turn),
    establishTradeRoute: async (playerId, homeCityId, targetX, targetY) => {
      const destination = cityManager.getCityAt(targetX, targetY);
      return destination
        ? cityManager.establishTradeRoute(homeCityId, destination.id, playerId)
        : false;
    },
    executeCityUnitAction: (...args) => cityManager.executeUnitCityAction(...args),
    applyNuclearCityDamage: (...args) => cityManager.applyNuclearExplosion(...args),
    grantHutTechnology: async playerId => {
      const technology = researchManager.getAvailableTechnologies(playerId)[0];
      return technology && (await researchManager.grantTechnology(playerId, technology.id))
        ? technology.name
        : null;
    },
    captureCity: async (cityId, playerId, unitId) =>
      (await cityManager.captureCity(cityId, playerId, unitId)).success,
    updatePlayerStatistic: (playerId, statistic) => {
      const player = players.get(playerId);
      if (player) player[statistic] = (player[statistic] ?? 0) + 1;
    },
  };

  return new UnitManager(
    input.gameId,
    input.databaseProvider,
    input.mapWidth,
    input.mapHeight,
    input.mapManager,
    callbacks,
    input.effectsManager,
    input.random,
    input.unitTypes,
    input.identities
  );
}
