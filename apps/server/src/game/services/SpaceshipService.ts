/**
 * @module server/game/services/SpaceshipService
 * Authoritative Freeciv-compatible spaceship assembly and flight rules.
 *
 * @reference reference/freeciv/common/spaceship.c
 * @reference reference/freeciv/server/spacerace.c
 * @reference reference/freeciv/server/advisors/advspace.c
 */
import type { CityState } from '@game/cities/CityTypes';
import { EffectType, type EffectContext, type EffectsManager } from '@game/managers/EffectsManager';

export const SPACESHIP_PART_LIMITS = {
  space_structural: 32,
  space_component: 16,
  space_module: 12,
} as const;

/**
 * Legacy UI code previously treated these counts as a launch threshold. They
 * remain exported for compatibility, but launch now follows the reference
 * ship-assembly rules in `isSpaceshipLaunchReady`.
 */
export const SPACESHIP_LAUNCH_REQUIREMENTS = {
  space_structural: 16,
  space_component: 8,
  space_module: 3,
} as const;

export const DEFAULT_SPACESHIP_TRAVEL_PCT = 100;

export type SpaceshipPartId = keyof typeof SPACESHIP_PART_LIMITS;
export type SpaceshipStatus = 'none' | 'started' | 'launched' | 'arrived';

export interface SpaceshipPartCounts {
  structurals: number;
  components: number;
  modules: number;
}

/**
 * A persisted spaceship mirrors Freeciv's distinction between built and
 * placed parts. The component/module subtype counts are the placed counts;
 * the top-level counts are the total number constructed by cities.
 */
export interface SpaceshipState extends SpaceshipPartCounts {
  status?: SpaceshipStatus;
  placedStructurals?: number[];
  fuel?: number;
  propulsion?: number;
  habitation?: number;
  lifeSupport?: number;
  solarPanels?: number;
  launchYear?: number;
  arrivalYear?: number;
  /** Retained while existing saved games and clients migrate to year fields. */
  launchedTurn?: number;
  /** Retained while existing saved games and clients migrate to year fields. */
  arrivalTurn?: number;
  /** Population carried by the ship when it arrives, in Freeciv inhabitants. */
  population?: number;
  mass?: number;
  supportRate?: number;
  energyRate?: number;
  /** Success chance as a percentage, matching CivJS score input semantics. */
  successRate?: number;
  /** Travel duration in game years before Freeciv truncates it for arrival. */
  travelTime?: number;
}

export type SpaceshipPlacement =
  | { kind: 'structural'; index: number }
  | { kind: 'fuel'; number: number }
  | { kind: 'propulsion'; number: number }
  | { kind: 'habitation'; number: number }
  | { kind: 'life_support'; number: number }
  | { kind: 'solar_panel'; number: number };

export interface SpaceshipTransitionResult {
  success: boolean;
  state: SpaceshipState;
  reason?: string;
}

const COUNT_KEY: Record<SpaceshipPartId, keyof SpaceshipPartCounts> = {
  space_structural: 'structurals',
  space_component: 'components',
  space_module: 'modules',
};

// These predecessor relationships describe the Freeciv spaceship graph. They
// are represented independently here rather than imported from the GPL source.
const STRUCTURAL_PREDECESSORS = [
  -1, 0, 0, 1, 2, 3, 4, 5, 2, 3, 6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 4, 5, 22, 23, 24, 25,
  26, 27, 20, 21,
] as const;
const COMPONENT_STRUCTURAL_REQUIREMENTS = [
  0, 12, 1, 13, 8, 12, 9, 13, 22, 28, 23, 29, 26, 28, 27, 29,
] as const;
const MODULE_STRUCTURAL_REQUIREMENTS = [0, 1, 10, 15, 14, 11, 18, 19, 20, 31, 30, 21] as const;

const MAX_COMPONENT_SUBTYPE = SPACESHIP_PART_LIMITS.space_component / 2;
const MAX_MODULE_SUBTYPE = SPACESHIP_PART_LIMITS.space_module / 3;

function boundedInteger(value: unknown, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, Math.floor(value)))
    : 0;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normaliseStatus(
  value: unknown,
  hasParts: boolean,
  hasLegacyLaunch: boolean
): SpaceshipStatus {
  if (value === 'none' || value === 'started' || value === 'launched' || value === 'arrived') {
    return value;
  }
  if (hasLegacyLaunch) return 'launched';
  // Existing saves did not persist a status. A player with any completed part
  // has started a spaceship according to cityturn.c.
  return hasParts ? 'started' : 'none';
}

function normalisePlacedStructurals(value: unknown, maximum: number): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter(index => Number.isInteger(index) && index >= 0 && index < maximum)),
  ]
    .sort((left, right) => left - right)
    .slice(0, maximum);
}

export function isSpaceshipPart(value: string): value is SpaceshipPartId {
  return Object.prototype.hasOwnProperty.call(SPACESHIP_PART_LIMITS, value);
}

/**
 * Classify a completed Special improvement through the active ruleset effects.
 * Freeciv does this at construction time rather than relying on a building ID.
 *
 * @reference reference/freeciv/server/cityturn.c:2768-2779
 */
export function spaceshipPartFromEffects(
  effectsManager: Pick<EffectsManager, 'calculateEffect'>,
  context: EffectContext
): SpaceshipPartId | undefined {
  const effectTypes: Array<[EffectType, SpaceshipPartId]> = [
    [EffectType.SS_STRUCTURAL, 'space_structural'],
    [EffectType.SS_COMPONENT, 'space_component'],
    [EffectType.SS_MODULE, 'space_module'],
  ];
  return effectTypes.find(
    ([effectType]) => effectsManager.calculateEffect(effectType, context).value > 0
  )?.[1];
}

/** @reference reference/freeciv/common/city.c:can_city_build_improvement_now */
export function isSpaceRaceEnabled(
  effectsManager: Pick<EffectsManager, 'calculateEffect'>,
  context: EffectContext
): boolean {
  return effectsManager.calculateEffect(EffectType.ENABLE_SPACE, context).value > 0;
}

export function normalizeSpaceshipState(value: unknown): SpaceshipState {
  const persisted = value && typeof value === 'object' ? (value as Partial<SpaceshipState>) : {};
  const structurals = boundedInteger(persisted.structurals, SPACESHIP_PART_LIMITS.space_structural);
  const components = boundedInteger(persisted.components, SPACESHIP_PART_LIMITS.space_component);
  const modules = boundedInteger(persisted.modules, SPACESHIP_PART_LIMITS.space_module);
  const hasLegacyLaunch =
    finiteNumber(persisted.launchedTurn) !== undefined ||
    finiteNumber(persisted.arrivalTurn) !== undefined;
  const state: SpaceshipState = {
    structurals,
    components,
    modules,
    status: normaliseStatus(
      persisted.status,
      structurals + components + modules > 0,
      hasLegacyLaunch
    ),
    placedStructurals: normalisePlacedStructurals(
      persisted.placedStructurals,
      SPACESHIP_PART_LIMITS.space_structural
    ).slice(0, structurals),
    fuel: boundedInteger(persisted.fuel, Math.min(components, MAX_COMPONENT_SUBTYPE)),
    propulsion: boundedInteger(persisted.propulsion, Math.min(components, MAX_COMPONENT_SUBTYPE)),
    habitation: boundedInteger(persisted.habitation, Math.min(modules, MAX_MODULE_SUBTYPE)),
    lifeSupport: boundedInteger(persisted.lifeSupport, Math.min(modules, MAX_MODULE_SUBTYPE)),
    solarPanels: boundedInteger(persisted.solarPanels, Math.min(modules, MAX_MODULE_SUBTYPE)),
  };

  state.fuel = Math.min(state.fuel ?? 0, components - Math.min(components, state.propulsion ?? 0));
  state.propulsion = Math.min(state.propulsion ?? 0, components - (state.fuel ?? 0));
  state.habitation = Math.min(state.habitation ?? 0, modules);
  state.lifeSupport = Math.min(state.lifeSupport ?? 0, modules - (state.habitation ?? 0));
  state.solarPanels = Math.min(
    state.solarPanels ?? 0,
    modules - (state.habitation ?? 0) - (state.lifeSupport ?? 0)
  );
  const optional = {
    ...(finiteNumber(persisted.launchYear) === undefined
      ? {}
      : { launchYear: finiteNumber(persisted.launchYear) }),
    ...(finiteNumber(persisted.arrivalYear) === undefined
      ? {}
      : { arrivalYear: finiteNumber(persisted.arrivalYear) }),
    ...(finiteNumber(persisted.launchedTurn) === undefined
      ? {}
      : { launchedTurn: finiteNumber(persisted.launchedTurn) }),
    ...(finiteNumber(persisted.arrivalTurn) === undefined
      ? {}
      : { arrivalTurn: finiteNumber(persisted.arrivalTurn) }),
    ...(finiteNumber(persisted.population) === undefined
      ? {}
      : { population: Math.max(0, Math.floor(finiteNumber(persisted.population)!)) }),
    ...(finiteNumber(persisted.mass) === undefined
      ? {}
      : { mass: Math.max(0, finiteNumber(persisted.mass)!) }),
    ...(finiteNumber(persisted.supportRate) === undefined
      ? {}
      : { supportRate: Math.max(0, finiteNumber(persisted.supportRate)!) }),
    ...(finiteNumber(persisted.energyRate) === undefined
      ? {}
      : { energyRate: Math.max(0, finiteNumber(persisted.energyRate)!) }),
    ...(finiteNumber(persisted.successRate) === undefined
      ? {}
      : { successRate: Math.max(0, Math.min(100, finiteNumber(persisted.successRate)!)) }),
    ...(finiteNumber(persisted.travelTime) === undefined
      ? {}
      : { travelTime: Math.max(0, finiteNumber(persisted.travelTime)!) }),
  };
  return { ...state, ...optional };
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

function placedSet(state: SpaceshipState): Set<number> {
  return new Set(state.placedStructurals ?? []);
}

function connectedCount(
  count: number,
  requirements: readonly number[],
  structures: ReadonlySet<number>
): number {
  let connected = 0;
  for (let index = 0; index < count; index += 1) {
    if (structures.has(requirements[index])) connected += 1;
  }
  return connected;
}

/** Compute Freeciv's server-side derived ship values. */
export function calculateSpaceshipDerived(
  value: unknown,
  travelPercent: number = DEFAULT_SPACESHIP_TRAVEL_PCT
): SpaceshipState {
  const state = normalizeSpaceshipState(value);
  const structures = placedSet(state);
  const fuel = connectedCount(state.fuel ?? 0, COMPONENT_STRUCTURAL_REQUIREMENTS, structures);
  const propulsion = connectedCount(
    state.propulsion ?? 0,
    COMPONENT_STRUCTURAL_REQUIREMENTS.slice(1),
    structures
  );
  const habitation = connectedCount(
    state.habitation ?? 0,
    MODULE_STRUCTURAL_REQUIREMENTS,
    structures
  );
  const lifeSupport = connectedCount(
    state.lifeSupport ?? 0,
    MODULE_STRUCTURAL_REQUIREMENTS.slice(1),
    structures
  );
  const solarPanels = connectedCount(
    state.solarPanels ?? 0,
    MODULE_STRUCTURAL_REQUIREMENTS.slice(2),
    structures
  );
  const structuralMass = [...structures].reduce(
    (total, index) => total + (index < 6 ? 200 : 100),
    0
  );
  const mass =
    structuralMass + 1600 * (habitation + lifeSupport) + 400 * (solarPanels + propulsion + fuel);
  const supportRate = habitation > 0 ? lifeSupport / habitation : 0;
  const energyRate =
    lifeSupport + habitation > 0 ? (2 * solarPanels) / (lifeSupport + habitation) : 0;
  const successRate =
    fuel > 0 && propulsion > 0 ? Math.min(supportRate, 1) * Math.min(energyRate, 1) * 100 : 0;
  const travelMultiplier = Math.max(0, finiteNumber(travelPercent) ?? DEFAULT_SPACESHIP_TRAVEL_PCT);
  const travelTime =
    mass === 0 ? 0 : (mass * travelMultiplier) / 100 / (200 * Math.min(propulsion, fuel) + 20);

  return {
    ...state,
    population: habitation * 10_000,
    mass,
    supportRate,
    energyRate,
    successRate,
    travelTime,
  };
}

export function completeSpaceshipPart(value: unknown, partId: SpaceshipPartId): SpaceshipState {
  const state = normalizeSpaceshipState(value);
  if (state.status === 'launched' || state.status === 'arrived')
    return calculateSpaceshipDerived(state);
  const key = COUNT_KEY[partId];
  return calculateSpaceshipDerived({
    ...state,
    status: 'started',
    [key]: Math.min(SPACESHIP_PART_LIMITS[partId], state[key] + 1),
  });
}

function transitionFailure(state: SpaceshipState, reason: string): SpaceshipTransitionResult {
  return { success: false, state: calculateSpaceshipDerived(state), reason };
}

function nextStructuralPlacement(state: SpaceshipState): SpaceshipPlacement | undefined {
  const structures = placedSet(state);
  if (structures.size >= state.structurals) return undefined;
  if (!structures.has(0)) return { kind: 'structural', index: 0 };

  let requiredStructural: number | undefined;
  if ((state.habitation ?? 0) >= 1 && !structures.has(MODULE_STRUCTURAL_REQUIREMENTS[0])) {
    requiredStructural = MODULE_STRUCTURAL_REQUIREMENTS[0];
  } else if ((state.lifeSupport ?? 0) >= 1 && !structures.has(MODULE_STRUCTURAL_REQUIREMENTS[1])) {
    requiredStructural = MODULE_STRUCTURAL_REQUIREMENTS[1];
  } else if ((state.solarPanels ?? 0) >= 1 && !structures.has(MODULE_STRUCTURAL_REQUIREMENTS[2])) {
    requiredStructural = MODULE_STRUCTURAL_REQUIREMENTS[2];
  } else {
    for (let index = 0; index < SPACESHIP_PART_LIMITS.space_component; index += 1) {
      const built =
        (index % 2 === 0 && (state.fuel ?? 0) > index / 2) ||
        (index % 2 === 1 && (state.propulsion ?? 0) > (index - 1) / 2);
      if (built && !structures.has(COMPONENT_STRUCTURAL_REQUIREMENTS[index])) {
        requiredStructural = COMPONENT_STRUCTURAL_REQUIREMENTS[index];
        break;
      }
    }
    if (requiredStructural === undefined) {
      for (let index = 0; index < SPACESHIP_PART_LIMITS.space_module; index += 1) {
        const built =
          (index % 3 === 0 && (state.habitation ?? 0) > index / 3) ||
          (index % 3 === 1 && (state.lifeSupport ?? 0) > (index - 1) / 3) ||
          (index % 3 === 2 && (state.solarPanels ?? 0) > (index - 2) / 3);
        if (built && !structures.has(MODULE_STRUCTURAL_REQUIREMENTS[index])) {
          requiredStructural = MODULE_STRUCTURAL_REQUIREMENTS[index];
          break;
        }
      }
    }
  }
  if (requiredStructural === undefined) {
    requiredStructural = STRUCTURAL_PREDECESSORS.findIndex(
      (_parent, index) => !structures.has(index)
    );
  }

  let next = requiredStructural;
  while (next > 0 && !structures.has(STRUCTURAL_PREDECESSORS[next])) {
    next = STRUCTURAL_PREDECESSORS[next];
  }
  return next >= 0 ? { kind: 'structural', index: next } : undefined;
}

/** Returns the same next automatic placement priority used by Freeciv. */
export function nextSpaceshipPlacement(value: unknown): SpaceshipPlacement | undefined {
  const state = normalizeSpaceshipState(value);
  if (state.status !== 'started') return undefined;
  const placedModules =
    (state.habitation ?? 0) + (state.lifeSupport ?? 0) + (state.solarPanels ?? 0);
  if (state.modules > placedModules) {
    if ((state.habitation ?? 0) === 0) return { kind: 'habitation', number: 1 };
    if ((state.lifeSupport ?? 0) === 0) return { kind: 'life_support', number: 1 };
    if ((state.solarPanels ?? 0) === 0) return { kind: 'solar_panel', number: 1 };
    if (
      (state.habitation ?? 0) < (state.lifeSupport ?? 0) &&
      2 * (state.solarPanels ?? 0) >= (state.habitation ?? 0) + (state.lifeSupport ?? 0) + 1
    ) {
      return { kind: 'habitation', number: (state.habitation ?? 0) + 1 };
    }
    if (2 * (state.solarPanels ?? 0) < (state.habitation ?? 0) + (state.lifeSupport ?? 0)) {
      return { kind: 'solar_panel', number: (state.solarPanels ?? 0) + 1 };
    }
    if ((state.lifeSupport ?? 0) < (state.habitation ?? 0)) {
      return { kind: 'life_support', number: (state.lifeSupport ?? 0) + 1 };
    }
    return 2 * (state.solarPanels ?? 0) >= (state.habitation ?? 0) + (state.lifeSupport ?? 0) + 1
      ? { kind: 'life_support', number: (state.lifeSupport ?? 0) + 1 }
      : { kind: 'solar_panel', number: (state.solarPanels ?? 0) + 1 };
  }

  const placedComponents = (state.fuel ?? 0) + (state.propulsion ?? 0);
  if (state.components > placedComponents) {
    return (state.fuel ?? 0) <= (state.propulsion ?? 0)
      ? { kind: 'fuel', number: (state.fuel ?? 0) + 1 }
      : { kind: 'propulsion', number: (state.propulsion ?? 0) + 1 };
  }

  return nextStructuralPlacement(state);
}

export function placeSpaceshipPart(
  value: unknown,
  placement: SpaceshipPlacement
): SpaceshipTransitionResult {
  const state = normalizeSpaceshipState(value);
  if (state.status === 'none') return transitionFailure(state, 'Spaceship has not been started');
  if (state.status === 'launched' || state.status === 'arrived') {
    return transitionFailure(state, 'Spaceship can no longer be modified');
  }

  if (placement.kind === 'structural') {
    const structures = placedSet(state);
    if (
      !Number.isInteger(placement.index) ||
      placement.index < 0 ||
      placement.index >= SPACESHIP_PART_LIMITS.space_structural ||
      structures.size >= state.structurals
    ) {
      return transitionFailure(state, 'Structural is not available');
    }
    if (structures.has(placement.index))
      return transitionFailure(state, 'Structural is already placed');
    const predecessor = STRUCTURAL_PREDECESSORS[placement.index];
    if (predecessor >= 0 && !structures.has(predecessor)) {
      return transitionFailure(state, 'Structural would not be connected');
    }
    return {
      success: true,
      state: calculateSpaceshipDerived({
        ...state,
        placedStructurals: [...structures, placement.index].sort((left, right) => left - right),
      }),
    };
  }

  const componentPlacement = placement.kind === 'fuel' || placement.kind === 'propulsion';
  const key =
    placement.kind === 'fuel'
      ? 'fuel'
      : placement.kind === 'propulsion'
        ? 'propulsion'
        : placement.kind === 'habitation'
          ? 'habitation'
          : placement.kind === 'life_support'
            ? 'lifeSupport'
            : 'solarPanels';
  const current = state[key] ?? 0;
  const placed = componentPlacement
    ? (state.fuel ?? 0) + (state.propulsion ?? 0)
    : (state.habitation ?? 0) + (state.lifeSupport ?? 0) + (state.solarPanels ?? 0);
  const constructed = componentPlacement ? state.components : state.modules;
  const subtypeLimit = componentPlacement ? MAX_COMPONENT_SUBTYPE : MAX_MODULE_SUBTYPE;
  if (placement.number !== current + 1 || placement.number > subtypeLimit) {
    return transitionFailure(state, 'Part placement sequence is invalid');
  }
  if (placed >= constructed) return transitionFailure(state, 'No unplaced part is available');

  return {
    success: true,
    state: calculateSpaceshipDerived({ ...state, [key]: current + 1 }),
  };
}

/** Place every currently available part using Freeciv's deterministic advisor order. */
export function autoPlaceSpaceship(value: unknown): SpaceshipState {
  let state = normalizeSpaceshipState(value);
  for (let attempts = 0; attempts < 64; attempts += 1) {
    const placement = nextSpaceshipPlacement(state);
    if (!placement) break;
    const result = placeSpaceshipPart(state, placement);
    if (!result.success) break;
    state = result.state;
  }
  return calculateSpaceshipDerived(state);
}

export function isSpaceshipLaunchReady(value: unknown): boolean {
  const state = calculateSpaceshipDerived(value);
  return state.status === 'started' && (state.successRate ?? 0) > 0;
}

export function launchSpaceship(
  value: unknown,
  options: {
    year: number;
    turn?: number;
    hasCapital: boolean;
    travelPercent?: number;
  }
): SpaceshipTransitionResult {
  const state = calculateSpaceshipDerived(value, options.travelPercent);
  if (!options.hasCapital) return transitionFailure(state, 'A capital is required to launch');
  if (state.status === 'launched' || state.status === 'arrived') {
    return transitionFailure(state, 'Spaceship is already launched');
  }
  if (!isSpaceshipLaunchReady(state))
    return transitionFailure(state, 'Spaceship cannot be launched yet');
  return {
    success: true,
    state: {
      ...state,
      status: 'launched',
      launchYear: Math.trunc(options.year),
      arrivalYear: Math.trunc(options.year) + Math.trunc(state.travelTime ?? 0),
      ...(options.turn === undefined ? {} : { launchedTurn: options.turn }),
    },
  };
}

export function updateSpaceshipArrival(value: unknown, currentYear: number): SpaceshipState {
  const state = calculateSpaceshipDerived(value);
  if (
    state.status === 'launched' &&
    state.arrivalYear !== undefined &&
    state.arrivalYear <= Math.trunc(currentYear)
  ) {
    return { ...state, status: 'arrived' };
  }
  return state;
}

/**
 * Return the fractional arrival year used by Freeciv when ranking launched
 * spaceships. `arrivalYear` remains the truncated calendar year at which the
 * server marks the ship as arrived.
 *
 * @reference reference/freeciv/server/spacerace.c:441-451
 */
export function spaceshipArrival(value: unknown): number | undefined {
  const state = calculateSpaceshipDerived(value);
  if (state.launchYear !== undefined && state.travelTime !== undefined) {
    return state.launchYear + state.travelTime;
  }
  return state.arrivalYear;
}

/** @deprecated Use `isSpaceshipLaunchReady` for source-compatible launch checks. */
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
