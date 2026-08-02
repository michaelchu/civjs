/**
 * @module server/game/services/RulesetBuildingsService
 * Provides the server-side Ruleset Buildings Service service.
 */
import { rulesetLoader, type RulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type {
  BuildingCultureRequirement,
  BuildingTypeRuleset,
} from '@shared/data/rulesets/schemas';

export interface RulesetBuildingType {
  id: string;
  name: string;
  genus: 'Improvement' | 'SmallWonder' | 'GreatWonder' | 'Special' | 'Convert';
  cost: number;
  upkeep: number;
  sabotage?: number;
  requiredTech?: string;
  requires?: string[];
  cultureRequirements?: BuildingCultureRequirement[];
  flags: string[];
  playable: boolean;
  effects: {
    defenseBonus?: number;
    foodBonus?: number;
    productionBonus?: number;
    scienceBonus?: number;
    goldBonus?: number;
    luxuryBonus?: number;
    happinessEffect?: number;
    maxCitySize?: number;
    unlimitedCitySize?: boolean;
    oceanFood?: number;
    oceanShields?: number;
    immediateTechs?: number;
    techParasitePlayers?: number;
    corruptionReduction?: number;
  };
}

/**
 * Adapts the classic building ruleset to the city services' legacy interface.
 * @reference reference/freeciv/data/classic/buildings.ruleset
 */
export class RulesetBuildingsService {
  private cache = new Map<string, Record<string, RulesetBuildingType>>();

  constructor(private readonly loader: Pick<RulesetLoader, 'getBuildings'> = rulesetLoader) {}

  getBuildingTypes(rulesetName: string = 'classic'): Record<string, RulesetBuildingType> {
    const cached = this.cache.get(rulesetName);
    if (cached) return cached;

    const buildings = Object.fromEntries(
      Object.entries(this.loader.getBuildings(rulesetName)).map(([id, building]) => {
        const rawFlags = (building as BuildingTypeRuleset & { flags?: unknown }).flags;
        const flags = Array.isArray(rawFlags)
          ? rawFlags.filter((flag): flag is string => typeof flag === 'string')
          : typeof rawFlags === 'string'
            ? [rawFlags]
            : [];
        return [
          id,
          {
            id: building.id,
            name: building.name,
            genus: building.genus,
            cost: building.cost,
            upkeep: building.upkeep,
            sabotage: building.sabotage,
            requiredTech: building.requiredTech,
            requires: building.requires,
            cultureRequirements: building.cultureRequirements,
            flags,
            playable: building.playable,
            effects: {
              ...building.effects,
              happinessEffect: building.effects.happinessBonus,
            },
          },
        ];
      })
    );
    this.cache.set(rulesetName, buildings);
    return buildings;
  }

  getPlayableBuildingTypes(rulesetName: string = 'classic'): Record<string, RulesetBuildingType> {
    return Object.fromEntries(
      Object.entries(this.getBuildingTypes(rulesetName)).filter(
        ([, building]) => building.playable || building.genus === 'GreatWonder'
      )
    );
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const rulesetBuildingsService = new RulesetBuildingsService();
