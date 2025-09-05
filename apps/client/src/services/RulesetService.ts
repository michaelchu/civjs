/**
 * Client-side ruleset service for accessing ruleset data
 * This service fetches ruleset data from the server and provides type-safe access
 */

export interface CityStyle {
  name: string;
  graphic: string;
  graphic_alt?: string;
  citizens_graphic?: string;
  citizens_graphic_alt?: string;
  techreq?: string;
  replaced_by?: string;
  oceanic_city_style?: boolean;
}

export interface CityFoundingRules {
  no_cities_terrains: string[];
  founding_units: string[];
  allow_foreign_territory: boolean;
  enemy_units_block: boolean;
  exploration_requirement: number;
}

export interface CitiesRuleset {
  city_styles: Record<string, CityStyle>;
  founding_rules: CityFoundingRules;
}

export class RulesetService {
  private static instance: RulesetService;
  private citiesCache = new Map<string, CitiesRuleset>();

  static getInstance(): RulesetService {
    if (!RulesetService.instance) {
      RulesetService.instance = new RulesetService();
    }
    return RulesetService.instance;
  }

  /**
   * Load cities ruleset for a specific ruleset variant
   * For now, return a hardcoded classic ruleset matching our server-side JSON
   */
  async loadCitiesRuleset(rulesetName: string = 'classic'): Promise<CitiesRuleset> {
    if (this.citiesCache.has(rulesetName)) {
      return this.citiesCache.get(rulesetName)!;
    }

    // For now, return hardcoded classic ruleset data
    // TODO: Replace with actual server API call
    const classicCitiesRuleset: CitiesRuleset = {
      city_styles: {
        european: {
          name: 'European',
          graphic: 'city.european',
          graphic_alt: 'city.classical',
          citizens_graphic: 'city.european_citizens',
          citizens_graphic_alt: 'city.generic_citizens',
        },
        classical: {
          name: 'Classical',
          graphic: 'city.classical',
          graphic_alt: 'city.european',
          citizens_graphic: 'city.classical_citizens',
          citizens_graphic_alt: 'city.generic_citizens',
        },
        tropical: {
          name: 'Tropical',
          graphic: 'city.tropical',
          graphic_alt: 'city.european',
          citizens_graphic: 'city.tropical_citizens',
          citizens_graphic_alt: 'city.generic_citizens',
        },
        asian: {
          name: 'Asian',
          graphic: 'city.asian',
          graphic_alt: 'city.classical',
          citizens_graphic: 'city.asian_citizens',
          citizens_graphic_alt: 'city.generic_citizens',
        },
        babylonian: {
          name: 'Babylonian',
          graphic: 'city.babylonian',
          graphic_alt: 'city.classical',
          citizens_graphic: 'city.babylonian_citizens',
          citizens_graphic_alt: 'city.generic_citizens',
        },
        celtic: {
          name: 'Celtic',
          graphic: 'city.celtic',
          graphic_alt: 'city.european',
          citizens_graphic: 'city.celtic_citizens',
          citizens_graphic_alt: 'city.generic_citizens',
        },
        industrial: {
          name: 'Industrial',
          graphic: 'city.industrial',
          graphic_alt: 'city.european',
          citizens_graphic: 'city.industrial_citizens',
          citizens_graphic_alt: 'city.generic_citizens',
          techreq: 'Railroad',
        },
        electricage: {
          name: 'ElectricAge',
          graphic: 'city.electricage',
          graphic_alt: 'city.industrial',
          citizens_graphic: 'city.electricage_citizens',
          citizens_graphic_alt: 'city.generic_citizens',
          techreq: 'Automobile',
          replaced_by: 'modern',
        },
        modern: {
          name: 'Modern',
          graphic: 'city.modern',
          graphic_alt: 'city.electricage',
          citizens_graphic: 'city.modern_citizens',
          citizens_graphic_alt: 'city.generic_citizens',
          techreq: 'Rocketry',
          replaced_by: 'postmodern',
        },
        postmodern: {
          name: 'PostModern',
          graphic: 'city.postmodern',
          graphic_alt: 'city.modern',
          citizens_graphic: 'city.postmodern_citizens',
          citizens_graphic_alt: 'city.generic_citizens',
          techreq: 'Laser',
        },
      },
      founding_rules: {
        no_cities_terrains: ['deep_ocean'],
        founding_units: ['Settlers', 'Engineers'],
        allow_foreign_territory: false,
        enemy_units_block: true,
        exploration_requirement: 1,
      },
    };

    this.citiesCache.set(rulesetName, classicCitiesRuleset);
    return classicCitiesRuleset;
  }

  /**
   * Get all city styles from a ruleset
   */
  async getCityStyles(rulesetName: string = 'classic'): Promise<Record<string, CityStyle>> {
    const ruleset = await this.loadCitiesRuleset(rulesetName);
    return ruleset.city_styles;
  }

  /**
   * Get a specific city style from a ruleset
   */
  async getCityStyle(styleId: string, rulesetName: string = 'classic'): Promise<CityStyle | null> {
    const styles = await this.getCityStyles(rulesetName);
    return styles[styleId] || null;
  }

  /**
   * Get city founding rules from a ruleset
   */
  async getCityFoundingRules(rulesetName: string = 'classic'): Promise<CityFoundingRules> {
    const ruleset = await this.loadCitiesRuleset(rulesetName);
    return ruleset.founding_rules;
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache(): void {
    this.citiesCache.clear();
  }
}

// Export singleton instance
export const rulesetService = RulesetService.getInstance();
