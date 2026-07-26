import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

export interface RulesetBuildingType {
  id: string;
  name: string;
  cost: number;
  requiredTech?: string;
  requires?: string[];
  effects: {
    defenseBonus?: number;
    foodBonus?: number;
    productionBonus?: number;
    scienceBonus?: number;
    goldBonus?: number;
    luxuryBonus?: number;
    happinessEffect?: number;
  };
}

/**
 * Adapts the classic building ruleset to the city services' legacy interface.
 * @reference reference/freeciv/data/classic/buildings.ruleset
 */
export class RulesetBuildingsService {
  private cache = new Map<string, Record<string, RulesetBuildingType>>();

  getBuildingTypes(rulesetName: string = 'classic'): Record<string, RulesetBuildingType> {
    const cached = this.cache.get(rulesetName);
    if (cached) return cached;

    const buildings = Object.fromEntries(
      Object.entries(rulesetLoader.getBuildings(rulesetName)).map(([id, building]) => [
        id,
        {
          id: building.id,
          name: building.name,
          cost: building.cost,
          requiredTech: building.requiredTech,
          requires: building.requires,
          effects: {
            ...building.effects,
            happinessEffect: building.effects.happinessBonus,
          },
        },
      ])
    );
    this.cache.set(rulesetName, buildings);
    return buildings;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const rulesetBuildingsService = new RulesetBuildingsService();
