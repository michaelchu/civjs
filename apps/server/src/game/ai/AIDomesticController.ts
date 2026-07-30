import { UNIT_TYPES } from '@game/constants/UnitConstants';
import { BUILDING_TYPES } from '@game/managers/CityManager';
import type { GameInstance } from '@game/managers/GameManager';
import { chooseGovernment, rankGovernments } from '@game/ai/AIGovernmentPlanner';
import { rankResearch } from '@game/ai/AIPlanner';
import { createAIProfile } from '@game/ai/AIProfile';
import { hostileUnitsForPlanning } from '@game/ai/AITargeting';
import { planTreasury } from '@game/ai/AITreasuryPlanner';
import { createAIDecisionSource } from '@game/ai/AIDecisionSource';
import type { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';
import type { FreecivAIState } from '@game/ai/AIStateStore';
import {
  mergeTechnologyWants,
  rankEffectTechnologyWants,
  rankThreatTechnologyWants,
} from '@game/ai/AITechnologyWantPlanner';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { EffectType, OutputType as EffectOutputType } from '@game/managers/EffectsManager';
import { OutputType as CityOutputType } from '@game/constants/GameConstants';
import { CitizenParameterFactory } from '@game/systems/CitizenManagement/CitizenParameter';
import type { Technology } from '@game/managers/ResearchManager';

function normalizeRulesetId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

const unitTypesFor = (game: GameInstance) => game.unitManager.getUnitTypes?.() ?? UNIT_TYPES;
const buildingTypesFor = (game: GameInstance) =>
  game.cityManager.getBuildingTypes?.() ?? BUILDING_TYPES;

function createResearchDistance(
  catalogue: Technology[],
  researchedTechs: Iterable<string>
): (techId: string) => number {
  const techById = new Map(catalogue.map(tech => [normalizeRulesetId(tech.id), tech]));
  const knownTechs = new Set([...researchedTechs].map(normalizeRulesetId));
  const distanceToTech = (techId: string, visiting = new Set<string>()): number => {
    const normalized = normalizeRulesetId(techId);
    if (knownTechs.has(normalized)) return 0;
    if (visiting.has(normalized)) return Number.POSITIVE_INFINITY;
    const tech = techById.get(normalized);
    if (!tech) return 1;
    const next = new Set(visiting).add(normalized);
    return (
      1 + tech.requirements.reduce((sum, requirement) => sum + distanceToTech(requirement, next), 0)
    );
  };
  return distanceToTech;
}

/**
 * Executes empire-level research, government, and treasury decisions.
 */
export class FreecivAIDomesticController {
  constructor(private readonly hostilityPolicy: DiplomacyHostilityPolicy) {}

  private shouldChangeResearch(
    currentTech: string | undefined,
    bulbsAccumulated: number | undefined,
    choiceId: string,
    choiceWant: number | undefined,
    ranked: ReturnType<typeof rankResearch>
  ): boolean {
    if (!currentTech) return true;
    if (choiceId === currentTech) return false;
    const currentWant = ranked.find(candidate => candidate.value.id === currentTech)?.want;
    const penalty = Math.max(0, bulbsAccumulated ?? 0);
    return currentWant !== undefined && (choiceWant ?? 0) - currentWant > penalty;
  }

  private async updateResearchGoal(
    game: GameInstance,
    playerId: string,
    goalId: string | undefined,
    currentGoal: string | undefined
  ): Promise<void> {
    if (
      goalId &&
      goalId !== currentGoal &&
      typeof game.researchManager.setResearchGoal === 'function'
    ) {
      await game.researchManager.setResearchGoal(playerId, goalId);
    }
  }

  private governmentTechnologyIds(game: GameInstance): Set<string> {
    const technologyIds = new Set<string>();
    const governments = Object.values(game.governmentManager?.getAllGovernments?.() ?? {});
    for (const government of governments) {
      for (const requirement of government.reqs ?? []) {
        if (requirement.type.toLowerCase() === 'tech') technologyIds.add(requirement.name);
      }
    }
    return technologyIds;
  }

  private async strategicResearchContext(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState,
    knownTechs: ReadonlySet<string>
  ) {
    const cities = game.cityManager.getPlayerCities(playerId);
    const player = game.players.get(playerId);
    const profile = createAIProfile(player?.aiLevel, player?.aiTraits);
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(game.id, playerId);
    const hostileUnits = hostileUnitsForPlanning(game, playerId, hostileIds, profile);
    const advisorWants = new Map(Object.entries(state.techWants));
    const effectWants = rankEffectTechnologyWants(cities, rulesetLoader.getEffects(), knownTechs);
    const threatWants = rankThreatTechnologyWants({
      cities,
      hostileUnits,
      unitTypes: unitTypesFor(game),
      researchedTechs: knownTechs,
      canBuildNow: (cityId, unitTypeId) =>
        game.cityManager.canCityContinueProduction?.(cityId, 'unit', unitTypeId) ?? false,
    });
    return {
      cities,
      profile,
      hostileCount: hostileIds.size,
      strategicTechWants: mergeTechnologyWants(advisorWants, effectWants, threatWants),
    };
  }

  async selectResearch(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const { research, available, ranked } = await this.rankResearchChoices(game, playerId, state);
    const researchChoice = ranked[0];
    const choice =
      researchChoice?.value ??
      available.sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))[0];
    if (!choice) return 0;
    await this.updateResearchGoal(game, playerId, researchChoice?.goalId, research?.techGoal);
    if (
      !this.shouldChangeResearch(
        research?.currentTech,
        research?.bulbsAccumulated,
        choice.id,
        researchChoice?.want,
        ranked
      )
    ) {
      return 0;
    }
    await game.researchManager.setCurrentResearch(playerId, choice.id);
    return 1;
  }

  private async rankResearchChoices(game: GameInstance, playerId: string, state: FreecivAIState) {
    const research = game.researchManager.getPlayerResearch(playerId);
    const catalogue = game.researchManager.getTechnologyCatalogue?.(playerId);
    const available = game.researchManager.getAvailableTechnologies(playerId);
    if (research?.currentTech && !catalogue) {
      return { research, available: [], ranked: [] };
    }
    const knownTechs = new Set(research?.researchedTechs ?? []);
    const strategy = await this.strategicResearchContext(game, playerId, state, knownTechs);
    const ranked = catalogue
      ? rankResearch({
          available,
          catalogue,
          unitTypes: unitTypesFor(game),
          buildingTypes: buildingTypesFor(game),
          governmentTechs: this.governmentTechnologyIds(game),
          militaryPressure: strategy.hostileCount,
          cityCount: strategy.cities.length,
          profile: strategy.profile,
          researchedTechs: research?.researchedTechs,
          strategicTechWants: strategy.strategicTechWants,
        })
      : [];
    state.techWants = Object.fromEntries(strategy.strategicTechWants);
    return { research, available, ranked };
  }

  async manageGovernment(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
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
    const planningContext = {
      currentGovernmentId: current.currentGovernment,
      cities: game.cityManager.getPlayerCities(playerId),
      units: game.unitManager.getPlayerUnits(playerId),
      atWar: hostileIds.size > 0,
      effect: (governmentId: string, type: EffectType, outputType?: EffectOutputType) =>
        manager.calculateGovernmentEffect(governmentId, type, outputType),
    };
    const governments = manager.getAllGovernments();
    const catalogue = game.researchManager.getTechnologyCatalogue?.(playerId) ?? [];
    const distanceToTech = createResearchDistance(catalogue, research.researchedTechs);
    const governmentDistance = (governmentId: string) =>
      (governments[governmentId]?.reqs ?? [])
        .filter(requirement => requirement.type.toLowerCase() === 'tech')
        .reduce(
          (sum, requirement) => sum + distanceToTech(normalizeRulesetId(requirement.name)),
          0
        );
    const updateFutureGovernmentWants = () => {
      const futureChoices = rankGovernments({
        ...planningContext,
        availableGovernmentIds: Object.keys(governments),
        researchDistance: governmentDistance,
      });
      for (const choice of futureChoices) {
        const distance = governmentDistance(choice.governmentId);
        if (distance <= 0 || !Number.isFinite(distance) || choice.netGain <= 0) continue;
        const techRequirements = (governments[choice.governmentId]?.reqs ?? []).filter(
          requirement => requirement.type.toLowerCase() === 'tech'
        );
        for (const requirement of techRequirements) {
          const techId = normalizeRulesetId(requirement.name);
          state.techWants[techId] =
            (state.techWants[techId] ?? 0) + choice.netGain / Math.max(1, 20 * distance);
        }
      }
    };
    updateFutureGovernmentWants();
    const best = chooseGovernment({
      ...planningContext,
      availableGovernmentIds: available.map(candidate => candidate.id),
    });
    if (!best) return 0;
    if (!(await manager.canChangeGovernment(playerId, best.governmentId))) return 0;
    await manager.initiateRevolution(playerId, best.governmentId);
    return 1;
  }

  private async createTreasuryPlan(game: GameInstance, playerId: string, state: FreecivAIState) {
    const manager = game.turnManager.getEconomicManager?.();
    if (!manager) return undefined;
    const status = await manager.getPlayerEconomicStatus(playerId);
    const cities = game.cityManager.getPlayerCities(playerId);
    const netGold = cities.reduce((sum, city) => sum + (city.goldPerTurn ?? 0), 0);
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(game.id, playerId);
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
    const hostileUnits = hostileUnitsForPlanning(game, playerId, hostileIds, profile);
    const governmentId = game.governmentManager?.getPlayerGovernment(playerId)?.currentGovernment;
    const governmentEffect = (type: EffectType) =>
      governmentId
        ? (game.governmentManager?.calculateGovernmentEffect(governmentId, type) ?? 0)
        : 0;
    const plan = planTreasury({
      currentGold: status.currentGold,
      netGold,
      cities,
      unitCount: game.unitManager.getPlayerUnits(playerId).length,
      atWar: hostileIds.size > 0,
      unitTypes: unitTypesFor(game),
      buildingTypes: buildingTypesFor(game),
      buyCost: cityId => game.cityManager.calculateBuyCost(cityId),
      threat: city =>
        hostileUnits.reduce((sum, unit) => {
          const distance = game.mapManager.getDistance(city.x, city.y, unit.x, unit.y);
          if (distance > 4) return sum;
          const type = game.unitManager.getUnitType(unit.unitTypeId);
          return sum + (type?.attack ?? type?.combat ?? 0) / Math.max(1, distance);
        }, 0),
      maxRate: profile.handicaps.has('rates') ? governmentEffect(EffectType.MAX_RATES) || 100 : 100,
      canRaptureGrow: governmentEffect(EffectType.RAPTURE_GROW) > 0,
      awayMode: profile.handicaps.has('away'),
      celebrateSize: Number(rulesetLoader.loadCitiesRuleset().parameters.celebrate_size_limit ?? 3),
      existingSavingsGoal: state.treasuryGoal,
    });
    return { manager, currentRates: status.taxRates, plan };
  }

  private async applyTreasuryPlan(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState,
    currentRates: { tax: number; luxury: number; science: number },
    plan: ReturnType<typeof planTreasury>
  ): Promise<number> {
    const manager = game.turnManager.getEconomicManager?.();
    if (!manager) return 0;
    const decisions = createAIDecisionSource(game, playerId, 'treasury');
    let actions = 0;
    if (
      currentRates.tax !== plan.rates.tax ||
      currentRates.luxury !== plan.rates.luxury ||
      currentRates.science !== plan.rates.science
    ) {
      const result = manager.setPlayerTaxRates({ playerId, newRates: plan.rates });
      if (result.isValid) actions++;
    }
    actions += await this.applyBuildingSales(game, playerId, plan.sales);
    for (const cityId of plan.rushCityIds) {
      if (!decisions.fuzzy(`rush:${cityId}`, true)) continue;
      const result = await game.cityManager.buyProduction(cityId, playerId);
      if (result.success) {
        state.treasuryGoal = undefined;
        actions++;
      }
    }
    actions += await this.applyCelebrations(game, plan.celebrationCityIds);
    return actions;
  }

  private async applyBuildingSales(
    game: GameInstance,
    playerId: string,
    sales: ReturnType<typeof planTreasury>['sales']
  ): Promise<number> {
    if (typeof game.cityManager.sellBuildingForPlayer !== 'function') return 0;
    let actions = 0;
    for (const sale of sales) {
      const result = await game.cityManager.sellBuildingForPlayer(
        sale.cityId,
        sale.buildingId,
        playerId
      );
      if (result.success) actions++;
    }
    return actions;
  }

  private async applyCelebrations(game: GameInstance, cityIds: string[]): Promise<number> {
    if (typeof game.cityManager.optimizeCityManually !== 'function') return 0;
    let actions = 0;
    for (const cityId of cityIds) {
      const parameters = CitizenParameterFactory.createDefault();
      parameters.require_happy = true;
      parameters.allow_disorder = false;
      parameters.allow_specialists = true;
      parameters.max_growth = true;
      parameters.factor[CityOutputType.FOOD] = 20;
      parameters.minimal_surplus[CityOutputType.FOOD] = 1;
      if (await game.cityManager.optimizeCityManually(cityId, parameters)) actions++;
    }
    return actions;
  }

  async manageEconomy(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const planning = await this.createTreasuryPlan(game, playerId, state);
    if (!planning) return 0;
    state.treasuryGoal = planning.plan.savingsGoal;
    return this.applyTreasuryPlan(game, playerId, state, planning.currentRates, planning.plan);
  }
}
