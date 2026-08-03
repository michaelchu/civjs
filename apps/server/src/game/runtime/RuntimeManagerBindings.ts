/**
 * @module server/game/runtime/RuntimeManagerBindings
 * Defines Runtime Manager Bindings game runtime wiring.
 */
import type { CityManager, ConquestTechnologyProvider } from '@game/managers/CityManager';
import type { GovernmentManager } from '@game/managers/GovernmentManager';
import type { ResearchManager } from '@game/managers/ResearchManager';
import type { UnitManager } from '@game/managers/UnitManager';
import { normalizeSpaceshipState } from '@game/services/SpaceshipService';
import type { PlayerState } from './GameTypes';

/**
 * Builds the C2C3 city-conquest technology resolver using the same
 * prerequisite-gated research catalogue as ordinary acquisition. C2C3 sets
 * tech_steal_allow_holes to false, so currently available technologies are
 * exactly the gettable candidates.
 * @reference reference/freeciv/common/research.c:691-715
 * @reference reference/freeciv/server/techtools.c:1249-1329
 * @reference reference/freeciv/data/civ2civ3/game.ruleset:134
 */
export function createConquestTechnologyProvider(
  researchManager: Pick<
    ResearchManager,
    'getAvailableTechnologies' | 'getResearchedTechs' | 'grantTechnology'
  >
): ConquestTechnologyProvider {
  return async (conquerorPlayerId, victimPlayerId, pickCandidateIndex) => {
    const victimTechs = new Set(researchManager.getResearchedTechs(victimPlayerId));
    const candidates = researchManager
      .getAvailableTechnologies(conquerorPlayerId)
      .filter(technology => victimTechs.has(technology.id));
    if (candidates.length === 0) return undefined;

    const candidateIndex = pickCandidateIndex(candidates.length);
    if (
      !Number.isInteger(candidateIndex) ||
      candidateIndex < 0 ||
      candidateIndex >= candidates.length
    ) {
      return undefined;
    }
    const candidate = candidates[candidateIndex]!;
    return (await researchManager.grantTechnology(conquerorPlayerId, candidate.id))
      ? candidate.id
      : undefined;
  };
}

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
  cityManager.setConquestTechnologyProvider(createConquestTechnologyProvider(researchManager));
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
