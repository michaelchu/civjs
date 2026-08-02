/**
 * @module server/game/services/RulesetRequirementEvaluator
 * Provides the server-side Ruleset Requirement Evaluator service.
 */
import type { RulesetRequirement, RulesetRequirementRange } from '@shared/data/rulesets/schemas';

export interface RulesetRequirementFacts {
  activity?: string;
  buildings?: ReadonlySet<string>;
  buildingGenus?: string;
  cityTiles?: ReadonlySet<string>;
  diplomaticRelations?: ReadonlySet<string>;
  extras?: ReadonlySet<string>;
  extraFlags?: ReadonlySet<string>;
  government?: string;
  goods?: ReadonlySet<string>;
  hitPoints?: number;
  latitude?: number;
  moves?: number;
  nationGroups?: ReadonlySet<string>;
  playerStates?: ReadonlySet<string>;
  size?: number;
  style?: string;
  technologies?: ReadonlySet<string>;
  terrain?: string;
  terrainAlterations?: ReadonlySet<string>;
  terrainClass?: string | ReadonlySet<string>;
  terrainFlags?: ReadonlySet<string>;
  unitClass?: string;
  unitClassFlags?: ReadonlySet<string>;
  unitsOnTile?: number;
  unitStates?: ReadonlySet<string>;
  unitTypeFlags?: ReadonlySet<string>;
}

export type RulesetRequirementContext = Partial<
  Record<RulesetRequirementRange, RulesetRequirementFacts>
>;

/**
 * Fail-closed evaluator for the universal requirement kinds present in the
 * classic action, extra, and style files.
 *
 * @reference reference/freeciv/common/requirements.c:4803-4828
 * @reference reference/freeciv/common/requirements.c:6495-6535
 */
export class RulesetRequirementEvaluator {
  evaluate(requirement: RulesetRequirement, context: RulesetRequirementContext): boolean {
    const facts = context[requirement.range];
    if (!facts) return false;
    const active = this.isActive(requirement, facts);
    return active === undefined ? false : requirement.present ? active : !active;
  }

  evaluateAll(requirements: RulesetRequirement[], context: RulesetRequirementContext): boolean {
    return requirements.every(requirement => this.evaluate(requirement, context));
  }

  private isActive(
    requirement: RulesetRequirement,
    facts: RulesetRequirementFacts
  ): boolean | undefined {
    const name = requirement.name;
    const equalFacts: Record<string, string | ReadonlySet<string> | undefined> = {
      Activity: facts.activity,
      BuildingGenus: facts.buildingGenus,
      Gov: facts.government,
      Style: facts.style,
      Terrain: facts.terrain,
      TerrainClass: facts.terrainClass,
      UnitClass: facts.unitClass,
    };
    const containedFacts: Record<string, ReadonlySet<string> | undefined> = {
      Building: facts.buildings,
      CityTile: facts.cityTiles,
      DiplRel: facts.diplomaticRelations,
      Extra: facts.extras,
      ExtraFlag: facts.extraFlags,
      NationGroup: facts.nationGroups,
      PlayerState: facts.playerStates,
      Tech: facts.technologies,
      tech: facts.technologies,
      TerrainAlter: facts.terrainAlterations,
      TerrainFlag: facts.terrainFlags,
      UnitClassFlag: facts.unitClassFlags,
      UnitState: facts.unitStates,
      UnitTypeFlag: facts.unitTypeFlags,
      Good: facts.goods,
      Resource: facts.goods,
    };
    if (Object.prototype.hasOwnProperty.call(equalFacts, requirement.type)) {
      return this.equal(equalFacts[requirement.type], name);
    }
    if (Object.prototype.hasOwnProperty.call(containedFacts, requirement.type)) {
      return this.contains(containedFacts[requirement.type], name);
    }
    const comparisons: Record<string, [number | undefined, (a: number, b: number) => boolean]> = {
      MaxHitPoints: [facts.hitPoints, (a, b) => a <= b],
      MaxLatitude: [facts.latitude, (a, b) => a <= b],
      MaxUnitsOnTile: [facts.unitsOnTile, (a, b) => a <= b],
      MinHitPoints: [facts.hitPoints, (a, b) => a >= b],
      MinLatitude: [facts.latitude, (a, b) => a >= b],
      MinMoveFrags: [facts.moves, (a, b) => a >= b],
      MinSize: [facts.size, (a, b) => a >= b],
    };
    const comparison = comparisons[requirement.type];
    return comparison ? this.compare(comparison[0], name, comparison[1]) : undefined;
  }

  private normalize(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private equal(
    actual: string | ReadonlySet<string> | undefined,
    expected: string
  ): boolean | undefined {
    if (actual === undefined) return undefined;
    return typeof actual === 'string'
      ? this.normalize(actual) === this.normalize(expected)
      : [...actual].some(value => this.normalize(value) === this.normalize(expected));
  }

  private contains(values: ReadonlySet<string> | undefined, expected: string): boolean | undefined {
    return values === undefined
      ? undefined
      : [...values].some(value => this.normalize(value) === this.normalize(expected));
  }

  private compare(
    actual: number | undefined,
    expected: string,
    predicate: (actualValue: number, expectedValue: number) => boolean
  ): boolean | undefined {
    const parsed = Number(expected);
    return actual === undefined || !Number.isFinite(parsed) ? undefined : predicate(actual, parsed);
  }
}
