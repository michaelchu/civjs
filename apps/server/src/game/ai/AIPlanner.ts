/**
 * @module server/game/ai/AIPlanner
 * Implements AIPlanner decision logic for AI-controlled players.
 */
import type { CityState, BuildingType } from '@game/cities/CityTypes';
import type { Technology } from '@game/managers/ResearchManager';
import type { Unit } from '@game/units/UnitTypes';
import type { UnitType } from '@game/services/RulesetUnitsService';
import type { AIProfile } from '@game/ai/AIProfile';
import type { MapTile, TerrainType } from '@game/map/MapTypes';
import {
  reevaluateDefensiveBuildingWant,
  type CityDangerAssessment,
} from '@game/ai/AICityDangerPlanner';

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
  offensiveUnitWants?: ReadonlyMap<string, number>;
  buildingWants?: ReadonlyMap<string, { want: number; reason: string }>;
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

interface ProductionMetrics {
  cityUnits: Unit[];
  expansionNeed: number;
  workerNeed: number;
  defenseNeed: number;
  oceanTiles: number;
  aggressionWeight: number;
  builderWeight: number;
}

function calculateProductionMetrics(context: ProductionPlanningContext): ProductionMetrics {
  const { city, cities, units, unitTypes } = context;
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
  const workerCount = units.filter(unit => {
    const type = unitTypes[unit.unitTypeId];
    return type?.canBuildImprovements && !type.canFoundCity;
  }).length;
  const expansionWeight =
    ((context.profile?.expansion ?? 100) / 100) *
    ((context.profile?.traits.expansionist ?? 50) / 50);
  return {
    cityUnits,
    expansionNeed: Math.max(0, cities.length + 1 - settlerCount * 2) * expansionWeight,
    workerNeed: Math.max(0, cities.length - workerCount),
    defenseNeed:
      Math.max(0, 1 - defendersOnTile.length) * 90 +
      context.dangerAssessment.defenseDeficit +
      context.dangerAssessment.urgency,
    oceanTiles: (city.workableTiles ?? []).filter(tile =>
      ['ocean', 'deep_ocean', 'coast', 'lake'].includes(tile.terrain ?? '')
    ).length,
    aggressionWeight: (context.profile?.traits.aggressive ?? 50) / 50,
    builderWeight: (context.profile?.traits.builder ?? 50) / 50,
  };
}

function scoreUnitProduction(
  context: ProductionPlanningContext,
  metrics: ProductionMetrics,
  type: UnitType
): { want: number; reasons: string[] } {
  let want = 0;
  const reasons: string[] = [];
  if (type.canFoundCity) {
    want += metrics.expansionNeed * 45;
    reasons.push('expansion');
  }
  if (type.canBuildImprovements && !type.canFoundCity) {
    want += metrics.workerNeed * 35;
    reasons.push('infrastructure');
  }
  const defense = unitDefense(type);
  const attack = unitAttack(type);
  if (defense > 0) {
    want += metrics.defenseNeed * defense;
    reasons.push('defense');
  }
  const targetWant = context.offensiveUnitWants?.get(type.id);
  if (targetWant !== undefined) {
    want += targetWant * (attack > 0 ? metrics.aggressionWeight : 1);
    reasons.push(attack > 0 ? 'targeted military' : 'strategic support');
  } else if (attack > 0 && !context.offensiveUnitWants) {
    want +=
      ((attack * Math.max(1, type.movement) * Math.max(1, type.firepower ?? 1) * 14) /
        Math.max(1, type.cost)) *
      metrics.aggressionWeight;
    reasons.push('military');
  }
  if ((type.transport_capacity ?? 0) > 0) {
    const landUnits = context.units.filter(
      unit => context.unitTypes[unit.unitTypeId]?.unitClass === 'military'
    );
    want += landUnits.length * 4;
    reasons.push('transport');
  }
  const support = (type.uk_gold ?? 0) + (type.uk_shield ?? 0) * 2 + (type.uk_food ?? 0) * 2;
  want -= support * Math.max(1, metrics.cityUnits.length);
  return { want: amortize(want, turnsToBuild(context.city, type.cost)), reasons };
}

function rankUnitProduction(
  context: ProductionPlanningContext,
  metrics: ProductionMetrics
): AIChoice<ProductionChoice>[] {
  const choices: AIChoice<ProductionChoice>[] = [];
  for (const type of Object.values(context.unitTypes)) {
    if (!context.canBuild('unit', type.id)) continue;
    // Freeciv's domestic advisor only wants a city founder when the city has
    // enough food surplus to support its upkeep. Population cost is handled
    // separately when the unit completes, so it must not be used as a queue
    // legality check here.
    // @reference reference/freeciv/ai/default/daidomestic.c:541-572
    if (type.canFoundCity && (context.city.foodPerTurn ?? 0) < (type.uk_food ?? 0)) {
      continue;
    }
    if (context.excludedChoices?.has(`unit:${type.id}`)) continue;
    const { want, reasons } = scoreUnitProduction(context, metrics, type);
    if (want > 0) {
      choices.push({
        value: { kind: 'unit', id: type.id },
        want,
        reason: reasons.join('+') || 'unit utility',
      });
    }
  }
  return choices;
}

function buildingEffectsWant(
  context: ProductionPlanningContext,
  building: BuildingType,
  metrics: ProductionMetrics
): number {
  const effects = building.effects ?? {};
  return (
    (effects.foodBonus ?? 0) * 24 +
    (effects.productionBonus ?? 0) * 22 +
    (effects.scienceBonus ?? 0) * 18 +
    (effects.goldBonus ?? 0) * 16 +
    (effects.luxuryBonus ?? 0) * 10 +
    (effects.happinessEffect ?? 0) * 30 +
    (effects.defenseBonus ?? 0) * Math.max(10, metrics.defenseNeed) +
    (effects.oceanFood ?? 0) * metrics.oceanTiles * 24 +
    (effects.oceanShields ?? 0) * metrics.oceanTiles * 22 +
    (effects.immediateTechs ?? 0) * 150 +
    (effects.techParasitePlayers ?? 0) * 50 +
    ((effects.corruptionReduction ?? 0) *
      Math.max(0, context.city.grossTradePerTurn ?? context.city.tradePerTurn ?? 0)) /
      5
  );
}

function canRankBuilding(context: ProductionPlanningContext, building: BuildingType): boolean {
  if (!context.canBuild('building', building.id)) return false;
  if (context.excludedChoices?.has(`building:${building.id}`)) return false;
  return building.genus !== 'GreatWonder' || !context.reservedWonders?.has(building.id);
}

function baseBuildingWant(
  context: ProductionPlanningContext,
  building: BuildingType,
  metrics: ProductionMetrics
): number {
  const effects = building.effects ?? {};
  const citySize = context.city.size ?? context.city.population ?? 0;
  let want = buildingEffectsWant(context, building, metrics);
  if (effects.maxCitySize !== undefined) {
    want += Math.max(0, citySize - (effects.maxCitySize - 4)) * 60;
  }
  if (effects.unlimitedCitySize) want += Math.max(0, citySize - 8) * 45;
  if ((effects.defenseBonus ?? 0) > 0) {
    want = reevaluateDefensiveBuildingWant(want, context.dangerAssessment);
  }
  return want * metrics.builderWeight;
}

function situationalBuildingWant(
  context: ProductionPlanningContext,
  building: BuildingType
): number {
  const effects = building.effects ?? {};
  let want = 0;
  const id = building.id.toLowerCase();
  if ((context.city.goldPerTurn ?? 0) < 0 && (id.includes('market') || effects.goldBonus)) {
    want += 120;
  }
  if ((context.city.foodPerTurn ?? 0) <= 0 && (id.includes('granary') || effects.foodBonus)) {
    want += 100;
  }
  if (
    context.city.happiness.unhappy + context.city.happiness.angry > 0 &&
    effects.happinessEffect
  ) {
    want += 100;
  }
  if (building.genus === 'GreatWonder') {
    want += Math.max(0, context.city.productionPerTurn ?? 0) * 4;
  }
  return want;
}

function adjustBuildingWant(
  context: ProductionPlanningContext,
  building: BuildingType,
  metrics: ProductionMetrics
): number {
  let want = baseBuildingWant(context, building, metrics);
  want += situationalBuildingWant(context, building);
  if (building.genus === 'Convert') want = Math.max(want, 1);
  want += context.buildingWants?.get(building.id)?.want ?? 0;
  return amortize(want, turnsToBuild(context.city, building.cost));
}

function rankBuildingProduction(
  context: ProductionPlanningContext,
  metrics: ProductionMetrics
): AIChoice<ProductionChoice>[] {
  const choices: AIChoice<ProductionChoice>[] = [];
  for (const building of Object.values(context.buildingTypes)) {
    if (!canRankBuilding(context, building)) continue;
    const strategicWant = context.buildingWants?.get(building.id);
    const want = adjustBuildingWant(context, building, metrics);
    if (want > 0) {
      choices.push({
        value: { kind: 'building', id: building.id },
        want,
        reason: strategicWant?.reason ?? 'domestic effects',
      });
    }
  }
  return choices;
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
  const metrics = calculateProductionMetrics(context);
  const choices = [
    ...rankUnitProduction(context, metrics),
    ...rankBuildingProduction(context, metrics),
  ];
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
  strategicTechWants?: ReadonlyMap<string, number>;
}

function normalizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

interface ResearchWant {
  want: number;
  reasons: string[];
}

function unitUnlockWant(context: ResearchPlanningContext, tech: Technology): ResearchWant {
  let want = 0;
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
  return { want, reasons };
}

function buildingUnlockWant(context: ResearchPlanningContext, tech: Technology): ResearchWant {
  let want = 0;
  const reasons: string[] = [];
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
  return { want, reasons };
}

function directResearchWant(context: ResearchPlanningContext, tech: Technology): ResearchWant {
  let want = 1;
  const reasons: string[] = [];
  const strategicWant = context.strategicTechWants?.get(normalizeId(tech.id)) ?? 0;
  if (strategicWant !== 0) {
    want += strategicWant;
    reasons.push('advisor');
  }
  for (const unlock of [unitUnlockWant(context, tech), buildingUnlockWant(context, tech)]) {
    want += unlock.want;
    reasons.push(...unlock.reasons);
  }
  const unlocksGovernment = [...context.governmentTechs].some(
    requirement => normalizeId(requirement) === normalizeId(tech.id)
  );
  if (unlocksGovernment) {
    want += 80 + context.cityCount * 10;
    reasons.push('government');
  }
  return { want, reasons };
}

function prerequisiteDistance(
  techById: ReadonlyMap<string, Technology>,
  goalId: string,
  prerequisiteId: string,
  visiting = new Set<string>()
): number | undefined {
  if (goalId === prerequisiteId) return 0;
  if (visiting.has(goalId)) return undefined;
  const goal = techById.get(goalId);
  if (!goal) return undefined;
  const nextVisiting = new Set(visiting).add(goalId);
  const distances = goal.requirements
    .map(requirement => prerequisiteDistance(techById, requirement, prerequisiteId, nextVisiting))
    .filter((distance): distance is number => distance !== undefined);
  return distances.length > 0 ? Math.min(...distances) + 1 : undefined;
}

function rankAvailableTechnology(
  context: ResearchPlanningContext,
  tech: Technology,
  directWants: ReadonlyMap<string, ResearchWant>,
  techById: ReadonlyMap<string, Technology>
): AIChoice<Technology> {
  const direct = directWants.get(tech.id) ?? { want: 1, reasons: [] };
  let want = direct.want;
  const reasons = [...direct.reasons];
  let goalId = tech.id;
  let bestGoalContribution = direct.want;
  for (const goal of context.catalogue) {
    if (context.researchedTechs?.has(goal.id) || goal.id === tech.id) continue;
    const distance = prerequisiteDistance(techById, goal.id, tech.id);
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
  return {
    value: tech,
    want: (want * 100) / Math.max(1, tech.cost),
    reason: reasons.join('+') || 'future options',
    goalId,
  };
}

/**
 * Aggregate technology wants from what each technology unlocks. This mirrors
 * the flow of `dai_manage_tech`: city, military, and government advisors feed
 * a shared technology want rather than choosing the cheapest advance.
 *
 * @reference reference/freeciv/ai/default/daitech.c
 */
export function rankResearch(context: ResearchPlanningContext): AIChoice<Technology>[] {
  const directWants = new Map<string, ResearchWant>();
  for (const tech of context.catalogue) {
    directWants.set(tech.id, directResearchWant(context, tech));
  }

  const techById = new Map(context.catalogue.map(tech => [tech.id, tech]));
  const choices = context.available.map(tech =>
    rankAvailableTechnology(context, tech, directWants, techById)
  );

  return choices.sort((a, b) => b.want - a.want || a.value.id.localeCompare(b.value.id));
}

export function chooseResearch(context: ResearchPlanningContext): AIChoice<Technology> | undefined {
  return rankResearch(context)[0];
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
