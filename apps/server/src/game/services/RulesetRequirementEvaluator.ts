import type { RulesetRequirement, RulesetRequirementRange } from '@shared/data/rulesets/schemas';

export interface RulesetRequirementFacts {
  activity?: string;
  buildings?: Set<string>;
  buildingGenus?: string;
  cityTiles?: Set<string>;
  diplomaticRelations?: Set<string>;
  extras?: Set<string>;
  government?: string;
  hitPoints?: number;
  latitude?: number;
  moves?: number;
  nationGroups?: Set<string>;
  playerStates?: Set<string>;
  size?: number;
  style?: string;
  technologies?: Set<string>;
  terrain?: string;
  terrainAlterations?: Set<string>;
  terrainClass?: string;
  terrainFlags?: Set<string>;
  unitClass?: string;
  unitClassFlags?: Set<string>;
  unitsOnTile?: number;
  unitStates?: Set<string>;
  unitTypeFlags?: Set<string>;
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
    switch (requirement.type) {
      case 'Activity':
        return this.equal(facts.activity, name);
      case 'Building':
        return this.contains(facts.buildings, name);
      case 'BuildingGenus':
        return this.equal(facts.buildingGenus, name);
      case 'CityTile':
        return this.contains(facts.cityTiles, name);
      case 'DiplRel':
        return this.contains(facts.diplomaticRelations, name);
      case 'Extra':
        return this.contains(facts.extras, name);
      case 'Gov':
        return this.equal(facts.government, name);
      case 'MaxHitPoints':
        return this.compare(facts.hitPoints, name, (actual, expected) => actual <= expected);
      case 'MaxLatitude':
        return this.compare(facts.latitude, name, (actual, expected) => actual <= expected);
      case 'MaxUnitsOnTile':
        return this.compare(facts.unitsOnTile, name, (actual, expected) => actual <= expected);
      case 'MinHitPoints':
        return this.compare(facts.hitPoints, name, (actual, expected) => actual >= expected);
      case 'MinLatitude':
        return this.compare(facts.latitude, name, (actual, expected) => actual >= expected);
      case 'MinMoveFrags':
        return this.compare(facts.moves, name, (actual, expected) => actual >= expected);
      case 'MinSize':
        return this.compare(facts.size, name, (actual, expected) => actual >= expected);
      case 'NationGroup':
        return this.contains(facts.nationGroups, name);
      case 'PlayerState':
        return this.contains(facts.playerStates, name);
      case 'Style':
        return this.equal(facts.style, name);
      case 'Tech':
      case 'tech':
        return this.contains(facts.technologies, name);
      case 'Terrain':
        return this.equal(facts.terrain, name);
      case 'TerrainAlter':
        return this.contains(facts.terrainAlterations, name);
      case 'TerrainClass':
        return this.equal(facts.terrainClass, name);
      case 'TerrainFlag':
        return this.contains(facts.terrainFlags, name);
      case 'UnitClass':
        return this.equal(facts.unitClass, name);
      case 'UnitClassFlag':
        return this.contains(facts.unitClassFlags, name);
      case 'UnitState':
        return this.contains(facts.unitStates, name);
      case 'UnitTypeFlag':
        return this.contains(facts.unitTypeFlags, name);
      // These requirement kinds are preserved for ruleset integrity but do
      // not yet have facts supplied by every action/effect caller. Keep the
      // evaluator fail-closed until their runtime contexts are implemented.
      case 'DiplRelTileOther':
      case 'ExtraFlag':
      case 'Nation':
      case 'UnitType':
        return undefined;
      default:
        return undefined;
    }
  }

  private normalize(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private equal(actual: string | undefined, expected: string): boolean | undefined {
    return actual === undefined ? undefined : this.normalize(actual) === this.normalize(expected);
  }

  private contains(values: Set<string> | undefined, expected: string): boolean | undefined {
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
