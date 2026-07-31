import type { CityState } from '@game/managers/CityManager';

export const SPACESHIP_PART_LIMITS = {
  space_structural: 32,
  space_component: 16,
  space_module: 12,
} as const;

export const SPACESHIP_LAUNCH_REQUIREMENTS = {
  space_structural: 16,
  space_component: 8,
  space_module: 3,
} as const;

export type SpaceshipPartId = keyof typeof SPACESHIP_PART_LIMITS;

export interface SpaceshipPartCounts {
  structurals: number;
  components: number;
  modules: number;
}

export interface SpaceshipState extends SpaceshipPartCounts {
  launchedTurn?: number;
  arrivalTurn?: number;
  /** Population carried by the ship when it arrives, for final scoring. */
  population?: number;
  /** Success percentage used by the reference spaceship score formula. */
  successRate?: number;
}

const COUNT_KEY: Record<SpaceshipPartId, keyof SpaceshipPartCounts> = {
  space_structural: 'structurals',
  space_component: 'components',
  space_module: 'modules',
};

export function isSpaceshipPart(value: string): value is SpaceshipPartId {
  return Object.prototype.hasOwnProperty.call(SPACESHIP_PART_LIMITS, value);
}

export function normalizeSpaceshipState(value: unknown): SpaceshipState {
  const state = value && typeof value === 'object' ? (value as Partial<SpaceshipState>) : {};
  return {
    structurals: Math.max(0, Math.floor(state.structurals ?? 0)),
    components: Math.max(0, Math.floor(state.components ?? 0)),
    modules: Math.max(0, Math.floor(state.modules ?? 0)),
    ...(state.launchedTurn === undefined ? {} : { launchedTurn: state.launchedTurn }),
    ...(state.arrivalTurn === undefined ? {} : { arrivalTurn: state.arrivalTurn }),
    ...(state.population === undefined ? {} : { population: Math.max(0, Math.floor(state.population)) }),
    ...(state.successRate === undefined
      ? {}
      : { successRate: Math.max(0, Math.min(100, Math.floor(state.successRate))) }),
  };
}

export function countSpaceshipPart(state: SpaceshipPartCounts, partId: SpaceshipPartId): number {
  return state[COUNT_KEY[partId]];
}

export function countSpaceshipPartCommitments(
  state: SpaceshipPartCounts,
  cities: readonly CityState[],
  partId: SpaceshipPartId
): number {
  return (
    countSpaceshipPart(state, partId) +
    cities.filter(city => city.currentProduction === partId).length +
    cities.reduce(
      (sum, city) => sum + (city.worklist ?? []).filter(item => item.value === partId).length,
      0
    )
  );
}

export function completeSpaceshipPart(value: unknown, partId: SpaceshipPartId): SpaceshipState {
  const state = normalizeSpaceshipState(value);
  const key = COUNT_KEY[partId];
  return {
    ...state,
    [key]: Math.min(SPACESHIP_PART_LIMITS[partId], state[key] + 1),
  };
}

export function isSpaceshipComplete(counts: SpaceshipPartCounts): boolean {
  return (
    counts.structurals >= SPACESHIP_LAUNCH_REQUIREMENTS.space_structural &&
    counts.components >= SPACESHIP_LAUNCH_REQUIREMENTS.space_component &&
    counts.modules >= SPACESHIP_LAUNCH_REQUIREMENTS.space_module
  );
}

export function isSpaceshipOptimal(counts: SpaceshipPartCounts): boolean {
  return (
    counts.structurals >= SPACESHIP_PART_LIMITS.space_structural &&
    counts.components >= SPACESHIP_PART_LIMITS.space_component &&
    counts.modules >= SPACESHIP_PART_LIMITS.space_module
  );
}

export function spaceshipProgress(counts: SpaceshipPartCounts): number {
  return (
    counts.structurals / SPACESHIP_PART_LIMITS.space_structural +
    counts.components / SPACESHIP_PART_LIMITS.space_component +
    counts.modules / SPACESHIP_PART_LIMITS.space_module
  );
}
