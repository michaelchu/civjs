/**
 * @module server/game/ai/AITechnologyWantPlanner
 * Implements AITechnology Want Planner decision logic for AI-controlled players.
 */
import type { CityState } from '@game/cities/CityTypes';
import type { Unit } from '@game/units/UnitTypes';
import type { UnitType } from '@game/services/RulesetUnitsService';
import type { Effect } from '@shared/data/rulesets/schemas';

function normalizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function effectValue(type: Effect['type'], value: number, cityCount: number): number {
  const scale = Math.max(1, cityCount);
  switch (type) {
    case 'Make_Content':
    case 'Make_Happy':
    case 'Force_Content':
      return value * 30 * scale;
    case 'Max_Trade_Routes':
      return value * 20 * scale;
    case 'Output_Bonus':
    case 'Output_Bonus_2':
    case 'Output_Add_Tile':
      return value * 16 * scale;
    case 'Unit_Vision_Radius_Sq':
      return value * 2;
    case 'Slow_Down_Timeline':
      return value * 5;
    default:
      return value * 4 * scale;
  }
}

/**
 * Value technology-gated ruleset effects in the cities where their other
 * building requirements already hold.
 *
 * @reference reference/freeciv/ai/default/daitech.c:dai_tech_effect_values
 */
export function rankEffectTechnologyWants(
  cities: readonly CityState[],
  effects: Readonly<Record<string, Effect>>,
  researchedTechs: ReadonlySet<string>
): Map<string, number> {
  const wants = new Map<string, number>();
  const knownTechs = new Set([...researchedTechs].map(normalizeId));
  for (const effect of Object.values(effects)) {
    const techRequirements = (effect.reqs ?? []).filter(
      requirement => requirement.type.toLowerCase() === 'tech'
    );
    for (const tech of techRequirements) {
      const techId = normalizeId(tech.name);
      if (knownTechs.has(techId)) continue;
      const buildingRequirements = (effect.reqs ?? []).filter(
        requirement =>
          requirement.type.toLowerCase() === 'building' && requirement.present !== false
      );
      const affectedCities =
        buildingRequirements.length === 0
          ? cities
          : cities.filter(city =>
              buildingRequirements.every(requirement =>
                city.buildings.some(
                  building => normalizeId(building) === normalizeId(requirement.name)
                )
              )
            );
      if (affectedCities.length === 0) continue;
      const sign = tech.present === false ? -1 : 1;
      const want = effectValue(effect.type, effect.value * sign, affectedCities.length);
      wants.set(techId, (wants.get(techId) ?? 0) + want);
    }
  }
  return wants;
}

/**
 * Raise the technology path to defenders which materially improve on what
 * current cities can produce against observed attackers.
 *
 * @reference reference/freeciv/ai/default/daitech.c:dai_wants_defender_against
 */
export function rankThreatTechnologyWants(context: {
  cities: readonly CityState[];
  hostileUnits: readonly Unit[];
  unitTypes: Readonly<Record<string, UnitType>>;
  researchedTechs: ReadonlySet<string>;
  canBuildNow: (cityId: string, unitTypeId: string) => boolean;
}): Map<string, number> {
  const wants = new Map<string, number>();
  // Freeciv's defender-tech pass is driven by an observed attacker. Without
  // one there is no defender comparison to make, so avoid evaluating every
  // unit type against every city only to return an empty map.
  // @reference reference/freeciv/ai/default/daitech.c:dai_wants_defender_against
  if (context.cities.length === 0 || context.hostileUnits.length === 0) return wants;
  const knownTechs = new Set([...context.researchedTechs].map(normalizeId));
  const types = Object.values(context.unitTypes);
  const currentDefense = types.reduce((best, type) => {
    if (!context.cities.some(city => context.canBuildNow(city.id, type.id))) return best;
    return Math.max(best, type.defense ?? type.combat ?? 0);
  }, 0);

  for (const hostile of context.hostileUnits) {
    const attacker = context.unitTypes[hostile.unitTypeId];
    const attack = attacker?.attack ?? attacker?.combat ?? 0;
    if (attack <= 0) continue;
    for (const defender of types) {
      const techId = normalizeId(defender.requiredTech ?? '');
      const defense = defender.defense ?? defender.combat ?? 0;
      if (!techId || knownTechs.has(techId) || defense <= currentDefense) continue;
      const obsolete = defender.obsolete_by ? context.unitTypes[defender.obsolete_by] : undefined;
      if (obsolete?.requiredTech && knownTechs.has(normalizeId(obsolete.requiredTech))) {
        continue;
      }
      const want = (defense - currentDefense) * attack * Math.max(1, hostile.health / 25);
      wants.set(techId, (wants.get(techId) ?? 0) + want);
    }
  }
  return wants;
}

export function mergeTechnologyWants(
  ...sources: ReadonlyMap<string, number>[]
): Map<string, number> {
  const merged = new Map<string, number>();
  for (const source of sources) {
    for (const [techId, want] of source) {
      const normalized = normalizeId(techId);
      merged.set(normalized, (merged.get(normalized) ?? 0) + want);
    }
  }
  return merged;
}
