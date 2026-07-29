import type { AIProfile } from '@game/ai/AIProfile';
import type { GameInstance } from '@game/managers/GameManager';
import type { Unit } from '@game/managers/UnitManager';
import type { FreecivAIState } from '@game/ai/AIStateStore';

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

/**
 * Virtual units considered for city production may plan against an imminent
 * enemy before war is declared. Existing units still use the strictly
 * wartime hostility set when selecting executable attacks.
 *
 * @reference reference/freeciv/ai/default/daiunit.h:POTENTIALLY_HOSTILE_PLAYER
 */
export function potentiallyHostilePlayerIds(
  playerIds: Iterable<string>,
  playerId: string,
  hostilePlayerIds: ReadonlySet<string>,
  alliedPlayerIds: ReadonlySet<string>,
  unknownPlayerIds: ReadonlySet<string>,
  state: Pick<FreecivAIState, 'diplomacy'>
): Set<string> {
  const result = new Set(hostilePlayerIds);
  for (const candidateId of playerIds) {
    if (candidateId === playerId || alliedPlayerIds.has(candidateId) || result.has(candidateId)) {
      continue;
    }
    const memory = state.diplomacy[candidateId];
    if (unknownPlayerIds.has(candidateId) || memory?.countdown > 0 || memory?.warDesire > 0) {
      result.add(candidateId);
    }
  }
  return result;
}
