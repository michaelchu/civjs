import { UNIT_TYPES } from '@game/constants/UnitConstants';
import { BUILDING_TYPES } from '@game/managers/CityManager';
import type { GameInstance } from '@game/managers/GameManager';
import { chooseGovernment } from '@game/ai/FreecivAIGovernmentPlanner';
import { rankResearch } from '@game/ai/FreecivAIPlanner';
import { createAIProfile } from '@game/ai/FreecivAIProfile';
import { hostileUnitsForPlanning } from '@game/ai/FreecivAITargeting';
import { planTreasury } from '@game/ai/FreecivAITreasuryPlanner';
import { createAIDecisionSource } from '@game/ai/FreecivAIDecisionSource';
import type { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';
import type { FreecivAIState } from '@game/ai/FreecivAIStateStore';
import {
  mergeTechnologyWants,
  rankEffectTechnologyWants,
  rankThreatTechnologyWants,
} from '@game/ai/FreecivAITechnologyWantPlanner';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

/**
 * Executes empire-level research, government, and treasury decisions.
 */
export class FreecivAIDomesticController {
  constructor(private readonly hostilityPolicy: DiplomacyHostilityPolicy) {}

  async selectResearch(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const research = game.researchManager.getPlayerResearch(playerId);
    const catalogue = game.researchManager.getTechnologyCatalogue?.(playerId);
    if (research?.currentTech && !catalogue) return 0;
    const available = game.researchManager.getAvailableTechnologies(playerId);
    const governmentTechs = new Set<string>();
    for (const government of Object.values(game.governmentManager?.getAllGovernments?.() ?? {})) {
      for (const requirement of government.reqs ?? []) {
        if (requirement.type.toLowerCase() === 'tech') governmentTechs.add(requirement.name);
      }
    }
    const cities = game.cityManager.getPlayerCities(playerId);
    const player = game.players.get(playerId);
    const profile = createAIProfile(player?.aiLevel, player?.aiTraits);
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(game.id, playerId);
    const hostileUnits = hostileUnitsForPlanning(game, playerId, hostileIds, profile);
    const knownTechs = new Set(research?.researchedTechs ?? []);
    const advisorWants = new Map(Object.entries(state.techWants));
    const effectWants = rankEffectTechnologyWants(cities, rulesetLoader.getEffects(), knownTechs);
    const threatWants = rankThreatTechnologyWants({
      cities,
      hostileUnits,
      unitTypes: UNIT_TYPES,
      researchedTechs: knownTechs,
      canBuildNow: (cityId, unitTypeId) =>
        game.cityManager.canCityContinueProduction?.(cityId, 'unit', unitTypeId) ?? false,
    });
    const strategicTechWants = mergeTechnologyWants(advisorWants, effectWants, threatWants);
    const ranked = catalogue
      ? rankResearch({
          available,
          catalogue,
          unitTypes: UNIT_TYPES,
          buildingTypes: BUILDING_TYPES,
          governmentTechs,
          militaryPressure: hostileIds.size,
          cityCount: cities.length,
          profile,
          researchedTechs: research?.researchedTechs,
          strategicTechWants,
        })
      : [];
    state.techWants = Object.fromEntries(strategicTechWants);
    const researchChoice = ranked[0];
    const choice =
      researchChoice?.value ??
      available.sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))[0];
    if (!choice) return 0;
    if (
      researchChoice?.goalId &&
      researchChoice.goalId !== research?.techGoal &&
      typeof game.researchManager.setResearchGoal === 'function'
    ) {
      await game.researchManager.setResearchGoal(playerId, researchChoice.goalId);
    }
    if (research?.currentTech) {
      if (choice.id === research.currentTech) return 0;
      const currentWant = ranked.find(
        candidate => candidate.value.id === research.currentTech
      )?.want;
      const penalty = Math.max(0, research.bulbsAccumulated ?? 0);
      if (currentWant === undefined || (researchChoice?.want ?? 0) - currentWant <= penalty) {
        return 0;
      }
    }
    if (choice.id === research?.currentTech) return 0;
    await game.researchManager.setCurrentResearch(playerId, choice.id);
    return 1;
  }

  async manageGovernment(game: GameInstance, playerId: string): Promise<number> {
    const manager = game.governmentManager;
    const research = game.researchManager.getPlayerResearch(playerId);
    const current = manager?.getPlayerGovernment(playerId);
    if (!manager || !research || !current || current.revolutionTurns > 0) return 0;
    const player = game.players.get(playerId);
    const profile = createAIProfile(player?.aiLevel, player?.aiTraits);
    if (profile.handicaps.has('revolution')) return 0;

    const available = manager
      .getAvailableGovernments(new Set(research.researchedTechs))
      .filter(candidate => candidate.available && candidate.id !== 'anarchy');
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(game.id, playerId);
    const best = chooseGovernment({
      currentGovernmentId: current.currentGovernment,
      availableGovernmentIds: available.map(candidate => candidate.id),
      cities: game.cityManager.getPlayerCities(playerId),
      units: game.unitManager.getPlayerUnits(playerId),
      atWar: hostileIds.size > 0,
      effect: (governmentId, type, outputType) =>
        manager.calculateGovernmentEffect(governmentId, type, outputType),
    });
    if (!best) return 0;
    if (!(await manager.canChangeGovernment(playerId, best.governmentId))) return 0;
    await manager.initiateRevolution(playerId, best.governmentId);
    return 1;
  }

  async manageEconomy(game: GameInstance, playerId: string): Promise<number> {
    const manager = game.turnManager.getEconomicManager?.();
    if (!manager) return 0;
    const status = await manager.getPlayerEconomicStatus(playerId);
    const cities = game.cityManager.getPlayerCities(playerId);
    const netGold = cities.reduce((sum, city) => sum + (city.goldPerTurn ?? 0), 0);
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(game.id, playerId);
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
    const hostileUnits = hostileUnitsForPlanning(game, playerId, hostileIds, profile);
    const plan = planTreasury({
      currentGold: status.currentGold,
      netGold,
      cities,
      unitCount: game.unitManager.getPlayerUnits(playerId).length,
      atWar: hostileIds.size > 0,
      unitTypes: UNIT_TYPES,
      buildingTypes: BUILDING_TYPES,
      buyCost: cityId => game.cityManager.calculateBuyCost(cityId),
      threat: city =>
        hostileUnits.reduce((sum, unit) => {
          const distance = game.mapManager.getDistance(city.x, city.y, unit.x, unit.y);
          if (distance > 4) return sum;
          const type = game.unitManager.getUnitType(unit.unitTypeId);
          return sum + (type?.attack ?? type?.combat ?? 0) / Math.max(1, distance);
        }, 0),
    });
    const decisions = createAIDecisionSource(game, playerId, 'treasury');
    let actions = 0;
    if (
      status.taxRates.tax !== plan.rates.tax ||
      status.taxRates.luxury !== plan.rates.luxury ||
      status.taxRates.science !== plan.rates.science
    ) {
      const result = manager.setPlayerTaxRates({ playerId, newRates: plan.rates });
      if (result.isValid) actions++;
    }
    if (typeof game.cityManager.sellBuildingForPlayer === 'function') {
      for (const sale of plan.sales) {
        const result = await game.cityManager.sellBuildingForPlayer(
          sale.cityId,
          sale.buildingId,
          playerId
        );
        if (result.success) actions++;
      }
    }
    for (const cityId of plan.rushCityIds) {
      // Freeciv applies ai_fuzzy while selecting the highest-want city to buy.
      // @reference reference/freeciv/ai/default/daicity.c:568-573
      if (!decisions.fuzzy(`rush:${cityId}`, true)) continue;
      const result = await game.cityManager.buyProduction(cityId, playerId);
      if (result.success) actions++;
    }
    return actions;
  }
}
