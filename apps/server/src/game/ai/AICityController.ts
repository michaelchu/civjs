/**
 * @module server/game/ai/AICityController
 * Implements AICity Controller decision logic for AI-controlled players.
 */
import { ActionType } from '@app-types/shared/actions';
import { OutputType } from '@game/constants/GameConstants';
import { getRulesetMoveFragments } from '@game/constants/MovementConstants';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import { rankCityProduction, type AIChoice, type ProductionChoice } from '@game/ai/AIPlanner';
import { createAIProfile, type AIProfile } from '@game/ai/AIProfile';
import type { FreecivAIState } from '@game/ai/AIStateStore';
import {
  hostileUnitsForPlanning,
  potentiallyHostilePlayerIds,
  sortedPlayerUnits,
  targetableForeignCities,
} from '@game/ai/AITargeting';
import { BUILDING_TYPES } from '@game/managers/CityManager';
import type { CityState } from '@game/cities/CityTypes';
import type { GameInstance } from '@game/runtime/GameTypes';
import type { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';
import { CitizenParameterFactory } from '@game/systems/CitizenManagement/CitizenParameter';
import { buildAuthoritativeCityDangerAssessments } from '@game/ai/AICityDangerPlanner';
import { rankVirtualMilitaryProduction } from '@game/ai/AIMilitaryProductionPlanner';
import { rankHunterProduction } from '@game/ai/AIHunterPlanner';
import { rankVirtualAirProduction } from '@game/ai/AIAirPlanner';
import { rankVirtualParadropProduction } from '@game/ai/AIParadropPlanner';
import {
  rankDiplomatTechnologyWants,
  rankVirtualDiplomatProduction,
} from '@game/ai/AIDiplomatPlanner';
import {
  calculateDiplomatInciteCost,
  type RuntimeCultureCache,
} from '@game/services/DiplomatActionEconomics';
import { calculateTreasuryReserve } from '@game/ai/AITreasuryPlanner';
import type { Unit } from '@game/units/UnitTypes';
import { planWonderCoordination, type WonderHelperAssignment } from '@game/ai/AIWonderPlanner';
import { planSpaceship } from '@game/ai/AISpaceshipPlanner';
import type { DiplomaticState } from '@game/managers/DiplomacyManager';
import type { MapTile } from '@game/map/MapTypes';
import { planCaravanTrade, type CaravanAssignment } from '@game/ai/AITradePlanner';
import { DEFAULT_RULESET } from '@shared/data/rulesets/defaultRuleset';

const unitTypesFor = (game: GameInstance) => game.unitManager.getUnitTypes?.() ?? UNIT_TYPES;
const buildingTypesFor = (game: GameInstance) =>
  game.cityManager.getBuildingTypes?.() ?? BUILDING_TYPES;
const moveFragmentsFor = (game: GameInstance) =>
  game.unitManager.getMoveFragments?.() ??
  getRulesetMoveFragments(game.config?.ruleset ?? DEFAULT_RULESET);

function mergeWant(wants: Map<string, number>, id: string, want: number): void {
  wants.set(id, Math.max(want, wants.get(id) ?? 0));
}

function createVirtualDiplomat(
  gameId: string,
  playerId: string,
  city: CityState,
  unitTypeId: string,
  movement: number
): Unit {
  return {
    id: `virtual-diplomat:${city.id}:${unitTypeId}`,
    gameId,
    playerId,
    unitTypeId,
    x: city.x,
    y: city.y,
    movementLeft: movement,
    health: 100,
    veteranLevel: 0,
    experience: 0,
    fortified: false,
  };
}

function citizenParameters(city: CityState, profile: AIProfile) {
  const parameters = CitizenParameterFactory.createDefault();
  const unrest = city.happiness.unhappy + city.happiness.angry;
  parameters.minimal_surplus[OutputType.FOOD] = (city.foodStock ?? 0) <= 0 ? 2 : 1;
  parameters.minimal_surplus[OutputType.SHIELD] = 1;
  parameters.factor[OutputType.FOOD] = (city.foodPerTurn ?? 0) <= 0 ? 24 : 8;
  parameters.factor[OutputType.SHIELD] = 6 + profile.traits.builder / 20;
  parameters.factor[OutputType.TRADE] = 3;
  parameters.factor[OutputType.GOLD] = (city.goldPerTurn ?? 0) < 0 ? 10 : 3;
  parameters.factor[OutputType.LUXURY] = unrest > 0 ? 20 : 2;
  parameters.factor[OutputType.SCIENCE] = 4 + profile.traits.builder / 25;
  parameters.happy_factor = unrest > 0 ? 20 : 2;
  parameters.max_growth = city.size < 8 && (city.foodPerTurn ?? 0) >= 0;
  parameters.require_happy = unrest > 0;
  parameters.allow_disorder = false;
  parameters.allow_specialists = true;
  return parameters;
}

/**
 * Executes citizen allocation, production, worklist, and city-local unit
 * decisions through authoritative managers.
 */
export class FreecivAICityController {
  constructor(private readonly hostilityPolicy: DiplomacyHostilityPolicy) {}

  async manageCitizens(game: GameInstance, playerId: string): Promise<number> {
    if (typeof game.cityManager.optimizeCityManually !== 'function') return 0;
    const player = game.players.get(playerId);
    const profile = createAIProfile(player?.aiLevel, player?.aiTraits);
    let actions = 0;
    for (const city of game.cityManager
      .getPlayerCities(playerId)
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))) {
      const parameters = citizenParameters(city, profile);
      const optimized = await game.cityManager.optimizeCityManually(city.id, parameters);
      if (optimized) actions++;
    }
    return actions;
  }

  async selectProduction(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    let actions = 0;
    const context = await this.prepareProduction(game, playerId, state);
    const {
      cities,
      units,
      canContinueProduction,
      relations,
      relationByPlayer,
      profile,
      hostileUnits,
      prospectiveUnits,
      prospectiveCities,
      allKnownCities,
      allUnits,
      mapTiles,
      exploredTiles,
      knownTechs,
      spaceshipPlan,
      gold,
      goldReserve,
      diplomatTargetCities,
      inciteCosts,
      stealableTechs,
      dangerByCity,
      reservedWonders,
      wonderPlan,
    } = context;
    let { expansionQueued } = context;

    for (const city of cities) {
      for (const type of Object.values(unitTypesFor(game))) {
        if (
          type.paratroopersRange > 0 &&
          type.flags?.includes('Paratroopers') &&
          type.requiredTech &&
          !knownTechs.has(type.requiredTech)
        ) {
          state.techWants[type.requiredTech] = (state.techWants[type.requiredTech] ?? 0) + 2;
        }
      }
      const offensiveUnitWants = await this.rankOffensiveProduction({
        game,
        playerId,
        state,
        city,
        units,
        hostileUnits,
        prospectiveUnits,
        prospectiveCities,
        allUnits,
        allKnownCities,
        mapTiles,
        exploredTiles,
        alliedPlayerIds: relations.allied,
        diplomatTargetCities,
        canContinueProduction,
        relationByPlayer,
        stealableTechs,
        inciteCosts,
        knownTechs,
        gold,
        goldReserve,
        profile,
      });
      for (const [unitTypeId, want] of wonderPlan.productionWants.get(city.id) ?? []) {
        mergeWant(offensiveUnitWants, unitTypeId, want);
      }
      const dangerAssessment = dangerByCity.get(city.id)!;
      const ranked = canContinueProduction
        ? rankCityProduction({
            city,
            cities,
            units,
            unitTypes: unitTypesFor(game),
            buildingTypes: buildingTypesFor(game),
            canBuild: (kind, id) => canContinueProduction(city.id, kind, id),
            dangerAssessment,
            profile,
            offensiveUnitWants,
            buildingWants: spaceshipPlan.buildingWants.get(city.id),
            reservedWonders,
            excludedChoices: new Set(
              [
                city.currentProduction && city.productionType
                  ? `${city.productionType}:${city.currentProduction}`
                  : undefined,
                ...(city.worklist ?? []).map(item => {
                  const kind = item.kind === 'wonder' ? 'building' : item.kind;
                  return `${kind}:${item.value}`;
                }),
              ].filter((value): value is string => Boolean(value))
            ),
          })
        : [];
      state.cityWants[city.id] = Object.fromEntries(
        ranked.slice(0, 12).map(choice => [`${choice.value.kind}:${choice.value.id}`, choice.want])
      );
      const applied = await this.applyRankedCityProduction({
        game,
        playerId,
        city,
        ranked,
        profile,
        reservedWonders,
        expansionQueued,
      });
      actions += applied.actions;
      expansionQueued = applied.expansionQueued;
    }
    return actions;
  }

  private async productionDiplomacySnapshot(
    game: GameInstance,
    playerId: string,
    relations: Awaited<ReturnType<DiplomacyHostilityPolicy['getRelationPlayerIds']>>
  ) {
    const snapshot = await this.hostilityPolicy.getDiplomacySnapshot?.(game.id, playerId);
    if (snapshot) return snapshot;
    return {
      playerId,
      nations: [...game.players.values()]
        .filter(candidate => candidate.id !== playerId)
        .map(candidate => ({
          id: candidate.id,
          isAlive: candidate.isAlive !== false,
          relation: {
            state: relations.hostile.has(candidate.id)
              ? ('war' as const)
              : relations.allied.has(candidate.id)
                ? ('alliance' as const)
                : ('no_contact' as const),
            embassy: false,
          },
        })),
    };
  }

  private productionSpaceshipPlan(game: GameInstance, playerId: string) {
    const citiesByPlayer = new Map(
      [...game.players.keys()].map(candidateId => [
        candidateId,
        game.cityManager.getPlayerCities(candidateId),
      ])
    );
    return planSpaceship({
      enabled: (game.config?.victoryConditions ?? []).some(condition =>
        ['science', 'spaceship'].includes(condition)
      ),
      playerId,
      citiesByPlayer,
      technologyCount: candidateId =>
        game.researchManager.getPlayerResearch(candidateId)?.researchedTechs.size ?? 0,
      spaceshipState: candidateId => game.players.get(candidateId)?.spaceshipState,
    });
  }

  private mergeTechnologyWants(state: FreecivAIState, wants: ReadonlyMap<string, number>): void {
    for (const [techId, want] of wants) {
      state.techWants[techId] = (state.techWants[techId] ?? 0) + want;
    }
  }

  private async diplomatInciteCosts(
    game: GameInstance,
    cities: CityState[]
  ): Promise<Map<string, number>> {
    const costs = new Map<string, number>();
    const cultureCache: RuntimeCultureCache = new Map();
    await Promise.all(
      cities.map(async city => {
        costs.set(city.id, await calculateDiplomatInciteCost(game, city, cultureCache));
      })
    );
    return costs;
  }

  private reservedWonderIds(game: GameInstance, cities: CityState[]): Set<string> {
    return new Set(
      cities
        .flatMap(city => [city.currentProduction, ...(city.worklist ?? []).map(item => item.value)])
        .filter((buildingId): buildingId is string =>
          Boolean(buildingId && buildingTypesFor(game)[buildingId]?.genus === 'GreatWonder')
        )
    );
  }

  private productionWorldKnowledge(
    game: GameInstance,
    playerId: string,
    fallbackCities: CityState[]
  ) {
    return {
      allKnownCities: game.cityManager.getAllCities?.() ?? fallbackCities,
      allUnits: [...game.unitManager.getAllUnits().values()],
      mapTiles: game.mapManager.getMapData?.()?.tiles.flat() ?? [],
      exploredTiles: game.visibilityManager.getExploredTiles?.(playerId) ?? new Set<string>(),
      knownTechs: new Set(game.researchManager.getPlayerResearch(playerId)?.researchedTechs ?? []),
    };
  }

  private async productionDiplomatData(
    game: GameInstance,
    playerId: string,
    profile: AIProfile,
    allKnownCities: CityState[],
    knownTechs: ReadonlySet<string>,
    diplomacySnapshot: {
      nations: Array<{
        id: string;
        relation: { state: DiplomaticState; embassy: boolean };
      }>;
    }
  ) {
    const foreignPlayerIds = new Set(
      allKnownCities.filter(city => city.playerId !== playerId).map(city => city.playerId)
    );
    const diplomatTargetCities = targetableForeignCities(game, playerId, foreignPlayerIds, profile);
    const inciteCosts = await this.diplomatInciteCosts(game, diplomatTargetCities);
    const stealableTechs = new Map(
      diplomacySnapshot.nations.map(nation => [
        nation.id,
        [...(game.researchManager.getPlayerResearch(nation.id)?.researchedTechs ?? [])].filter(
          tech => !knownTechs.has(tech)
        ).length,
      ])
    );
    return { diplomatTargetCities, inciteCosts, stealableTechs };
  }

  private async productionEconomy(
    game: GameInstance,
    playerId: string,
    cities: CityState[],
    unitCount: number,
    atWar: boolean
  ) {
    const economicManager = game.turnManager?.getEconomicManager?.();
    const gold =
      (await economicManager?.getPlayerGold(playerId)) ?? game.players.get(playerId)?.gold ?? 0;
    const goldReserve = calculateTreasuryReserve({
      cities,
      unitCount,
      atWar,
      netGold: game.players.get(playerId)?.goldPerTurn ?? 0,
    });
    return { gold, goldReserve };
  }

  private async prepareProduction(game: GameInstance, playerId: string, state: FreecivAIState) {
    const cities = game.cityManager
      .getPlayerCities(playerId)
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
    const units = game.unitManager.getPlayerUnits(playerId);
    const canContinueProduction =
      typeof game.cityManager.canCityContinueProduction === 'function'
        ? (cityId: string, kind: 'unit' | 'building', id: string) =>
            game.cityManager.canCityContinueProduction(cityId, kind, id)
        : undefined;
    const expansionQueued = units.some(
      unit => game.unitManager.getUnitType(unit.unitTypeId)?.canFoundCity
    );
    const relations = await this.hostilityPolicy.getRelationPlayerIds(game.id, playerId);
    const diplomacySnapshot = await this.productionDiplomacySnapshot(game, playerId, relations);
    const relationByPlayer = new Map(
      diplomacySnapshot.nations.map(nation => [nation.id, nation.relation])
    );
    const hostilePlayerIds = relations.hostile;
    const player = game.players.get(playerId);
    const profile = createAIProfile(player?.aiLevel, player?.aiTraits);
    const hostileUnits = hostileUnitsForPlanning(game, playerId, hostilePlayerIds, profile);
    const potentiallyHostileIds = potentiallyHostilePlayerIds(
      game.players.keys(),
      playerId,
      hostilePlayerIds,
      relations.allied,
      relations.unknown,
      state
    );
    const prospectiveUnits = hostileUnitsForPlanning(
      game,
      playerId,
      potentiallyHostileIds,
      profile
    );
    const prospectiveCities = targetableForeignCities(
      game,
      playerId,
      potentiallyHostileIds,
      profile
    );
    const world = this.productionWorldKnowledge(game, playerId, cities);
    const spaceshipPlan = this.productionSpaceshipPlan(game, playerId);
    this.mergeTechnologyWants(state, spaceshipPlan.technologyWants);
    const economy = await this.productionEconomy(
      game,
      playerId,
      cities,
      units.length,
      relations.hostile.size > 0
    );
    const diplomat = await this.productionDiplomatData(
      game,
      playerId,
      profile,
      world.allKnownCities,
      world.knownTechs,
      diplomacySnapshot
    );
    const dangerByCity = await buildAuthoritativeCityDangerAssessments({
      game,
      cities,
      threateningUnits: hostileUnits,
      friendlyUnits: units,
      profile,
    });
    const reservedWonders = this.reservedWonderIds(game, cities);
    const wonderPlan = planWonderCoordination({
      cities,
      units,
      unitTypes: unitTypesFor(game),
      buildingTypes: buildingTypesFor(game),
      canBuild: (cityId, unitTypeId) =>
        canContinueProduction?.(cityId, 'unit', unitTypeId) ?? false,
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
    });
    this.mergeTechnologyWants(state, wonderPlan.technologyWants);
    return {
      cities,
      units,
      canContinueProduction,
      expansionQueued,
      relations,
      relationByPlayer,
      profile,
      hostileUnits,
      prospectiveUnits,
      prospectiveCities,
      ...world,
      spaceshipPlan,
      ...economy,
      ...diplomat,
      dangerByCity,
      reservedWonders,
      wonderPlan,
    };
  }

  private async rankOffensiveProduction(options: {
    game: GameInstance;
    playerId: string;
    state: FreecivAIState;
    city: CityState;
    units: Unit[];
    hostileUnits: Unit[];
    prospectiveUnits: Unit[];
    prospectiveCities: CityState[];
    allUnits: Unit[];
    allKnownCities: CityState[];
    mapTiles: MapTile[];
    exploredTiles: Set<string>;
    alliedPlayerIds: Set<string>;
    diplomatTargetCities: CityState[];
    canContinueProduction?: (cityId: string, kind: 'unit' | 'building', id: string) => boolean;
    relationByPlayer: Map<string, { state: DiplomaticState; embassy: boolean }>;
    stealableTechs: Map<string, number>;
    inciteCosts: Map<string, number>;
    knownTechs: Set<string>;
    gold: number;
    goldReserve: number;
    profile: AIProfile;
  }): Promise<Map<string, number>> {
    const {
      game,
      playerId,
      state,
      city,
      units,
      hostileUnits,
      prospectiveUnits,
      prospectiveCities,
      allUnits,
      allKnownCities,
      mapTiles,
      exploredTiles,
      alliedPlayerIds,
      diplomatTargetCities,
      canContinueProduction,
      relationByPlayer,
      stealableTechs,
      inciteCosts,
      knownTechs,
      gold,
      goldReserve,
      profile,
    } = options;
    const offensiveUnitWants = await rankVirtualMilitaryProduction({
      gameId: game.id,
      playerId,
      city,
      unitTypes: Object.values(unitTypesFor(game)),
      targetUnits: prospectiveUnits,
      targetCities: prospectiveCities,
      canBuild: (cityId, unitTypeId) =>
        canContinueProduction?.(cityId, 'unit', unitTypeId) ?? false,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      getNeighbors: (x, y) => game.mapManager.getNeighbors(x, y),
      findPath: (unit, targetX, targetY) =>
        game.pathfindingManager.findPath(unit, targetX, targetY),
      ...(typeof game.pathfindingManager.findPaths === 'function'
        ? {
            findPaths: (unit: Unit, destinations: ReadonlyArray<{ x: number; y: number }>) =>
              game.pathfindingManager.findPaths(unit, destinations),
          }
        : {}),
      ...(typeof game.pathfindingManager.findPathCosts === 'function'
        ? {
            findPathCosts: (unit: Unit, destinations: ReadonlyArray<{ x: number; y: number }>) =>
              game.pathfindingManager.findPathCosts(unit, destinations),
          }
        : {}),
      isStackProtected: (x, y) => {
        const tile = game.mapManager.getTile(x, y);
        return Boolean(
          game.cityManager.getCityAt(x, y) ||
          tile?.improvements?.some((extra: string) => ['fortress', 'airbase'].includes(extra))
        );
      },
      rateAttack: unit => game.unitManager.calculateUnitAttackRating(unit),
      rateDefense: (defender, attacker) =>
        game.unitManager.calculateUnitDefenseRating(defender, attacker),
      causesMilitaryUnhappiness: () =>
        typeof game.cityManager.getCityMilitaryUnhappiness === 'function' &&
        game.cityManager.getCityMilitaryUnhappiness(city.id) > 0,
    });
    const hunterWants = rankHunterProduction({
      gameId: game.id,
      playerId,
      city,
      friendlyUnits: units,
      hostileUnits: prospectiveUnits,
      unitTypes: Object.values(unitTypesFor(game)),
      canBuild: unitTypeId => canContinueProduction?.(city.id, 'unit', unitTypeId) ?? false,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      targetSelectionHandicap: profile.handicaps.has('targets'),
    });
    for (const [unitTypeId, want] of hunterWants) {
      mergeWant(offensiveUnitWants, unitTypeId, want);
    }
    const airWants = rankVirtualAirProduction({
      gameId: game.id,
      playerId,
      city,
      unitTypes: Object.values(unitTypesFor(game)),
      hostileUnits: prospectiveUnits,
      hostileCities: prospectiveCities,
      canBuild: unitTypeId => canContinueProduction?.(city.id, 'unit', unitTypeId) ?? false,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      attackerRating: unit => game.unitManager.calculateUnitAttackRating(unit),
      defenderRating: (attacker, defender) =>
        game.unitManager.calculateUnitDefenseRating(defender, attacker),
      canAttack: (attacker, defender) => game.unitManager.canUnitTargetUnit(attacker, defender),
      hasOccupierSupport: targetCity =>
        units.some(unit => {
          const type = game.unitManager.getUnitType(unit.unitTypeId);
          return (
            type?.rulesetUnitClassFlags.includes('CanOccupyCity') === true &&
            type.flags?.includes('NonMil') !== true &&
            game.mapManager.getDistance(unit.x, unit.y, targetCity.x, targetCity.y) <=
              Math.max(1, type.movement) * 3
          );
        }),
      planesHandicap: profile.handicaps.has('no_planes'),
      moveFragments: moveFragmentsFor(game),
    });
    for (const [unitTypeId, want] of airWants) {
      mergeWant(offensiveUnitWants, unitTypeId, want);
    }
    const paradropWants = rankVirtualParadropProduction({
      gameId: game.id,
      playerId,
      city,
      unitTypes: Object.values(unitTypesFor(game)),
      units: allUnits,
      cities: allKnownCities,
      alliedPlayerIds,
      tiles: mapTiles,
      canBuild: unitTypeId => canContinueProduction?.(city.id, 'unit', unitTypeId) ?? false,
      isKnown: tile => !profile.handicaps.has('map') || exploredTiles.has(`${tile.x},${tile.y}`),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
    });
    for (const [unitTypeId, want] of paradropWants) {
      mergeWant(offensiveUnitWants, unitTypeId, want);
    }
    await this.addDiplomatProductionWants({
      game,
      playerId,
      state,
      city,
      units,
      hostileUnits,
      diplomatTargetCities,
      canContinueProduction,
      relationByPlayer,
      stealableTechs,
      inciteCosts,
      knownTechs,
      gold,
      goldReserve,
      profile,
      offensiveUnitWants,
    });
    return offensiveUnitWants;
  }

  private async addDiplomatProductionWants(options: {
    game: GameInstance;
    playerId: string;
    state: FreecivAIState;
    city: CityState;
    units: Unit[];
    hostileUnits: Unit[];
    diplomatTargetCities: CityState[];
    canContinueProduction?: (cityId: string, kind: 'unit' | 'building', id: string) => boolean;
    relationByPlayer: Map<string, { state: DiplomaticState; embassy: boolean }>;
    stealableTechs: Map<string, number>;
    inciteCosts: Map<string, number>;
    knownTechs: Set<string>;
    gold: number;
    goldReserve: number;
    profile: AIProfile;
    offensiveUnitWants: Map<string, number>;
  }): Promise<void> {
    const {
      game,
      playerId,
      state,
      city,
      units,
      hostileUnits,
      diplomatTargetCities,
      canContinueProduction,
      relationByPlayer,
      stealableTechs,
      inciteCosts,
      knownTechs,
      gold,
      goldReserve,
      profile,
      offensiveUnitWants,
    } = options;
    const diplomatTypes = Object.values(unitTypesFor(game)).filter(
      type =>
        type.flags?.includes('Diplomat') &&
        (canContinueProduction?.(city.id, 'unit', type.id) ?? false)
    );
    const diplomatTravelTurns = new Map<string, number>();
    await Promise.all(
      diplomatTypes.map(async type => {
        const virtual = createVirtualDiplomat(game.id, playerId, city, type.id, type.movement);
        const destinationsByTarget = new Map<string, Array<{ x: number; y: number }>>();
        const uniqueDestinations = new Map<string, { x: number; y: number }>();
        for (const target of diplomatTargetCities) {
          const destinations = game.mapManager.getNeighbors(target.x, target.y);
          destinationsByTarget.set(target.id, destinations);
          for (const destination of destinations) {
            uniqueDestinations.set(`${destination.x},${destination.y}`, destination);
          }
        }
        const routeMap =
          typeof game.pathfindingManager.findPathCosts === 'function'
            ? await game.pathfindingManager.findPathCosts(virtual, [...uniqueDestinations.values()])
            : typeof game.pathfindingManager.findPaths === 'function'
              ? await game.pathfindingManager.findPaths(virtual, [...uniqueDestinations.values()])
              : new Map(
                  await Promise.all(
                    [...uniqueDestinations].map(
                      async ([key, destination]) =>
                        [
                          key,
                          await game.pathfindingManager.findPath(
                            virtual,
                            destination.x,
                            destination.y
                          ),
                        ] as const
                    )
                  )
                );
        for (const target of diplomatTargetCities) {
          const cost = (destinationsByTarget.get(target.id) ?? [])
            .map(destination => routeMap.get(`${destination.x},${destination.y}`))
            .filter(path => path?.valid)
            .reduce((best, path) => Math.min(best, path!.totalCost), Infinity);
          diplomatTravelTurns.set(
            `${type.id}:${target.id}`,
            Number.isFinite(cost)
              ? Math.max(1, Math.ceil(cost / Math.max(1, type.movement)))
              : Infinity
          );
        }
      })
    );
    const diplomatThreat = hostileUnits.some(enemy => {
      const type = game.unitManager.getUnitType(enemy.unitTypeId);
      return (
        type?.flags?.includes('Diplomat') === true &&
        game.mapManager.getDistance(enemy.x, enemy.y, city.x, city.y) <=
          Math.max(1, type.movement) * 3
      );
    });
    const conventionalDefenderCount = units.filter(unit => {
      const type = game.unitManager.getUnitType(unit.unitTypeId);
      return (
        unit.x === city.x &&
        unit.y === city.y &&
        type?.flags?.includes('Diplomat') !== true &&
        type?.flags?.includes('NonMil') !== true
      );
    }).length;
    const diplomatWants = rankVirtualDiplomatProduction({
      playerId,
      city,
      unitTypes: Object.values(unitTypesFor(game)),
      friendlyUnits: units,
      foreignCities: diplomatTargetCities,
      canBuild: unitTypeId => canContinueProduction?.(city.id, 'unit', unitTypeId) ?? false,
      travelTurns: (type, target) => diplomatTravelTurns.get(`${type.id}:${target.id}`) ?? Infinity,
      relation: otherPlayerId => {
        const relation = relationByPlayer.get(otherPlayerId);
        return {
          allied: relation?.state === 'alliance' || relation?.state === 'team',
          atWar: relation?.state === 'war',
          hasEmbassy: relation?.embassy ?? false,
        };
      },
      countStealableTechs: otherPlayerId => stealableTechs.get(otherPlayerId) ?? 0,
      inciteCost: target => inciteCosts.get(target.id) ?? Infinity,
      canInciteCity: target =>
        !target.buildings.includes('palace') &&
        game.governmentManager?.getPlayerGovernment(target.playerId)?.currentGovernment !==
          'democracy',
      actionOdds: (type, action) =>
        game.unitManager.calculateDiplomatActionOdds(
          createVirtualDiplomat(game.id, playerId, city, type.id, type.movement),
          action
        ),
      cityDiplomatThreat: diplomatThreat,
      cityUrgency: hostileUnits.filter(
        enemy => game.mapManager.getDistance(enemy.x, enemy.y, city.x, city.y) <= 3
      ).length,
      conventionalDefenderCount,
      gold,
      goldReserve,
      diplomatHandicap: profile.handicaps.has('diplomat'),
    });
    for (const [unitTypeId, want] of diplomatWants) {
      mergeWant(offensiveUnitWants, unitTypeId, want);
    }
    const diplomatTechWants = rankDiplomatTechnologyWants({
      unitTypes: Object.values(unitTypesFor(game)),
      knownTechs,
      cityDiplomatThreat: diplomatThreat,
      conventionalDefenderCount,
      canBuild: unitTypeId => canContinueProduction?.(city.id, 'unit', unitTypeId) ?? false,
    });
    for (const [techId, want] of diplomatTechWants) {
      state.techWants[techId] = (state.techWants[techId] ?? 0) + want;
    }
  }

  private async seedProductionWorklist(options: {
    game: GameInstance;
    playerId: string;
    city: CityState;
    ranked: AIChoice<ProductionChoice>[];
    reservedWonders: Set<string>;
  }): Promise<number> {
    const { game, playerId, city, ranked, reservedWonders } = options;
    const queued = ranked.slice(0, 2).map(choice => ({
      kind:
        buildingTypesFor(game)[choice.value.id]?.genus === 'GreatWonder'
          ? ('wonder' as const)
          : choice.value.kind,
      value: choice.value.id,
    }));
    if (queued.length === 0 || typeof game.cityManager.addToWorklist !== 'function') return 0;
    const added = await game.cityManager.addToWorklist(city.id, queued, playerId);
    if (added) {
      for (const item of queued) {
        if (buildingTypesFor(game)[item.value]?.genus === 'GreatWonder') {
          reservedWonders.add(item.value);
        }
      }
    }
    return Number(added);
  }

  private initialProductionChoice(
    game: GameInstance,
    city: CityState,
    ranked: AIChoice<ProductionChoice>[],
    expansionQueued: boolean
  ): { type: 'unit' | 'building'; id: string; expansionQueued: boolean } {
    const scored = ranked[0];
    let type: 'unit' | 'building' = scored?.value.kind ?? 'unit';
    let id = scored?.value.id ?? 'warriors';
    if (!scored && (city.goldPerTurn ?? 0) < 0 && !city.buildings.includes('marketplace')) {
      type = 'building';
      id = 'marketplace';
    } else if (!scored && !expansionQueued) {
      id = 'settlers';
    }
    return {
      type,
      id,
      expansionQueued: expansionQueued || Boolean(game.unitManager.getUnitType(id)?.canFoundCity),
    };
  }

  private async applyRankedCityProduction(options: {
    game: GameInstance;
    playerId: string;
    city: CityState;
    ranked: AIChoice<ProductionChoice>[];
    profile: AIProfile;
    reservedWonders: Set<string>;
    expansionQueued: boolean;
  }): Promise<{ actions: number; expansionQueued: boolean }> {
    const { game, playerId, city, ranked, profile, reservedWonders } = options;
    const { expansionQueued } = options;
    if (profile.handicaps.has('away') && city.currentProduction) {
      return { actions: 0, expansionQueued };
    }
    // Wealth is an indefinite conversion, so it never completes and cannot
    // advance the normal worklist. Treat it as idle for AI purposes; otherwise
    // a city that starts on Wealth remains there forever and never produces the
    // workers, settlers, or military units ranked above.
    if (city.currentProduction === 'capitalization') {
      const choice = this.initialProductionChoice(game, city, ranked, expansionQueued);
      await game.cityManager.setCityProduction(city.id, choice.type, choice.id, playerId);
      if (buildingTypesFor(game)[choice.id]?.genus === 'GreatWonder') {
        reservedWonders.add(choice.id);
      }
      return { actions: 1, expansionQueued: choice.expansionQueued };
    }
    if (
      city.currentProduction &&
      (city.worklist?.length ?? 0) === 0 &&
      typeof game.cityManager.addToWorklist === 'function'
    ) {
      const actions = await this.seedProductionWorklist({
        game,
        playerId,
        city,
        ranked,
        reservedWonders,
      });
      return { actions, expansionQueued };
    }
    if (city.currentProduction) return { actions: 0, expansionQueued };
    const choice = this.initialProductionChoice(game, city, ranked, expansionQueued);
    await game.cityManager.setCityProduction(city.id, choice.type, choice.id, playerId);
    if (buildingTypesFor(game)[choice.id]?.genus === 'GreatWonder') reservedWonders.add(choice.id);
    return { actions: 1, expansionQueued: choice.expansionQueued };
  }

  async executeUnitActions(
    game: GameInstance,
    playerId: string,
    state?: FreecivAIState
  ): Promise<number> {
    const preferences = [
      ActionType.MARKETPLACE,
      ActionType.JOIN_CITY,
      ActionType.CHANGE_HOME_CITY,
      ActionType.UPGRADE_UNIT,
    ];
    let actions = 0;
    for (const unit of sortedPlayerUnits(game, playerId)) {
      const task = state?.unitTasks[unit.id];
      if (
        task?.role === 'caravan' &&
        (task.action === ActionType.TRADE_ROUTE || task.action === ActionType.MARKETPLACE)
      ) {
        continue;
      }
      if (!game.unitManager.getUnit(unit.id)) continue;
      if (!game.cityManager.getCityAt?.(unit.x, unit.y)) continue;
      for (const action of preferences) {
        const targetX = action === ActionType.UPGRADE_UNIT ? undefined : unit.x;
        const targetY = action === ActionType.UPGRADE_UNIT ? undefined : unit.y;
        if (!game.unitManager.canUnitPerformAction(unit.id, action, targetX, targetY)) continue;
        const result = await game.unitManager.executeUnitAction(
          unit.id,
          action,
          targetX,
          targetY,
          playerId
        );
        if (result.success) actions++;
        break;
      }
    }
    return actions;
  }

  async manageCaravanTrade(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(game.id, playerId);
    const assignments = planCaravanTrade({
      units: game.unitManager.getPlayerUnits(playerId),
      cities: game.cityManager.getAllCities(),
      getCity: cityId => game.cityManager.getCity?.(cityId),
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      canTradeWith: ownerId => !hostileIds.has(ownerId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      continent: (x, y) => game.mapManager.getTile(x, y)?.continentId,
      tradeValue: (sourceCityId, targetCityId) =>
        game.cityManager.calculateTradeRouteValue?.(sourceCityId, targetCityId) ?? 0,
    });
    const assigned = new Set(assignments.map(assignment => assignment.unit.id));
    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (
        task.role === 'caravan' &&
        (task.action === ActionType.TRADE_ROUTE || task.action === ActionType.MARKETPLACE) &&
        !assigned.has(unitId)
      ) {
        delete state.unitTasks[unitId];
      }
    }
    let actions = 0;
    for (const assignment of assignments) {
      actions += await this.executeCaravanTrade(game, playerId, state, assignment);
    }
    return actions;
  }

  private async executeCaravanTrade(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState,
    assignment: CaravanAssignment
  ): Promise<number> {
    const unit = game.unitManager.getUnit(assignment.unit.id);
    if (!unit) return 0;
    state.unitTasks[unit.id] = {
      role: 'caravan',
      targetId: assignment.targetCity.id,
      targetX: assignment.targetCity.x,
      targetY: assignment.targetCity.y,
      action: assignment.action,
      transportRequired: assignment.requiresTransport || undefined,
      assignedTurn:
        state.unitTasks[unit.id]?.role === 'caravan'
          ? state.unitTasks[unit.id]!.assignedTurn
          : game.currentTurn,
    };
    if (unit.transportedBy || unit.movementLeft <= 0) return 0;
    if (unit.x === assignment.targetCity.x && unit.y === assignment.targetCity.y) {
      const preferences =
        assignment.action === ActionType.TRADE_ROUTE
          ? [ActionType.TRADE_ROUTE, ActionType.MARKETPLACE]
          : [ActionType.MARKETPLACE, ActionType.TRADE_ROUTE];
      for (const action of preferences) {
        if (!game.unitManager.canUnitPerformAction(unit.id, action, unit.x, unit.y)) continue;
        const result = await game.unitManager.executeUnitAction(
          unit.id,
          action,
          unit.x,
          unit.y,
          playerId
        );
        if (result.success) return 1;
      }
      return 0;
    }
    if (assignment.requiresTransport) return 0;
    if (
      !game.unitManager.canUnitPerformAction(
        unit.id,
        ActionType.GOTO,
        assignment.targetCity.x,
        assignment.targetCity.y
      )
    ) {
      return 0;
    }
    const result = await game.unitManager.executeUnitAction(
      unit.id,
      ActionType.GOTO,
      assignment.targetCity.x,
      assignment.targetCity.y,
      playerId
    );
    return Number(result.success);
  }

  async manageWonderHelpers(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const cities = game.cityManager.getPlayerCities(playerId);
    const units = game.unitManager.getPlayerUnits(playerId).filter(unit => {
      const action = state.unitTasks[unit.id]?.action;
      return action !== ActionType.TRADE_ROUTE && action !== ActionType.MARKETPLACE;
    });
    const plan = planWonderCoordination({
      cities,
      units,
      unitTypes: unitTypesFor(game),
      buildingTypes: buildingTypesFor(game),
      canBuild: (cityId, unitTypeId) =>
        game.cityManager.canCityContinueProduction?.(cityId, 'unit', unitTypeId) ?? false,
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
    });
    const assignedIds = new Set(plan.assignments.map(assignment => assignment.unit.id));
    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (
        task.role === 'caravan' &&
        task.action !== ActionType.TRADE_ROUTE &&
        task.action !== ActionType.MARKETPLACE &&
        !assignedIds.has(unitId)
      ) {
        delete state.unitTasks[unitId];
      }
    }

    let actions = 0;
    for (const assignment of plan.assignments) {
      actions += await this.executeWonderHelper(
        game,
        playerId,
        state,
        assignment,
        plan.releaseHelpers
      );
    }
    return actions;
  }

  private async executeWonderHelper(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState,
    assignment: WonderHelperAssignment,
    releaseHelpers: boolean
  ): Promise<number> {
    const unit = game.unitManager.getUnit(assignment.unit.id);
    if (!unit) return 0;
    state.unitTasks[unit.id] = {
      role: 'caravan',
      targetId: assignment.targetCity.id,
      targetX: assignment.targetCity.x,
      targetY: assignment.targetCity.y,
      assignedTurn:
        state.unitTasks[unit.id]?.role === 'caravan'
          ? state.unitTasks[unit.id]!.assignedTurn
          : game.currentTurn,
    };
    if (unit.transportedBy || unit.movementLeft <= 0) return 0;
    if (unit.x === assignment.targetCity.x && unit.y === assignment.targetCity.y) {
      if (
        !releaseHelpers ||
        !game.unitManager.canUnitPerformAction(unit.id, ActionType.HELP_WONDER, unit.x, unit.y)
      ) {
        return 0;
      }
      const result = await game.unitManager.executeUnitAction(
        unit.id,
        ActionType.HELP_WONDER,
        unit.x,
        unit.y,
        playerId
      );
      return Number(result.success);
    }
    const path = await game.pathfindingManager.findPath(
      unit,
      assignment.targetCity.x,
      assignment.targetCity.y
    );
    if (!path.valid || path.path.length < 2) {
      this.markWonderHelperTransport(game, state, unit, assignment);
      return 0;
    }
    if (
      !game.unitManager.canUnitPerformAction(
        unit.id,
        ActionType.GOTO,
        assignment.targetCity.x,
        assignment.targetCity.y
      )
    ) {
      return 0;
    }
    const result = await game.unitManager.executeUnitAction(
      unit.id,
      ActionType.GOTO,
      assignment.targetCity.x,
      assignment.targetCity.y,
      playerId
    );
    return Number(result.success);
  }

  private markWonderHelperTransport(
    game: GameInstance,
    state: FreecivAIState,
    unit: Unit,
    assignment: WonderHelperAssignment
  ): void {
    const source = game.mapManager.getTile(unit.x, unit.y);
    const target = game.mapManager.getTile(assignment.targetCity.x, assignment.targetCity.y);
    const overseas =
      source &&
      target &&
      source.continentId > 0 &&
      target.continentId > 0 &&
      source.continentId !== target.continentId;
    if (overseas) state.unitTasks[unit.id]!.transportRequired = true;
    else delete state.unitTasks[unit.id];
  }
}
