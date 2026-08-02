/**
 * @module server/game/ai/AISpaceshipPlanner
 * Implements AISpaceship Planner decision logic for AI-controlled players.
 */
import { BUILDING_TYPES } from '@game/managers/CityManager';
import type { CityState } from '@game/cities/CityTypes';
import {
  normalizeSpaceshipState,
  spaceshipProgress,
  SPACESHIP_PART_LIMITS,
  type SpaceshipPartId,
} from '@game/services/SpaceshipService';

export interface SpaceshipPlanningContext {
  enabled: boolean;
  playerId: string;
  citiesByPlayer: ReadonlyMap<string, readonly CityState[]>;
  technologyCount: (playerId: string) => number;
  spaceshipState: (playerId: string) => unknown;
}

export interface SpaceshipPlan {
  pursuing: boolean;
  leaderId?: string;
  buildingWants: ReadonlyMap<string, ReadonlyMap<string, { want: number; reason: string }>>;
  technologyWants: ReadonlyMap<string, number>;
}

function leadingPlayer(
  playerIds: readonly string[],
  value: (playerId: string) => number
): string | undefined {
  return playerIds
    .slice()
    .sort((left, right) => value(right) - value(left) || left.localeCompare(right))[0];
}

function citySpaceshipWants(
  city: CityState,
  apolloBuilt: boolean,
  ownStarted: boolean,
  isLeader: boolean
): Map<string, { want: number; reason: string }> {
  const wants = new Map<string, { want: number; reason: string }>();
  if (!apolloBuilt) {
    wants.set('apollo_program', {
      want: 10 + (isLeader ? 150 : 0),
      reason: 'enable space race',
    });
    return wants;
  }
  const wonderCity =
    city.productionType === 'building' &&
    Boolean(
      city.currentProduction && BUILDING_TYPES[city.currentProduction]?.genus === 'GreatWonder'
    );
  const baseWant = (wonderCity ? 120 : 210) * (ownStarted ? 3 : 1);
  for (const partId of Object.keys(SPACESHIP_PART_LIMITS) as SpaceshipPartId[]) {
    wants.set(partId, { want: baseWant, reason: 'space-race ship assembly' });
  }
  return wants;
}

/**
 * Port the default AI's EnableSpace and spaceship-part effect wants onto the
 * native minimum viable ship used by CivJS's authoritative science victory.
 *
 * @reference reference/freeciv/ai/default/daieffects.c:EFT_ENABLE_SPACE
 * @reference reference/freeciv/ai/default/daieffects.c:EFT_SS_STRUCTURAL
 * @reference reference/freeciv/ai/default/daihand.c:dai_manage_spaceship
 * @reference reference/freeciv/server/advisors/advspace.c
 */
export function planSpaceship(context: SpaceshipPlanningContext): SpaceshipPlan {
  const empty = {
    pursuing: false,
    buildingWants: new Map(),
    technologyWants: new Map(),
  };
  if (!context.enabled) return empty;

  const playerIds = [...context.citiesByPlayer.keys()].filter(
    playerId => (context.citiesByPlayer.get(playerId)?.length ?? 0) > 0
  );
  if (!playerIds.includes(context.playerId)) return empty;
  const productionLeader = leadingPlayer(playerIds, playerId =>
    (context.citiesByPlayer.get(playerId) ?? []).reduce(
      (sum, city) => sum + Math.max(0, city.productionPerTurn ?? 0),
      0
    )
  );
  const technologyLeader = leadingPlayer(playerIds, context.technologyCount);
  const progress = new Map(
    playerIds.map(playerId => [
      playerId,
      spaceshipProgress(normalizeSpaceshipState(context.spaceshipState(playerId))),
    ])
  );
  const startedPlayers = playerIds.filter(playerId => (progress.get(playerId) ?? 0) > 0);
  const leaderId = leadingPlayer(startedPlayers, playerId => progress.get(playerId) ?? 0);
  const pursuing =
    leaderId !== undefined ||
    productionLeader === context.playerId ||
    technologyLeader === context.playerId;
  if (!pursuing) return { ...empty, leaderId };

  const allCities = [...context.citiesByPlayer.values()].flat();
  const apolloBuilt = allCities.some(city => city.buildings.includes('apollo_program'));
  const ownCities = context.citiesByPlayer.get(context.playerId) ?? [];
  const ownStarted = (progress.get(context.playerId) ?? 0) > 0;
  const buildingWants = new Map<string, Map<string, { want: number; reason: string }>>();
  const technologyWants = new Map<string, number>();

  for (const city of ownCities) {
    const isLeader = productionLeader === context.playerId || technologyLeader === context.playerId;
    buildingWants.set(city.id, citySpaceshipWants(city, apolloBuilt, ownStarted, isLeader));
  }

  technologyWants.set('space_flight', apolloBuilt ? 210 : 160);
  technologyWants.set('plastics', ownStarted ? 630 : 210);
  technologyWants.set('superconductors', ownStarted ? 630 : 210);
  return { pursuing, leaderId, buildingWants, technologyWants };
}
