/**
 * @module server/game/runtime/RuntimeManagerBindings
 * Defines Runtime Manager Bindings game runtime wiring.
 */
import type { CityManager } from '@game/managers/CityManager';
import type { GovernmentManager } from '@game/managers/GovernmentManager';
import type { ResearchManager } from '@game/managers/ResearchManager';
import type { UnitManager } from '@game/managers/UnitManager';
import { normalizeSpaceshipState } from '@game/services/SpaceshipService';
import type { PlayerState } from './GameTypes';

/** Connects manager-owned state through narrow provider interfaces. */
export function bindCoreManagerProviders(input: {
  players: Map<string, PlayerState>;
  cityManager: CityManager;
  researchManager: ResearchManager;
  governmentManager: GovernmentManager;
  unitManager: UnitManager;
}): void {
  const { players, cityManager, researchManager, governmentManager, unitManager } = input;
  const playerTechs = (playerId: string) => new Set(researchManager.getResearchedTechs(playerId));
  const playerBuildings = (playerId: string) =>
    new Set(cityManager.getCitiesByPlayer(playerId).flatMap(city => city.buildings));

  governmentManager.setPlayerTechsProvider(playerTechs);
  governmentManager.setPlayerBuildingsProvider(playerBuildings);
  cityManager.setPlayerTechsProvider(playerTechs);
  cityManager.setPlayerBuildingsProvider(playerBuildings);
  cityManager.setPlayerSpaceshipProvider(playerId =>
    normalizeSpaceshipState(players.get(playerId)?.spaceshipState)
  );
  cityManager.setPlayerAIProvider(playerId => ({
    isAI: players.get(playerId)?.isAI === true,
    aiLevel: players.get(playerId)?.aiLevel,
  }));
  cityManager.setPlayerGovernmentProvider(playerId => {
    const government = governmentManager.getPlayerGovernment(playerId)?.currentGovernment;
    if (!government) throw new Error(`No government found for player '${playerId}'`);
    return government;
  });
  unitManager.setPlayerTechsProvider(playerTechs);
  unitManager.setPlayerAIProvider(playerId => ({
    isAI: players.get(playerId)?.isAI === true,
    aiLevel: players.get(playerId)?.aiLevel,
  }));
  unitManager.setPlayerGovernmentProvider(
    playerId => governmentManager.getPlayerGovernment(playerId)?.currentGovernment
  );
  researchManager.setPlayerBuildingsProvider(playerBuildings);
  researchManager.setTechnologyLossHandler(async playerId => {
    await governmentManager.reconcileAfterTechnologyLoss(playerId);
  });
}
