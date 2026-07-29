import type { AIProfile } from '@game/ai/FreecivAIProfile';
import type { GameInstance } from '@game/managers/GameManager';
import type { Unit } from '@game/managers/UnitManager';

export function sortedPlayerUnits(game: GameInstance, playerId: string): Unit[] {
  return game.unitManager
    .getPlayerUnits(playerId)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * H_TARGETS prevents lower-skill AI from selecting units or cities under fog.
 * Higher levels deliberately retain Freeciv's omniscient target selection
 * when that handicap is absent.
 *
 * @reference reference/freeciv/ai/default/daiunit.c
 * @reference reference/freeciv/ai/default/daiair.c
 */
export function hostileUnitsForPlanning(
  game: GameInstance,
  playerId: string,
  hostilePlayerIds: ReadonlySet<string>,
  profile: AIProfile
): Unit[] {
  const candidates = profile.handicaps.has('targets')
    ? game.unitManager.getVisibleUnits(
        playerId,
        game.visibilityManager.getVisibleTiles(playerId),
        game.visibilityManager.getDetectionTiles(playerId)
      )
    : Array.from(game.unitManager.getAllUnits().values());
  return candidates.filter(unit => hostilePlayerIds.has(unit.playerId));
}

export function targetableForeignCities(
  game: GameInstance,
  playerId: string,
  targetPlayerIds: ReadonlySet<string>,
  profile: AIProfile
) {
  return (game.cityManager.getAllCities?.() ?? []).filter(
    city =>
      targetPlayerIds.has(city.playerId) &&
      (!profile.handicaps.has('targets') ||
        game.visibilityManager.isTileVisible(playerId, city.x, city.y))
  );
}
