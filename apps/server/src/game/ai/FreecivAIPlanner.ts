import type { CityState, BuildingType } from '@game/managers/CityManager';
import type { Technology } from '@game/managers/ResearchManager';
import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';
import type { AIProfile } from '@game/ai/FreecivAIProfile';
import type { MapTile, TerrainType } from '@game/map/MapTypes';
import {
  reevaluateDefensiveBuildingWant,
  type CityDangerAssessment,
} from '@game/ai/FreecivAICityDangerPlanner';

/**
 * Freeciv represents competing choices with an `adv_choice.want` value.
 * Keeping the value explicit is important: production and technology choices
 * must be comparable, inspectable, and able to feed wants into one another.
 *
 * @reference reference/freeciv/server/advisors/advchoice.h
 * @reference reference/freeciv/doc/README.AI "Want calculations"
 */
export interface AIChoice<T> {
  value: T;
  want: number;
  reason: string;
  goalId?: string;
}

export interface ProductionChoice {
  kind: 'unit' | 'building';
  id: string;
}

export interface ProductionPlanningContext {
  city: CityState;
  cities: CityState[];
  units: Unit[];
  unitTypes: Record<string, UnitType>;
  buildingTypes: Record<string, BuildingType>;
  canBuild: (kind: 'unit' | 'building', id: string) => boolean;
  dangerAssessment: Pick<
    CityDangerAssessment,
    'danger' | 'urgency' | 'graveDanger' | 'defense' | 'defenseDeficit'
  >;
  profile?: AIProfile;
  reservedWonders?: ReadonlySet<string>;
  excludedChoices?: ReadonlySet<string>;
}

const MORT = 24;

/** Present-value discount used throughout the default AI. */
export function amortize(benefit: number, delay: number): number {
  if (benefit <= 0) return benefit;
  return benefit * Math.pow((MORT - 1) / MORT, Math.max(0, delay));
}

function turnsToBuild(city: CityState, cost: number): number {
  const stock = city.productionStock ?? city.shieldStock ?? 0;
  return Math.ceil(Math.max(0, cost - stock) / Math.max(1, city.productionPerTurn ?? 1));
}

function unitDefense(type: UnitType): number {
  return Math.max(0, type.defense ?? type.combat ?? 0);
}

function unitAttack(type: UnitType): number {
  return Math.max(0, type.attack ?? type.combat ?? 0);
}

/**
 * A ruleset-driven first port of Freeciv's domestic and military build wants.
 * It deliberately scores every legal choice instead of naming fixed units or
 * buildings. More specialized advisors can add wants without replacing this
 * shared choice surface.
 *
 * @reference reference/freeciv/ai/default/daicity.c
 * @reference reference/freeciv/ai/default/daidomestic.c
 * @reference reference/freeciv/ai/default/daimilitary.c
 */
export function rankCityProduction(
  context: ProductionPlanningContext
): AIChoice<ProductionChoice>[] {
  const { city, cities, units, unitTypes, buildingTypes, canBuild } = context;
  const choices: AIChoice<ProductionChoice>[] = [];
  const cityUnits = units.filter(unit => unit.homeCityId === city.id);
  const defendersOnTile = units.filter(unit => {
    const type = unitTypes[unit.unitTypeId];
    return (
      unit.x === city.x &&
      unit.y === city.y &&
      type &&
      unitDefense(type) > 0 &&
      !type.flags?.includes('NonMil')
    );
  });
  const settlerCount = units.filter(unit => unitTypes[unit.unitTypeId]?.canFoundCity).length;
  const workerCount = units.filter(unit => unitTypes[unit.unitTypeId]?.canBuildImprovements).length;
  const expansionWeight =
    ((context.profile?.expansion ?? 100) / 100) *
    ((context.profile?.traits.expansionist ?? 50) / 50);
  const aggressionWeight = (context.profile?.traits.aggressive ?? 50) / 50;
  const builderWeight = (context.profile?.traits.builder ?? 50) / 50;
  const expansionNeed = Math.max(0, cities.length + 1 - settlerCount * 2) * expansionWeight;
  const workerNeed = Math.max(0, cities.length - workerCount);
  const defenseNeed =
    Math.max(0, 1 - defendersOnTile.length) * 90 +
    context.dangerAssessment.defenseDeficit +
    context.dangerAssessment.urgency;

  for (const type of Object.values(unitTypes)) {
    if (!canBuild('unit', type.id)) continue;
    if (context.excludedChoices?.has(`unit:${type.id}`)) continue;
    const delay = turnsToBuild(city, type.cost);
    let want = 0;
    const reasons: string[] = [];

    if (type.canFoundCity) {
      want += expansionNeed * 45;
      reasons.push('expansion');
    }
    if (type.canBuildImprovements) {
      want += workerNeed * 35;
      reasons.push('infrastructure');
    }

    const defense = unitDefense(type);
    const attack = unitAttack(type);
    if (defense > 0) {
      want += defenseNeed * defense;
      reasons.push('defense');
    }
    if (attack > 0) {
      want +=
        ((attack * Math.max(1, type.movement) * Math.max(1, type.firepower ?? 1) * 14) /
          Math.max(1, type.cost)) *
        aggressionWeight;
      reasons.push('military');
    }
    if ((type.transport_capacity ?? 0) > 0) {
      const landUnits = units.filter(unit => unitTypes[unit.unitTypeId]?.unitClass === 'military');
      want += landUnits.length * 4;
      reasons.push('transport');
    }

    // Avoid support-heavy units when this city is already running a deficit.
    const support = (type.uk_gold ?? 0) + (type.uk_shield ?? 0) * 2 + (type.uk_food ?? 0) * 2;
    want -= support * Math.max(1, cityUnits.length);
    want = amortize(want, delay);
    if (want > 0) {
      choices.push({
        value: { kind: 'unit', id: type.id },
        want,
        reason: reasons.join('+') || 'unit utility',
      });
    }
  }

  for (const building of Object.values(buildingTypes)) {
    if (!canBuild('building', building.id)) continue;
    if (context.excludedChoices?.has(`building:${building.id}`)) continue;
    if (building.genus === 'GreatWonder' && context.reservedWonders?.has(building.id)) {
      continue;
    }
    const delay = turnsToBuild(city, building.cost);
    const effects = building.effects ?? {};
    let want =
      (effects.foodBonus ?? 0) * 24 +
      (effects.productionBonus ?? 0) * 22 +
      (effects.scienceBonus ?? 0) * 18 +
      (effects.goldBonus ?? 0) * 16 +
      (effects.luxuryBonus ?? 0) * 10 +
      (effects.happinessEffect ?? 0) * 30 +
      (effects.defenseBonus ?? 0) * Math.max(10, defenseNeed);
    if ((effects.defenseBonus ?? 0) > 0) {
      want = reevaluateDefensiveBuildingWant(want, context.dangerAssessment);
    }
    want *= builderWeight;

    const id = building.id.toLowerCase();
    if ((city.goldPerTurn ?? 0) < 0 && (id.includes('market') || effects.goldBonus)) {
      want += 120;
    }
    if ((city.foodPerTurn ?? 0) <= 0 && (id.includes('granary') || effects.foodBonus)) {
      want += 100;
    }
    if (city.happiness.unhappy + city.happiness.angry > 0 && effects.happinessEffect) {
      want += 100;
    }
    if (building.genus === 'GreatWonder') want += Math.max(0, city.productionPerTurn ?? 0) * 4;
    if (building.genus === 'Convert') want = Math.max(want, 1);

    want = amortize(want, delay);
    if (want > 0) {
      choices.push({
        value: { kind: 'building', id: building.id },
        want,
        reason: 'domestic effects',
      });
    }
  }

  return choices.sort(
    (a, b) =>
      b.want - a.want ||
      a.value.kind.localeCompare(b.value.kind) ||
      a.value.id.localeCompare(b.value.id)
  );
}

export function chooseCityProduction(
  context: ProductionPlanningContext
): AIChoice<ProductionChoice> | undefined {
  return rankCityProduction(context)[0];
}

export interface ResearchPlanningContext {
  available: Technology[];
  catalogue: Technology[];
  unitTypes: Record<string, UnitType>;
  buildingTypes: Record<string, BuildingType>;
  governmentTechs: ReadonlySet<string>;
  militaryPressure: number;
  cityCount: number;
  profile?: AIProfile;
  researchedTechs?: ReadonlySet<string>;
}

function normalizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Aggregate technology wants from what each technology unlocks. This mirrors
 * the flow of `dai_manage_tech`: city, military, and government advisors feed
 * a shared technology want rather than choosing the cheapest advance.
 *
 * @reference reference/freeciv/ai/default/daitech.c
 */
export function chooseResearch(context: ResearchPlanningContext): AIChoice<Technology> | undefined {
  const directWants = new Map<string, { want: number; reasons: string[] }>();
  for (const tech of context.catalogue) {
    let want = 1;
    const reasons: string[] = [];

    for (const unit of Object.values(context.unitTypes)) {
      if (normalizeId(unit.requiredTech ?? '') !== normalizeId(tech.id)) continue;
      const replacement = unit.obsolete_by ? context.unitTypes[unit.obsolete_by] : undefined;
      if (replacement?.requiredTech && context.researchedTechs?.has(replacement.requiredTech)) {
        continue;
      }
      const military =
        unitAttack(unit) * Math.max(1, unit.movement) +
        unitDefense(unit) * (1 + context.militaryPressure);
      const domestic = unit.canFoundCity ? 35 : unit.canBuildImprovements ? 25 : 0;
      want +=
        military * 8 * ((context.profile?.traits.aggressive ?? 50) / 50) +
        domestic * ((context.profile?.traits.expansionist ?? 50) / 50);
      reasons.push(`unit:${unit.id}`);
    }
    for (const building of Object.values(context.buildingTypes)) {
      if (normalizeId(building.requiredTech ?? '') !== normalizeId(tech.id)) continue;
      const effects = building.effects ?? {};
      const buildingWant =
        15 +
        (effects.foodBonus ?? 0) * 18 +
        (effects.productionBonus ?? 0) * 16 +
        (effects.scienceBonus ?? 0) * 15 +
        (effects.goldBonus ?? 0) * 12 +
        (effects.happinessEffect ?? 0) * 22 +
        (effects.defenseBonus ?? 0) * context.militaryPressure * 10;
      want += buildingWant * ((context.profile?.traits.builder ?? 50) / 50);
      reasons.push(`building:${building.id}`);
    }
    if (
      [...context.governmentTechs].some(
        requirement => normalizeId(requirement) === normalizeId(tech.id)
      )
    ) {
      want += 80 + context.cityCount * 10;
      reasons.push('government');
    }
    directWants.set(tech.id, { want, reasons });
  }

  const techById = new Map(context.catalogue.map(tech => [tech.id, tech]));
  const distanceToPrerequisite = (
    goalId: string,
    prerequisiteId: string,
    visiting = new Set<string>()
  ): number | undefined => {
    if (goalId === prerequisiteId) return 0;
    if (visiting.has(goalId)) return undefined;
    const goal = techById.get(goalId);
    if (!goal) return undefined;
    const nextVisiting = new Set(visiting).add(goalId);
    const distances = goal.requirements
      .map(requirement => distanceToPrerequisite(requirement, prerequisiteId, nextVisiting))
      .filter((distance): distance is number => distance !== undefined);
    return distances.length > 0 ? Math.min(...distances) + 1 : undefined;
  };

  const choices = context.available.map(tech => {
    const direct = directWants.get(tech.id) ?? { want: 1, reasons: [] };
    let want = direct.want;
    const reasons = [...direct.reasons];
    let goalId = tech.id;
    let bestGoalContribution = direct.want;
    for (const goal of context.catalogue) {
      if (context.researchedTechs?.has(goal.id) || goal.id === tech.id) continue;
      const distance = distanceToPrerequisite(goal.id, tech.id);
      if (distance === undefined) continue;
      const goalWant = directWants.get(goal.id)?.want ?? 1;
      const contribution = amortize(goalWant, distance * 3) / (distance + 1);
      want += contribution;
      if (contribution > bestGoalContribution) {
        bestGoalContribution = contribution;
        goalId = goal.id;
      }
      if (goalWant > 1) reasons.push(`goal:${goal.id}`);
    }

    // Present value per bulb keeps a cheap useful advance competitive without
    // allowing cost alone to determine the research path.
    want = (want * 100) / Math.max(1, tech.cost);
    return {
      value: tech,
      want,
      reason: reasons.join('+') || 'future options',
      goalId,
    };
  });

  return choices.sort((a, b) => b.want - a.want || a.value.id.localeCompare(b.value.id))[0];
}

export interface MilitaryTarget {
  unit: Unit;
  want: number;
  distance: number;
}

export interface CitySite {
  tile: MapTile;
  want: number;
}

export interface TerrainYield {
  food?: number;
  shields?: number;
  trade?: number;
}

/**
 * Rank legal city centers by their workable terrain, resources, travel delay,
 * overlap, and danger. Path validity and reservations are applied by the
 * orchestrator because they require authoritative game state.
 *
 * @reference reference/freeciv/ai/default/daisettler.c:city_desirability
 * @reference reference/freeciv/ai/default/daisettler.c:find_best_city_placement
 */
export function rankCitySites(
  tiles: MapTile[],
  getNeighbors: (x: number, y: number) => MapTile[],
  getYield: (terrain: TerrainType) => TerrainYield,
  distance: (tile: MapTile) => number,
  nearbyCityDistance: (tile: MapTile) => number,
  danger: (tile: MapTile) => number,
  expansionWeight = 1
): CitySite[] {
  return tiles
    .map(tile => {
      const workable = [tile, ...getNeighbors(tile.x, tile.y)];
      const outputs = workable.reduce(
        (sum, candidate) => {
          const terrain = getYield(candidate.terrain);
          sum.food += terrain.food ?? 0;
          sum.shields += terrain.shields ?? 0;
          sum.trade += terrain.trade ?? 0;
          if (candidate.resource) sum.resource += 1;
          return sum;
        },
        { food: 0, shields: 0, trade: 0, resource: 0 }
      );
      const travel = distance(tile);
      const spacing = nearbyCityDistance(tile);
      const overlapPenalty = spacing < 4 ? (4 - spacing) * 20 : 0;
      const raw =
        outputs.food * 4 +
        outputs.shields * 3 +
        outputs.trade * 2 +
        outputs.resource * 8 -
        overlapPenalty -
        danger(tile) * 8;
      return {
        tile,
        want: amortize(raw * expansionWeight, travel),
      };
    })
    .filter(site => site.want > 0)
    .sort((a, b) => b.want - a.want || a.tile.x - b.tile.x || a.tile.y - b.tile.y);
}

/**
 * Expected shield-profit target value discounted by travel time.
 *
 * @reference reference/freeciv/doc/README.AI "Estimation of profit from a military operation"
 * @reference reference/freeciv/ai/default/daiunit.c:find_something_to_kill
 */
export function rankMilitaryTargets(
  attacker: Unit,
  attackerType: UnitType,
  enemies: Unit[],
  getType: (id: string) => UnitType | undefined,
  distance: (target: Unit) => number
): MilitaryTarget[] {
  const attackPower =
    unitAttack(attackerType) *
    Math.max(1, attackerType.firepower ?? 1) *
    Math.max(0.1, attacker.health / 100);
  const ourCost = Math.max(1, attackerType.cost ?? 1);

  return enemies
    .map(unit => {
      const defenderType = getType(unit.unitTypeId);
      if (!defenderType) return { unit, want: 0, distance: Number.MAX_SAFE_INTEGER };
      const defensePower =
        unitDefense(defenderType) *
        Math.max(1, defenderType.firepower ?? 1) *
        Math.max(0.1, unit.health / 100);
      const winProbability = attackPower / Math.max(1, attackPower + defensePower);
      const targetCost = Math.max(1, defenderType.cost ?? 1);
      const tileDistance = distance(unit);
      const battleProfit = targetCost * winProbability - ourCost * (1 - winProbability);
      const strategicBonus =
        (defenderType.canFoundCity ? 20 : 0) +
        (defenderType.canBuildImprovements ? 10 : 0) +
        ((defenderType.transport_capacity ?? 0) > 0 ? 15 : 0) +
        (tileDistance <= (attackerType.range ?? 1) ? 5 : 0);
      return {
        unit,
        want: amortize(
          battleProfit + strategicBonus,
          tileDistance / Math.max(1, attackerType.movement ?? 1)
        ),
        distance: tileDistance,
      };
    })
    .filter(target => target.want > 0)
    .sort(
      (a, b) => b.want - a.want || a.distance - b.distance || a.unit.id.localeCompare(b.unit.id)
    );
}
