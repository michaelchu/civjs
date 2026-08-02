/**
 * @module server/game/services/UnitProductionValidationService
 * Provides the server-side Unit Production Validation Service service.
 */
import type { UnitType } from '@game/services/RulesetUnitsService';
import {
  RulesetRequirementEvaluator,
  type RulesetRequirementFacts,
} from './RulesetRequirementEvaluator';

export interface UnitProductionFacts {
  playerTechnologies: ReadonlySet<string>;
  government?: string;
  playerBuildings?: ReadonlySet<string>;
  playerGoods?: ReadonlySet<string>;
  playerUnitTypes?: ReadonlySet<string>;
  cityBuildings?: ReadonlySet<string>;
  cityGoods?: ReadonlySet<string>;
  worldBuildings?: ReadonlySet<string>;
  nukeEnabled?: boolean;
  preventNewCities?: boolean;
  localTerrain?: string;
  adjacentTerrains?: readonly string[];
  nativeUnitClassesByTerrain?: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Authoritative unit production prerequisite evaluation.
 *
 * @reference reference/freeciv/common/city.c:903-974
 * @reference reference/freeciv/common/movement.c:496-511
 */
export class UnitProductionValidationService {
  private readonly requirements = new RulesetRequirementEvaluator();

  constructor(private readonly unitTypes: Record<string, UnitType>) {}

  canBuildUnit(
    unit: UnitType,
    facts: UnitProductionFacts,
    includeObsoleteCheck = true,
    requireNativeTerrain = true
  ): boolean {
    if (!this.canBuildUnitDirect(unit, facts, requireNativeTerrain)) return false;
    return !includeObsoleteCheck || !this.hasBuildableReplacement(unit, facts);
  }

  private canBuildUnitDirect(
    unit: UnitType,
    facts: UnitProductionFacts,
    requireNativeTerrain: boolean
  ): boolean {
    if (!this.hasBuildableUnitFlags(unit, facts)) return false;
    if (!this.hasBuildRequirements(unit, facts)) return false;
    if (requireNativeTerrain && !this.isNativeNearCity(unit, facts)) return false;
    return true;
  }

  private hasBuildableUnitFlags(unit: UnitType, facts: UnitProductionFacts): boolean {
    return !(
      unit.flags?.includes('NoBuild') ||
      unit.flags?.includes('BarbarianOnly') ||
      (unit.flags?.includes('NewCityGamesOnly') && facts.preventNewCities) ||
      (unit.flags?.includes('Nuclear') && facts.nukeEnabled !== true) ||
      (unit.flags?.includes('Unique') && facts.playerUnitTypes?.has(unit.id))
    );
  }

  private hasBuildableReplacement(unit: UnitType, facts: UnitProductionFacts): boolean {
    let replacementId = unit.obsolete_by;
    const visited = new Set<string>();
    while (replacementId && !visited.has(replacementId)) {
      visited.add(replacementId);
      const replacement = this.unitTypes[replacementId];
      if (!replacement) break;
      // Freeciv checks whether the player can build the replacement anywhere,
      // assuming a coastal city. The current city's native terrain must not
      // prevent an otherwise valid replacement from obsoleting this unit.
      if (this.canBuildUnit(replacement, facts, false, false)) return true;
      replacementId = replacement.obsolete_by;
    }

    return false;
  }

  private hasBuildRequirements(unit: UnitType, facts: UnitProductionFacts): boolean {
    if (
      unit.requiredTech &&
      !this.containsNormalized(facts.playerTechnologies, unit.requiredTech)
    ) {
      return false;
    }

    const requirements = unit.buildRequirements ?? [];
    if (requirements.length === 0) return true;

    const playerFacts: RulesetRequirementFacts = {
      technologies: facts.playerTechnologies,
      government: facts.government,
      buildings: facts.playerBuildings,
      goods: facts.playerGoods,
    };
    const cityFacts: RulesetRequirementFacts = {
      buildings: facts.cityBuildings,
      goods: facts.cityGoods,
      terrain: facts.localTerrain,
    };
    const worldFacts: RulesetRequirementFacts = {
      buildings: facts.worldBuildings,
    };
    const localFacts: RulesetRequirementFacts = {
      terrain: facts.localTerrain,
    };

    return this.requirements.evaluateAll(requirements, {
      Player: playerFacts,
      City: cityFacts,
      World: worldFacts,
      Local: localFacts,
    });
  }

  private isNativeNearCity(unit: UnitType, facts: UnitProductionFacts): boolean {
    if (unit.rulesetUnitClassFlags?.includes('BuildAnywhere')) return true;

    // Freeciv's Sea and Trireme classes are native to water, and therefore
    // require a city tile or adjacent tile that is native to the class.
    const terrains = [facts.localTerrain, ...(facts.adjacentTerrains ?? [])].filter(
      (terrain): terrain is string => Boolean(terrain)
    );
    if (facts.nativeUnitClassesByTerrain && unit.rulesetUnitClass) {
      return terrains.some(terrain =>
        facts.nativeUnitClassesByTerrain?.get(terrain)?.has(unit.rulesetUnitClass ?? '')
      );
    }

    // Compatibility fallback for callers that do not yet provide the loaded
    // terrain catalogue. These are the Civ2Civ3 native water mappings.
    if (unit.rulesetUnitClass !== 'Sea' && unit.rulesetUnitClass !== 'Trireme') return true;
    const nativeTerrains =
      unit.rulesetUnitClass === 'Trireme'
        ? new Set(['ocean', 'lake'])
        : new Set(['ocean', 'deep_ocean', 'lake']);
    return terrains.some(terrain => nativeTerrains.has(terrain));
  }

  private containsNormalized(values: ReadonlySet<string>, expected: string): boolean {
    const normalizedExpected = this.normalize(expected);
    return [...values].some(value => this.normalize(value) === normalizedExpected);
  }

  private normalize(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }
}
