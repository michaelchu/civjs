import { SERVER_URL } from '../config';

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
  private nationStylesCache = new Map<string, Record<string, string>>();

  static getInstance(): RulesetService {
    if (!RulesetService.instance) {
      RulesetService.instance = new RulesetService();
    }
    return RulesetService.instance;
  }

  async loadCitiesRuleset(rulesetName: string = 'classic'): Promise<CitiesRuleset> {
    const cached = this.citiesCache.get(rulesetName);
    if (cached) return cached;

    const response = await fetch(
      `${SERVER_URL}/api/rulesets/${encodeURIComponent(rulesetName)}/cities`
    );
    if (!response.ok) {
      throw new Error(`Failed to load ${rulesetName} city ruleset (${response.status})`);
    }
    const ruleset = (await response.json()) as CitiesRuleset;
    this.citiesCache.set(rulesetName, ruleset);
    return ruleset;
  }

  async getCityStyles(rulesetName: string = 'classic'): Promise<Record<string, CityStyle>> {
    return (await this.loadCitiesRuleset(rulesetName)).city_styles;
  }

  async getCityStyle(styleId: string, rulesetName: string = 'classic'): Promise<CityStyle | null> {
    return (await this.getCityStyles(rulesetName))[styleId] || null;
  }

  async getCityFoundingRules(rulesetName: string = 'classic'): Promise<CityFoundingRules> {
    return (await this.loadCitiesRuleset(rulesetName)).founding_rules;
  }

  async getNationStyles(rulesetName: string = 'classic'): Promise<Record<string, string>> {
    const cached = this.nationStylesCache.get(rulesetName);
    if (cached) return cached;
    const response = await fetch(
      `${SERVER_URL}/api/nations?ruleset=${encodeURIComponent(rulesetName)}`
    );
    if (!response.ok) {
      throw new Error(`Failed to load ${rulesetName} nation styles (${response.status})`);
    }
    const payload = (await response.json()) as {
      data?: { nations?: Array<{ id: string; style: string }> };
    };
    const nationStyles = Object.fromEntries(
      (payload.data?.nations || []).map(nation => [nation.id, nation.style])
    );
    this.nationStylesCache.set(rulesetName, nationStyles);
    return nationStyles;
  }

  clearCache(): void {
    this.citiesCache.clear();
    this.nationStylesCache.clear();
  }
}

export const rulesetService = RulesetService.getInstance();
