/**
 * @module server/game/services/CityIllnessService
 * Calculates the authoritative C2C3 city illness state.
 */
import { EffectsManager, EffectType, type EffectContext } from '@game/managers/EffectsManager';
import type { CityState } from '@game/cities/CityTypes';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

export interface CityIllnessResult {
  illness: number;
  illnessSize: number;
  illnessTrade: number;
  illnessPollution: number;
  healthPct: number;
}

/** Implements Freeciv's city_illness_calc() with an authoritative city context. */
export class CityIllnessService {
  constructor(private readonly effectsManager: EffectsManager) {}

  public isEnabled(): boolean {
    return rulesetLoader.loadGameRulesRuleset(this.effectsManager.getRulesetName()).illness
      .illness_on;
  }

  /**
   * Calculates illness in tenths of a percent, including C2C3 health effects.
   * @reference reference/freeciv/common/city.c:2826-2918 city_illness_calc()
   */
  public calculate(
    city: CityState,
    allCities: Iterable<CityState>,
    currentTurn: number,
    effectContext: EffectContext
  ): CityIllnessResult {
    const rules = rulesetLoader.loadGameRulesRuleset(this.effectsManager.getRulesetName()).illness;
    let illnessSize = 0;
    let illnessTrade = 0;
    let illnessPollution = 0;

    if (rules.illness_on && city.population > rules.illness_min_size) {
      const useSize = city.population - rules.illness_min_size;
      illnessSize = Math.trunc((1 - Math.exp(-useSize / 10)) * 10 * rules.illness_base_factor);
      illnessTrade = this.calculateTradeIllness(city, allCities, currentTurn);
      illnessPollution = Math.trunc(((city.pollution ?? 0) * rules.illness_pollution_factor) / 100);
    }

    const healthPct = this.effectsManager.calculateEffect(
      EffectType.HEALTH_PCT,
      effectContext
    ).value;
    const illnessBase = illnessSize + illnessTrade + illnessPollution;
    return {
      illness: Math.max(0, Math.min(999, Math.trunc((illnessBase * (100 - healthPct)) / 100))),
      illnessSize,
      illnessTrade,
      illnessPollution,
      healthPct,
    };
  }

  private calculateTradeIllness(
    city: CityState,
    allCities: Iterable<CityState>,
    currentTurn: number
  ): number {
    const citiesById = new Map([...allCities].map(candidate => [candidate.id, candidate]));
    const rules = rulesetLoader.loadGameRulesRuleset(this.effectsManager.getRulesetName()).illness;
    const tradeIllness = (city.tradeRoutes ?? [])
      .filter(route => route.status !== 'disrupted')
      .reduce((total, route) => {
        const partner = citiesById.get(route.partnerCity);
        if (!partner || partner.turnPlague === undefined || currentTurn - partner.turnPlague >= 5) {
          return total;
        }
        return (
          total +
          (rules.illness_trade_infection * Math.sqrt(city.population * partner.population)) / 100
        );
      }, 0);
    return Math.trunc(tradeIllness);
  }
}
