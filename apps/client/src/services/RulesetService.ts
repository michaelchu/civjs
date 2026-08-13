/**
 * @module client/services/RulesetService
 * Provides the client-side Ruleset Service service.
 */
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
  reqs?: RulesetRequirement[];
}

export interface RulesetRequirement {
  type: string;
  name: string;
  range: string;
  present?: boolean;
}

export interface GraphicDefinition {
  name?: string;
  rule_name?: string;
  category?: string;
  causes?: string | string[];
  hidden_by?: string | string[];
  graphic?: string;
  graphic_alt?: string;
  graphic_alt2?: string;
  activity_gfx?: string;
  act_gfx_alt?: string;
  act_gfx_alt2?: string;
  /** Suppress the nation shield for foreign units while actively playing. */
  flagless?: boolean;
  offsets?: UnitOverlayOffsets;
}

export interface UnitOverlayOffsets {
  unitX: number;
  unitY: number;
  shieldX: number;
  shieldY: number;
  veteranX: number;
  veteranY: number;
  stackX: number;
  stackY: number;
  stackRingX: number;
  stackRingY: number;
  stackRingKey: 'unit.stk_shld_l' | 'unit.stk_shld_r' | 'unit.stack';
  shieldRight: boolean;
  shieldYAligned: boolean;
}

export interface NationStyle {
  name: string;
  rule_name?: string;
}

export interface MusicStyle {
  music_peaceful: string;
  music_combat: string;
  reqs: RulesetRequirement[];
}

export interface PresentationRuleset {
  nation_styles: Record<string, NationStyle>;
  city_styles: Record<string, CityStyle>;
  music_styles: Record<string, MusicStyle>;
  terrains: Record<string, GraphicDefinition>;
  units: Record<string, GraphicDefinition>;
  buildings: Record<string, GraphicDefinition>;
  extras: Record<string, GraphicDefinition>;
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
  private presentationCache = new Map<string, PresentationRuleset>();

  static getInstance(): RulesetService {
    if (!RulesetService.instance) {
      RulesetService.instance = new RulesetService();
    }
    return RulesetService.instance;
  }

  async loadCitiesRuleset(rulesetName: string = 'civ2civ3'): Promise<CitiesRuleset> {
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

  async getCityStyles(rulesetName: string = 'civ2civ3'): Promise<Record<string, CityStyle>> {
    return (await this.loadCitiesRuleset(rulesetName)).city_styles;
  }

  async getCityStyle(styleId: string, rulesetName: string = 'civ2civ3'): Promise<CityStyle | null> {
    return (await this.getCityStyles(rulesetName))[styleId] || null;
  }

  async getCityFoundingRules(rulesetName: string = 'civ2civ3'): Promise<CityFoundingRules> {
    return (await this.loadCitiesRuleset(rulesetName)).founding_rules;
  }

  async getNationStyles(rulesetName: string = 'civ2civ3'): Promise<Record<string, string>> {
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

  async loadPresentationRuleset(rulesetName: string = 'civ2civ3'): Promise<PresentationRuleset> {
    const cached = this.presentationCache.get(rulesetName);
    if (cached) return cached;
    const response = await fetch(
      `${SERVER_URL}/api/rulesets/${encodeURIComponent(rulesetName)}/presentation`
    );
    if (!response.ok) {
      throw new Error(`Failed to load ${rulesetName} presentation ruleset (${response.status})`);
    }
    const presentation = (await response.json()) as PresentationRuleset;
    this.presentationCache.set(rulesetName, presentation);
    return presentation;
  }

  clearCache(): void {
    this.citiesCache.clear();
    this.nationStylesCache.clear();
    this.presentationCache.clear();
  }
}

export const rulesetService = RulesetService.getInstance();
