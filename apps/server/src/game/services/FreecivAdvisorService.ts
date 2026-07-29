import { ActionType } from '@app-types/shared/actions';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import { createAIProfile } from '@game/ai/FreecivAIProfile';
import { buildAuthoritativeCityDangerAssessments } from '@game/ai/FreecivAICityDangerPlanner';
import { explorationAdditionalStepCost, planExploration } from '@game/ai/FreecivAIExplorerPlanner';
import { rankCityProduction, rankMilitaryTargets, rankResearch } from '@game/ai/FreecivAIPlanner';
import { planTreasury } from '@game/ai/FreecivAITreasuryPlanner';
import { planWorkerImprovements } from '@game/ai/FreecivAIWorkerPlanner';
import { BUILDING_TYPES } from '@game/managers/CityManager';
import { EffectType } from '@game/managers/EffectsManager';
import type { GameInstance } from '@game/managers/GameManager';
import type { Unit } from '@game/managers/UnitManager';
import type { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';
import { planSpaceship } from '@game/ai/FreecivAISpaceshipPlanner';

export interface AdvisorRecommendations {
  playerId: string;
  turn: number;
  economy: {
    reserve: number;
    rates: { tax: number; luxury: number; science: number };
    rushCityIds: string[];
    saleCandidates: Array<{ cityId: string; buildingId: string }>;
  };
  research: Array<{ technologyId: string; want: number; reason: string; goalId?: string }>;
  cities: Array<{
    cityId: string;
    danger: number;
    urgency: number;
    production: Array<{
      kind: 'unit' | 'building';
      id: string;
      want: number;
      reason: string;
    }>;
  }>;
  workers: Array<{
    unitId: string;
    x: number;
    y: number;
    action: ActionType;
    want: number;
  }>;
  exploration: Array<{ unitId: string; x: number; y: number; want: number }>;
  military: Array<{
    unitId: string;
    targetUnitId: string;
    want: number;
    distance: number;
  }>;
}

/**
 * Read-only shared advisor facade. Human clients and AI execution consume the
 * same native ranking functions; requesting advice never mutates game state.
 *
 * @reference reference/freeciv/server/advisors
 * @reference reference/freeciv/server/advisors/advchoice.c
 */
export class FreecivAdvisorService {
  constructor(private readonly hostilityPolicy: DiplomacyHostilityPolicy) {}

  async getRecommendations(game: GameInstance, playerId: string): Promise<AdvisorRecommendations> {
    const player = game.players.get(playerId);
    if (!player) throw new Error('Player not found in game');
    const profile = createAIProfile('hard', player.aiTraits);
    const relations = await this.hostilityPolicy.getRelationPlayerIds(game.id, playerId);
    const visibleUnits = game.unitManager.getVisibleUnits(
      playerId,
      game.visibilityManager.getVisibleTiles(playerId),
      game.visibilityManager.getDetectionTiles(playerId)
    );
    const hostileUnits = visibleUnits.filter(unit => relations.hostile.has(unit.playerId));
    const friendlyUnits = game.unitManager.getPlayerUnits(playerId);
    const cities = game.cityManager.getPlayerCities(playerId);
    const research = game.researchManager.getPlayerResearch(playerId);
    const knownTechs = new Set(research?.researchedTechs ?? []);
    const spaceshipPlan = planSpaceship({
      enabled: (game.config?.victoryConditions ?? []).some(condition =>
        ['science', 'spaceship'].includes(condition)
      ),
      playerId,
      citiesByPlayer: new Map(
        [...game.players.keys()].map(candidateId => [
          candidateId,
          game.cityManager.getPlayerCities(candidateId),
        ])
      ),
      technologyCount: candidateId =>
        game.researchManager.getPlayerResearch(candidateId)?.researchedTechs.size ?? 0,
      spaceshipState: candidateId => game.players.get(candidateId)?.spaceshipState,
    });
    const governmentTechs = new Set<string>();
    for (const government of Object.values(game.governmentManager?.getAllGovernments?.() ?? {})) {
      for (const requirement of government.reqs ?? []) {
        if (requirement.type.toLowerCase() === 'tech') governmentTechs.add(requirement.name);
      }
    }
    const dangerByCity = await buildAuthoritativeCityDangerAssessments({
      game,
      cities,
      friendlyUnits,
      threateningUnits: hostileUnits,
      profile,
    });

    const cityRecommendations = cities.map(city => {
      const danger = dangerByCity.get(city.id)!;
      const production = rankCityProduction({
        city,
        cities,
        units: friendlyUnits,
        unitTypes: UNIT_TYPES,
        buildingTypes: BUILDING_TYPES,
        canBuild: (kind, id) =>
          game.cityManager.canCityContinueProduction?.(city.id, kind, id) ?? false,
        dangerAssessment: danger,
        profile,
        buildingWants: spaceshipPlan.buildingWants.get(city.id),
      })
        .slice(0, 5)
        .map(choice => ({
          kind: choice.value.kind,
          id: choice.value.id,
          want: choice.want,
          reason: choice.reason,
        }));
      return {
        cityId: city.id,
        danger: danger.danger,
        urgency: danger.urgency,
        production,
      };
    });

    const catalogue = game.researchManager.getTechnologyCatalogue?.(playerId) ?? [];
    const researchChoices = rankResearch({
      available: game.researchManager.getAvailableTechnologies(playerId),
      catalogue,
      unitTypes: UNIT_TYPES,
      buildingTypes: BUILDING_TYPES,
      governmentTechs,
      militaryPressure: relations.hostile.size,
      cityCount: cities.length,
      profile,
      researchedTechs: knownTechs,
      strategicTechWants: new Map([
        ...Object.entries(
          player.isAI && player.aiState && typeof player.aiState.techWants === 'object'
            ? (player.aiState.techWants as Record<string, number>)
            : {}
        ),
        ...spaceshipPlan.technologyWants,
      ]),
    })
      .slice(0, 5)
      .map(choice => ({
        technologyId: choice.value.id,
        want: choice.want,
        reason: choice.reason,
        goalId: choice.goalId,
      }));

    const economy = await this.economyRecommendations(
      game,
      playerId,
      cities,
      friendlyUnits.length,
      hostileUnits
    );
    const workerPlan = planWorkerImprovements({
      turn: game.currentTurn,
      playerId,
      workers: friendlyUnits.filter(
        unit => game.unitManager.getUnitType(unit.unitTypeId)?.canBuildImprovements
      ),
      cities,
      hostileUnits,
      existingTasks: {},
      getTile: (x, y) => game.mapManager.getTile(x, y),
      getNeighbors: (x, y) => game.mapManager.getNeighbors(x, y),
      getCardinalNeighbors: (x, y) =>
        game.mapManager
          .getTopology()
          .getCardinalNeighbors(x, y)
          .flatMap(position => {
            const tile = game.mapManager.getTile(position.x, position.y);
            return tile ? [tile] : [];
          }),
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      researchedTechs: knownTechs,
    });
    const exploration = await this.explorationRecommendations(
      game,
      playerId,
      friendlyUnits,
      visibleUnits,
      hostileUnits,
      relations.allied,
      relations.hostile
    );
    const military = friendlyUnits
      .filter(unit => {
        const type = game.unitManager.getUnitType(unit.unitTypeId);
        return type && (type.attack ?? type.combat ?? 0) > 0;
      })
      .flatMap(unit => {
        const type = game.unitManager.getUnitType(unit.unitTypeId)!;
        return rankMilitaryTargets(
          unit,
          type,
          hostileUnits,
          unitTypeId => game.unitManager.getUnitType(unitTypeId),
          target => game.mapManager.getDistance(unit.x, unit.y, target.x, target.y)
        )
          .slice(0, 3)
          .map(target => ({
            unitId: unit.id,
            targetUnitId: target.unit.id,
            want: target.want,
            distance: target.distance,
          }));
      });

    return {
      playerId,
      turn: game.currentTurn,
      economy,
      research: researchChoices,
      cities: cityRecommendations,
      workers: workerPlan.assignments.map(assignment => ({
        unitId: assignment.unit.id,
        x: assignment.tile.x,
        y: assignment.tile.y,
        action: assignment.action,
        want: assignment.want,
      })),
      exploration,
      military,
    };
  }

  private async economyRecommendations(
    game: GameInstance,
    playerId: string,
    cities: ReturnType<GameInstance['cityManager']['getPlayerCities']>,
    unitCount: number,
    hostileUnits: Unit[]
  ): Promise<AdvisorRecommendations['economy']> {
    const economicManager = game.turnManager.getEconomicManager?.();
    const status = economicManager
      ? await economicManager.getPlayerEconomicStatus(playerId)
      : {
          currentGold: game.players.get(playerId)?.gold ?? 0,
          taxRates: { tax: 40, luxury: 0, science: 60 },
        };
    const governmentId = game.governmentManager?.getPlayerGovernment(playerId)?.currentGovernment;
    const maxRate = governmentId
      ? game.governmentManager?.calculateGovernmentEffect(governmentId, EffectType.MAX_RATES) || 100
      : 100;
    const plan = planTreasury({
      currentGold: status.currentGold,
      netGold: cities.reduce((sum, city) => sum + (city.goldPerTurn ?? 0), 0),
      cities,
      unitCount,
      atWar: hostileUnits.length > 0,
      unitTypes: UNIT_TYPES,
      buildingTypes: BUILDING_TYPES,
      buyCost: cityId => game.cityManager.calculateBuyCost(cityId),
      threat: city =>
        hostileUnits.reduce(
          (sum, unit) =>
            sum +
            (game.unitManager.getUnitType(unit.unitTypeId)?.attack ?? 0) /
              Math.max(1, game.mapManager.getDistance(city.x, city.y, unit.x, unit.y)),
          0
        ),
      maxRate,
    });
    return {
      reserve: plan.reserve,
      rates: plan.rates,
      rushCityIds: plan.rushCityIds,
      saleCandidates: plan.sales,
    };
  }

  private async explorationRecommendations(
    game: GameInstance,
    playerId: string,
    friendlyUnits: Unit[],
    visibleUnits: Unit[],
    hostileUnits: Unit[],
    alliedPlayers: ReadonlySet<string>,
    hostilePlayers: ReadonlySet<string>
  ): Promise<AdvisorRecommendations['exploration']> {
    const map = game.mapManager.getMapData();
    if (!map) return [];
    const explorers = friendlyUnits.filter(unit => {
      const type = game.unitManager.getUnitType(unit.unitTypeId);
      return type?.roles?.includes('Explorer') || unit.automation === 'explore';
    });
    const nonAlliedUnits = visibleUnits.filter(
      unit => unit.playerId !== playerId && !alliedPlayers.has(unit.playerId)
    );
    const routeContext = {
      map,
      exploredTiles: game.visibilityManager.getExploredTiles(playerId),
      hostileUnits,
      nonAlliedUnits,
      nonAlliedCityTiles: new Set(
        game.cityManager
          .getAllCities()
          .filter(
            city =>
              city.playerId !== playerId &&
              !alliedPlayers.has(city.playerId) &&
              game.visibilityManager.isTileExplored(playerId, city.x, city.y)
          )
          .map(city => `${city.x},${city.y}`)
      ),
      getType: (unitTypeId: string) => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX: number, fromY: number, toX: number, toY: number) =>
        game.mapManager.getDistance(fromX, fromY, toX, toY),
      mayExploreTile: (unit: Unit, tile: (typeof map.tiles)[number][number]) => {
        if (!tile.owner || tile.owner === playerId || alliedPlayers.has(tile.owner)) return true;
        const type = game.unitManager.getUnitType(unit.unitTypeId);
        if (type?.unitClass === 'civilian' || type?.flags?.includes('NonMil')) return true;
        return hostilePlayers.has(tile.owner);
      },
    };
    const plan = await planExploration({
      turn: game.currentTurn,
      playerId,
      units: explorers,
      ...routeContext,
      existingTasks: {},
      getNeighbors: (x, y) => game.mapManager.getNeighbors(x, y),
      squaredDistance: (fromX, fromY, toX, toY) =>
        game.mapManager.getTopology().squaredDistance(fromX, fromY, toX, toY),
      findPath: (unit, targetX, targetY) =>
        game.pathfindingManager.findPath(unit, targetX, targetY, {
          additionalStepCost: (actor, _fromX, _fromY, toX, toY) =>
            explorationAdditionalStepCost(routeContext, actor, toX, toY),
        }),
      knowsHuts: true,
    });
    return plan.assignments.map(assignment => ({
      unitId: assignment.unit.id,
      x: assignment.tile.x,
      y: assignment.tile.y,
      want: assignment.want,
    }));
  }
}
