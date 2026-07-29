import type { GameInstance } from '@game/managers/GameManager';
import type { DiplomacyManager, TreatyClause } from '@game/managers/DiplomacyManager';
import type { Unit } from '@game/managers/UnitManager';
import { ActionType } from '@app-types/shared/actions';
import { logger } from '@utils/logger';
import { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';
import { BUILDING_TYPES } from '@game/managers/CityManager';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import {
  chooseResearch,
  rankCityProduction,
  rankCitySites,
  rankMilitaryTargets,
} from '@game/ai/FreecivAIPlanner';
import { createAIProfile, type AIProfile } from '@game/ai/FreecivAIProfile';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { DatabaseProvider } from '@database';
import {
  FreecivAIStateStore,
  normalizeAIState,
  type FreecivAIState,
} from '@game/ai/FreecivAIStateStore';
import { planCityGuards } from '@game/ai/FreecivAIGuardPlanner';
import { planHunters } from '@game/ai/FreecivAIHunterPlanner';
import { CitizenParameterFactory } from '@game/systems/CitizenManagement/CitizenParameter';
import { OutputType } from '@game/constants/GameConstants';
import { planFerries } from '@game/ai/FreecivAIFerryPlanner';
import { planAirMissions } from '@game/ai/FreecivAIAirPlanner';
import { planDiplomatMissions } from '@game/ai/FreecivAIDiplomatPlanner';
import { chooseGovernment } from '@game/ai/FreecivAIGovernmentPlanner';
import { planTreasury } from '@game/ai/FreecivAITreasuryPlanner';

/**
 * Versioned compatibility contract for the currently landed Freeciv AI slice.
 *
 * Full default-AI parity is the required target. This contract is a migration
 * checkpoint, not a scope boundary; `remaining` entries are required work
 * tracked in docs/AI_PORTING_INVENTORY.md.
 */
export const CIVJS_AI_CONTRACT = {
  version: 2,
  supported: [
    'found a city when a ready city-founding unit is on a legal tile',
    'score every legal city production using domestic, expansion, defense, and military wants',
    'aggregate research wants from unit, building, and government unlocks',
    'adjust government and tax policy through authoritative managers',
    'optimize AI citizen, tile, and specialist assignments with Freeciv output constraints',
    'enable authoritative worker and exploration automation',
    'use legal caravan, city-join, home-city, and unit-upgrade outcomes',
    'score military targets by expected shield profit and pursue reachable targets',
    'persist city guard assignments, reinforce danger, and fortify defenders',
    'assign specialist hunters to persistent high-value mobile targets',
    'pair ferryboats with passengers and execute rendezvous, loading, delivery, and unloading',
    'plan fuel-safe air strikes, base returns, and undefended-city paradrops',
    'plan defensive diplomats, embassies, espionage, and military-unit bribery',
    'value incoming treaties and make proactive cease-fire, peace, and alliance proposals',
    'persist difficulty, traits, diplomacy memory, assignments, and wants across restarts',
    'yield game completion to the authoritative conquest evaluator',
  ],
  remaining: [
    'complete lifecycle event callbacks and use persisted assignments across every advisor',
    'complete city, technology, government, rates, spending, and worklist advisor want parity',
    'settlement-site and worker-improvement reservation parity',
    'complete amphibious invasion coordination, air-defense/refueling depth, and advanced espionage valuation',
    'complete Freeciv diplomacy threat, reputation, incident, and material-clause valuation',
  ],
} as const;

/**
 * Deterministic baseline AI that delegates all mutations to authoritative
 * managers. A failed optional decision is isolated so one unsuitable unit or
 * city cannot abort turn processing for every AI player.
 */
export class CivJSAIAdapter {
  private readonly hostilityPolicy: DiplomacyHostilityPolicy;
  private readonly stateStore: FreecivAIStateStore;

  constructor(
    private readonly diplomacyManager: DiplomacyManager,
    hostilityPolicy?: DiplomacyHostilityPolicy,
    databaseProvider?: DatabaseProvider
  ) {
    this.hostilityPolicy = hostilityPolicy ?? new DiplomacyHostilityPolicy(diplomacyManager);
    this.stateStore = new FreecivAIStateStore(databaseProvider);
  }

  async processTurn(gameId: string, game: GameInstance): Promise<number> {
    if (game.state !== 'active') return 0;

    let actions = 0;
    for (const player of game.players.values()) {
      if (!player.isAI) continue;
      const playerId = player.id;
      const state = normalizeAIState(player.aiState);
      player.aiState = state as unknown as Record<string, unknown>;
      game.visibilityManager.updatePlayerVisibility(playerId);
      const actionsBeforePlayer = actions;
      actions += await this.attempt('research', () => this.selectResearch(game, playerId));
      actions += await this.attempt('government', () => this.manageGovernment(game, playerId));
      actions += await this.attempt('economy', () => this.manageEconomy(game, playerId));
      actions += await this.attempt('citizens', () => this.manageCitizens(game, playerId));
      actions += await this.attempt('production', () =>
        this.selectCityProduction(game, playerId, state)
      );
      actions += await this.attempt('expansion', () =>
        this.foundReadyCities(game, playerId, state)
      );
      actions += await this.attempt('city unit actions', () =>
        this.executeCityUnitActions(game, playerId)
      );
      actions += await this.attempt('workers', () => this.automateWorkers(game, playerId));
      actions += await this.attempt('ferries', () => this.manageFerries(game, playerId, state));
      actions += await this.attempt('guards', () => this.manageCityGuards(game, playerId, state));
      actions += await this.attempt('diplomats', () =>
        this.manageDiplomatUnits(gameId, game, playerId, state)
      );
      actions += await this.attempt('air', () =>
        this.manageAirAndParadrops(gameId, game, playerId, state)
      );
      actions += await this.attempt('hunters', () =>
        this.manageHunters(gameId, game, playerId, state)
      );
      actions += await this.attempt('combat', () =>
        this.attackAdjacentEnemies(gameId, game, playerId, state)
      );
      actions += await this.attempt('exploration', () => this.automateExploration(game, playerId));
      actions += await this.attempt('diplomacy', () =>
        this.manageDiplomacy(gameId, game, playerId, state)
      );
      state.lastProcessedTurn = game.currentTurn;
      state.lastDecisionCount = actions - actionsBeforePlayer;
      player.aiState = state as unknown as Record<string, unknown>;
      await this.attempt('state persistence', async () => {
        await this.stateStore.save(gameId, playerId, state);
        return 0;
      });
    }
    return actions;
  }

  /**
   * Freeciv invalidates unit AI data at the lifecycle boundary instead of
   * waiting for the next advisor pass. Remove both the destroyed unit's task
   * and every assignment that charged it as a target.
   */
  onUnitDestroyed(gameId: string, game: GameInstance, unit: Unit): void {
    for (const player of game.players.values()) {
      if (!player.isAI) continue;
      const state = normalizeAIState(player.aiState);
      delete state.unitTasks[unit.id];
      for (const [unitId, task] of Object.entries(state.unitTasks)) {
        if (task.targetId === unit.id) delete state.unitTasks[unitId];
      }
      player.aiState = state as unknown as Record<string, unknown>;
      void this.stateStore.save(gameId, player.id, state).catch(error => {
        logger.warn('CivJS AI lifecycle state persistence failed', {
          gameId,
          playerId: player.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  /**
   * City removal/capture invalidates production wants and guard charges
   * immediately. Capture clears references for every AI because ownership and
   * diplomatic legality may have changed for both sides.
   */
  onCityInvalidated(gameId: string, game: GameInstance, cityId: string): void {
    for (const player of game.players.values()) {
      if (!player.isAI) continue;
      const state = normalizeAIState(player.aiState);
      delete state.cityWants[cityId];
      for (const [unitId, task] of Object.entries(state.unitTasks)) {
        if (task.targetId === cityId) delete state.unitTasks[unitId];
      }
      player.aiState = state as unknown as Record<string, unknown>;
      void this.stateStore.save(gameId, player.id, state).catch(error => {
        logger.warn('CivJS AI lifecycle state persistence failed', {
          gameId,
          playerId: player.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  private async attempt(label: string, decision: () => Promise<number>): Promise<number> {
    try {
      return await decision();
    } catch (error) {
      logger.warn('CivJS AI decision failed', {
        decision: label,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  private async selectResearch(game: GameInstance, playerId: string): Promise<number> {
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
    const researchChoice = catalogue
      ? chooseResearch({
          available,
          catalogue,
          unitTypes: UNIT_TYPES,
          buildingTypes: BUILDING_TYPES,
          governmentTechs,
          militaryPressure: hostileIds.size,
          cityCount: cities.length,
          profile,
          researchedTechs: research?.researchedTechs,
        })
      : undefined;
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
    // Freeciv retains an active research target unless an advisor explicitly
    // decides that changing it is worth the configured technology-switch
    // penalty. CivJS currently has the classic 100% penalty, so routine
    // re-ranking must never discard accumulated bulbs.
    if (research?.currentTech) return 0;
    if (choice.id === research?.currentTech) return 0;
    await game.researchManager.setCurrentResearch(playerId, choice.id);
    return 1;
  }

  private async manageCitizens(game: GameInstance, playerId: string): Promise<number> {
    if (typeof game.cityManager.optimizeCityManually !== 'function') return 0;
    const player = game.players.get(playerId);
    const profile = createAIProfile(player?.aiLevel, player?.aiTraits);
    let actions = 0;
    for (const city of game.cityManager
      .getPlayerCities(playerId)
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))) {
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
      const optimized = await game.cityManager.optimizeCityManually(city.id, parameters);
      if (optimized) actions++;
    }
    return actions;
  }

  private async selectCityProduction(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    let actions = 0;
    const cities = game.cityManager
      .getPlayerCities(playerId)
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
    const units = game.unitManager.getPlayerUnits(playerId);
    let expansionQueued = units.some(
      unit => game.unitManager.getUnitType(unit.unitTypeId)?.canFoundCity
    );
    const hostilePlayerIds = await this.hostilityPolicy.getHostilePlayerIds(game.id, playerId);
    const player = game.players.get(playerId);
    const profile = createAIProfile(player?.aiLevel, player?.aiTraits);
    const hostileUnits = this.hostileUnitsForPlanning(game, playerId, hostilePlayerIds, profile);
    const reservedWonders = new Set(
      cities
        .flatMap(city => [city.currentProduction, ...(city.worklist ?? []).map(item => item.value)])
        .filter((buildingId): buildingId is string =>
          Boolean(buildingId && BUILDING_TYPES[buildingId]?.genus === 'GreatWonder')
        )
    );

    for (const city of cities) {
      const ranked =
        typeof game.cityManager.canCityContinueProduction === 'function'
          ? rankCityProduction({
              city,
              cities,
              units,
              unitTypes: UNIT_TYPES,
              buildingTypes: BUILDING_TYPES,
              canBuild: (kind, id) => game.cityManager.canCityContinueProduction(city.id, kind, id),
              nearbyEnemyStrength: hostileUnits.reduce((sum, enemy) => {
                const distance = game.mapManager.getDistance(city.x, city.y, enemy.x, enemy.y);
                if (distance > 4) return sum;
                const enemyType = game.unitManager.getUnitType(enemy.unitTypeId);
                return sum + (enemyType?.attack ?? enemyType?.combat ?? 0) / Math.max(1, distance);
              }, 0),
              profile,
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
      if (
        city.currentProduction &&
        (city.worklist?.length ?? 0) === 0 &&
        typeof game.cityManager.addToWorklist === 'function'
      ) {
        const queued = ranked.slice(0, 2).map(choice => ({
          kind:
            BUILDING_TYPES[choice.value.id]?.genus === 'GreatWonder'
              ? ('wonder' as const)
              : choice.value.kind,
          value: choice.value.id,
        }));
        if (
          queued.length > 0 &&
          (await game.cityManager.addToWorklist(city.id, queued, playerId))
        ) {
          for (const item of queued) {
            if (BUILDING_TYPES[item.value]?.genus === 'GreatWonder') {
              reservedWonders.add(item.value);
            }
          }
          actions++;
        }
        continue;
      }
      if (city.currentProduction) continue;
      const scored = ranked[0];

      let type: 'unit' | 'building' = scored?.value.kind ?? 'unit';
      let id = scored?.value.id ?? 'warriors';
      if (!scored && (city.goldPerTurn ?? 0) < 0 && !city.buildings.includes('marketplace')) {
        type = 'building';
        id = 'marketplace';
      } else if (!scored && !expansionQueued) {
        id = 'settlers';
      }
      if (game.unitManager.getUnitType(id)?.canFoundCity) {
        expansionQueued = true;
      }

      await game.cityManager.setCityProduction(city.id, type, id, playerId);
      if (BUILDING_TYPES[id]?.genus === 'GreatWonder') reservedWonders.add(id);
      actions++;
    }
    return actions;
  }

  private async foundReadyCities(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    let actions = 0;
    for (const unit of this.sortedUnits(game, playerId)) {
      if (
        unit.movementLeft <= 0 ||
        unit.transportedBy ||
        !game.unitManager.getUnitType(unit.unitTypeId)?.canFoundCity
      ) {
        continue;
      }
      if (game.unitManager.canUnitPerformAction(unit.id, ActionType.FOUND_CITY)) {
        const result = await game.unitManager.executeUnitAction(
          unit.id,
          ActionType.FOUND_CITY,
          undefined,
          undefined,
          playerId
        );
        if (result.success) actions++;
        continue;
      }
      actions += await this.moveSettlerTowardBestSite(game, unit, state);
    }
    return actions;
  }

  private async moveSettlerTowardBestSite(
    game: GameInstance,
    unit: Unit,
    state: FreecivAIState
  ): Promise<number> {
    const map = game.mapManager.getMapData?.();
    if (
      !map ||
      typeof game.cityManager.canFoundCityAt !== 'function' ||
      typeof game.pathfindingManager?.findPath !== 'function'
    ) {
      return 0;
    }
    const player = game.players.get(unit.playerId);
    const profile = createAIProfile(player?.aiLevel, player?.aiTraits);
    const cities = game.cityManager.getAllCities();
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(game.id, unit.playerId);
    const hostileUnits = this.hostileUnitsForPlanning(game, unit.playerId, hostileIds, profile);
    const candidates = rankCitySites(
      map.tiles
        .flat()
        .filter(tile => game.cityManager.canFoundCityAt(tile.x, tile.y, unit.playerId)),
      (x, y) => game.mapManager.getNeighbors(x, y),
      terrain => rulesetLoader.getTerrain(terrain),
      tile => game.mapManager.getDistance(unit.x, unit.y, tile.x, tile.y),
      tile =>
        cities.length === 0
          ? Number.MAX_SAFE_INTEGER
          : Math.min(
              ...cities.map(city => game.mapManager.getDistance(city.x, city.y, tile.x, tile.y))
            ),
      tile =>
        hostileUnits.reduce((sum, enemy) => {
          const distance = game.mapManager.getDistance(tile.x, tile.y, enemy.x, enemy.y);
          return distance <= 3 ? sum + 1 / Math.max(1, distance) : sum;
        }, 0),
      (profile.expansion / 100) * (profile.traits.expansionist / 50)
    ).slice(0, 24);
    for (const candidate of candidates) {
      state.unitTasks[unit.id] = {
        role: 'settle',
        targetX: candidate.tile.x,
        targetY: candidate.tile.y,
        assignedTurn: game.currentTurn,
      };
      const path = await game.pathfindingManager.findPath(unit, candidate.tile.x, candidate.tile.y);
      if (!path.valid || path.path.length < 2) continue;
      const result = await game.unitManager.executeUnitAction(
        unit.id,
        ActionType.GOTO,
        candidate.tile.x,
        candidate.tile.y,
        unit.playerId
      );
      return result.success ? 1 : 0;
    }
    return 0;
  }

  private async automateWorkers(game: GameInstance, playerId: string): Promise<number> {
    let actions = 0;
    for (const unit of this.sortedUnits(game, playerId)) {
      const type = game.unitManager.getUnitType(unit.unitTypeId);
      if (!type?.canBuildImprovements || unit.automation) continue;
      const result = await game.unitManager.executeUnitAction(
        unit.id,
        ActionType.AUTO_SETTLER,
        undefined,
        undefined,
        playerId
      );
      if (result.success) actions++;
    }
    return actions;
  }

  private async executeCityUnitActions(game: GameInstance, playerId: string): Promise<number> {
    const preferences = [
      ActionType.HELP_WONDER,
      ActionType.MARKETPLACE,
      ActionType.JOIN_CITY,
      ActionType.CHANGE_HOME_CITY,
      ActionType.UPGRADE_UNIT,
    ];
    let actions = 0;
    for (const unit of this.sortedUnits(game, playerId)) {
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

  private async attackAdjacentEnemies(
    gameId: string,
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const hostilePlayerIds = await this.hostilityPolicy.getHostilePlayerIds(gameId, playerId);
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
    const enemies = this.hostileUnitsForPlanning(game, playerId, hostilePlayerIds, profile)
      .filter(unit => !unit.transportedBy)
      .sort((a, b) => a.id.localeCompare(b.id));
    let actions = 0;

    for (const attacker of this.sortedUnits(game, playerId)) {
      if (state.unitTasks[attacker.id]?.role === 'guard') continue;
      if (state.unitTasks[attacker.id]?.role === 'defend') continue;
      if (state.unitTasks[attacker.id]?.role === 'hunter') continue;
      if (state.unitTasks[attacker.id]?.role === 'air') continue;
      if (state.unitTasks[attacker.id]?.role === 'paradrop') continue;
      const type = game.unitManager.getUnitType(attacker.unitTypeId);
      if (attacker.movementLeft <= 0 || (type?.attack ?? type?.combat ?? 0) <= 0) continue;
      if (!type) continue;
      const ranked = rankMilitaryTargets(
        attacker,
        type,
        enemies.filter(target => Boolean(game.unitManager.getUnit(target.id))),
        unitTypeId => game.unitManager.getUnitType(unitTypeId),
        target => game.mapManager.getDistance(attacker.x, attacker.y, target.x, target.y)
      );
      let defender = ranked.find(target => target.distance <= (type.range ?? 1))?.unit;
      if (!defender) {
        const target = ranked[0]?.unit;
        if (target) {
          actions += await this.moveTowardMilitaryTarget(game, attacker, target);
          defender =
            game.unitManager.getUnit(target.id) &&
            game.mapManager.getDistance(attacker.x, attacker.y, target.x, target.y) <=
              (type.range ?? 1)
              ? target
              : undefined;
        }
      }
      if (!defender) continue;
      if (type?.flags?.includes('Nuclear')) {
        await game.unitManager.executeUnitAction(
          attacker.id,
          ActionType.NUCLEAR_EXPLOSION,
          defender.x,
          defender.y,
          playerId
        );
      } else if (type?.rulesetUnitClassFlags?.includes('Missile')) {
        await game.unitManager.executeUnitAction(
          attacker.id,
          ActionType.SUICIDE_ATTACK,
          defender.x,
          defender.y,
          playerId
        );
      } else {
        await game.unitManager.attackUnit(attacker.id, defender.id);
      }
      actions++;
    }
    return actions;
  }

  private async manageCityGuards(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const cities = game.cityManager
      .getPlayerCities(playerId)
      .filter(city => Number.isFinite(city.x) && Number.isFinite(city.y));
    if (cities.length === 0) return 0;
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(game.id, playerId);
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
    const hostileUnits = this.hostileUnitsForPlanning(game, playerId, hostileIds, profile);
    const plan = planCityGuards({
      turn: game.currentTurn,
      cities,
      friendlyUnits: game.unitManager.getPlayerUnits(playerId),
      hostileUnits,
      existingTasks: state.unitTasks,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      dangerHandicap: profile.handicaps.has('danger'),
    });

    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (task.role === 'guard' || task.role === 'defend') {
        delete state.unitTasks[unitId];
      }
    }
    Object.assign(state.unitTasks, plan.assignments);

    let actions = 0;
    for (const [unitId, task] of Object.entries(plan.assignments).sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      const unit = game.unitManager.getUnit(unitId);
      const city = task.targetId ? game.cityManager.getCity(task.targetId) : undefined;
      if (!unit || !city || unit.movementLeft <= 0) continue;
      if (unit.x === city.x && unit.y === city.y) {
        if (!unit.fortified && game.unitManager.canUnitPerformAction(unit.id, ActionType.FORTIFY)) {
          const result = await game.unitManager.executeUnitAction(
            unit.id,
            ActionType.FORTIFY,
            undefined,
            undefined,
            playerId
          );
          if (result.success) actions++;
        }
        continue;
      }
      if (!game.unitManager.canUnitPerformAction(unit.id, ActionType.GOTO, city.x, city.y)) {
        continue;
      }
      const result = await game.unitManager.executeUnitAction(
        unit.id,
        ActionType.GOTO,
        city.x,
        city.y,
        playerId
      );
      if (result.success) actions++;
    }
    return actions;
  }

  private async manageFerries(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const plan = planFerries({
      friendlyUnits: game.unitManager.getPlayerUnits(playerId),
      existingTasks: state.unitTasks,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      capacityRemaining: ferryId => game.unitManager.getTransportCapacityRemaining(ferryId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
    });
    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (task.role === 'ferry') delete state.unitTasks[unitId];
    }
    for (const assignment of plan) {
      state.unitTasks[assignment.ferry.id] = {
        role: 'ferry',
        targetId: assignment.passenger.id,
        targetX: assignment.destinationX,
        targetY: assignment.destinationY,
        assignedTurn: game.currentTurn,
      };
    }

    let actions = 0;
    for (const assignment of plan) {
      const { ferry, passenger } = assignment;
      if (assignment.phase === 'embarked') {
        if (await game.unitManager.loadUnitOntoTransport(ferry.id, passenger.id)) actions++;
        continue;
      }
      if (assignment.phase === 'rendezvous') {
        if (ferry.x === passenger.x && ferry.y === passenger.y) {
          if (await game.unitManager.loadUnitOntoTransport(ferry.id, passenger.id)) actions++;
          continue;
        }
        const rendezvous = await this.findReachableFerryWaypoint(
          game,
          ferry,
          game.mapManager.getNeighbors(passenger.x, passenger.y)
        );
        if (rendezvous && ferry.movementLeft > 0) {
          const result = await game.unitManager.executeUnitAction(
            ferry.id,
            ActionType.GOTO,
            rendezvous.x,
            rendezvous.y,
            playerId
          );
          if (result.success) actions++;
        }
        // A land unit embarks through the authoritative movement path by
        // entering the adjacent transport's tile. Freeciv likewise moves the
        // passenger to the boat; naval units cannot path onto its land tile.
        if (
          game.mapManager.getDistance(ferry.x, ferry.y, passenger.x, passenger.y) <= 1 &&
          !passenger.transportedBy &&
          passenger.movementLeft > 0
        ) {
          const result = await game.unitManager.executeUnitAction(
            passenger.id,
            ActionType.GOTO,
            ferry.x,
            ferry.y,
            playerId
          );
          if (result.success) actions++;
        }
        continue;
      }
      const landing = await this.findFerryLanding(
        game,
        ferry,
        passenger,
        assignment.destinationX,
        assignment.destinationY
      );
      if (!landing) continue;
      if (game.unitManager.canUnloadUnit(passenger.id, landing.landX, landing.landY)) {
        if (await game.unitManager.unloadUnit(passenger.id, landing.landX, landing.landY)) {
          actions++;
        }
        continue;
      }
      if (ferry.movementLeft > 0) {
        const result = await game.unitManager.executeUnitAction(
          ferry.id,
          ActionType.GOTO,
          landing.waterX,
          landing.waterY,
          playerId
        );
        if (result.success) actions++;
      }
    }
    return actions;
  }

  /**
   * Select a native, reachable water tile next to the passenger. This is the
   * CivJS equivalent of Freeciv's ferry rendezvous beach search.
   *
   * @reference reference/freeciv/ai/default/daiferry.c:dai_gobyboat
   */
  private async findReachableFerryWaypoint(
    game: GameInstance,
    ferry: Unit,
    candidates: Array<{ x: number; y: number }>
  ): Promise<{ x: number; y: number } | null> {
    const reachable: Array<{ x: number; y: number; turns: number; cost: number }> = [];
    for (const candidate of candidates) {
      if (!game.unitManager.canContinuePathFrom(ferry, candidate.x, candidate.y)) continue;
      const path = await game.pathfindingManager.findPath(ferry, candidate.x, candidate.y);
      if (!path.valid) continue;
      reachable.push({
        x: candidate.x,
        y: candidate.y,
        turns: path.estimatedTurns,
        cost: path.totalCost,
      });
    }
    reachable.sort(
      (left, right) =>
        left.turns - right.turns || left.cost - right.cost || left.y - right.y || left.x - right.x
    );
    return reachable[0] ?? null;
  }

  /**
   * Find a legal beachhead and the adjacent naval waypoint from which cargo
   * can unload. Search is intentionally map-complete: inland objectives and
   * irregular coastlines must not silently disable ferry missions.
   *
   * @reference reference/freeciv/ai/default/daiferry.c:dai_find_beachhead
   */
  private async findFerryLanding(
    game: GameInstance,
    ferry: Unit,
    passenger: Unit,
    destinationX: number,
    destinationY: number
  ): Promise<{ landX: number; landY: number; waterX: number; waterY: number } | null> {
    const landCandidates: Array<{ x: number; y: number; distance: number }> = [];
    const width = game.config.mapWidth ?? 80;
    const height = game.config.mapHeight ?? 50;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (
          !game.mapManager.isValidPosition(x, y) ||
          !game.unitManager.canContinuePathFrom(passenger, x, y)
        ) {
          continue;
        }
        const city = game.cityManager.getCityAt(x, y);
        if (city && city.playerId !== passenger.playerId) continue;
        const enemy = game.unitManager
          .getUnitsAt(x, y)
          .some(candidate => candidate.playerId !== passenger.playerId);
        if (enemy) continue;
        landCandidates.push({
          x,
          y,
          distance: game.mapManager.getDistance(x, y, destinationX, destinationY),
        });
      }
    }
    landCandidates.sort(
      (left, right) => left.distance - right.distance || left.y - right.y || left.x - right.x
    );

    for (const land of landCandidates) {
      const water = await this.findReachableFerryWaypoint(
        game,
        ferry,
        game.mapManager.getNeighbors(land.x, land.y)
      );
      if (water) {
        return {
          landX: land.x,
          landY: land.y,
          waterX: water.x,
          waterY: water.y,
        };
      }
    }
    return null;
  }

  private async manageAirAndParadrops(
    gameId: string,
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(gameId, playerId);
    const allCities = game.cityManager.getAllCities?.() ?? [];
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
    const missions = planAirMissions({
      friendlyUnits: game.unitManager.getPlayerUnits(playerId),
      hostileUnits: this.hostileUnitsForPlanning(game, playerId, hostileIds, profile),
      friendlyCities: allCities.filter(city => city.playerId === playerId),
      hostileCities: this.targetableForeignCities(game, playerId, hostileIds, profile),
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      planesHandicap: profile.handicaps.has('no_planes'),
    });
    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (task.role === 'air' || task.role === 'paradrop') delete state.unitTasks[unitId];
    }
    let actions = 0;
    for (const mission of missions) {
      state.unitTasks[mission.unit.id] = {
        role: mission.kind === 'paradrop' ? 'paradrop' : 'air',
        targetId:
          mission.kind === 'strike'
            ? mission.target.id
            : mission.kind === 'paradrop'
              ? mission.targetCity.id
              : undefined,
        targetX: mission.targetX,
        targetY: mission.targetY,
        assignedTurn: game.currentTurn,
      };
      if (mission.unit.movementLeft <= 0) continue;
      if (mission.kind === 'paradrop') {
        const result = await game.unitManager.executeUnitAction(
          mission.unit.id,
          ActionType.PARADROP,
          mission.targetX,
          mission.targetY,
          playerId
        );
        if (result.success) actions++;
      } else if (mission.kind === 'return') {
        const result = await game.unitManager.executeUnitAction(
          mission.unit.id,
          ActionType.GOTO,
          mission.targetX,
          mission.targetY,
          playerId
        );
        if (result.success) actions++;
      } else {
        const type = game.unitManager.getUnitType(mission.unit.unitTypeId);
        if ((type?.bombardRate ?? 0) > 0) {
          const result = await game.unitManager.executeUnitAction(
            mission.unit.id,
            ActionType.BOMBARD,
            mission.targetX,
            mission.targetY,
            playerId
          );
          if (result.success) actions++;
        } else {
          await game.unitManager.attackUnit(mission.unit.id, mission.target.id);
          actions++;
        }
      }
    }
    return actions;
  }

  private async manageDiplomatUnits(
    gameId: string,
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(gameId, playerId);
    const units = game.unitManager.getPlayerUnits(playerId);
    const cities = game.cityManager.getAllCities?.() ?? [];
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
    const missions = planDiplomatMissions({
      diplomats: units.filter(unit =>
        game.unitManager.getUnitType(unit.unitTypeId)?.flags?.includes('Diplomat')
      ),
      friendlyUnits: units,
      hostileUnits: this.hostileUnitsForPlanning(game, playerId, hostileIds, profile),
      foreignCities: this.targetableForeignCities(
        game,
        playerId,
        new Set(cities.filter(city => city.playerId !== playerId).map(city => city.playerId)),
        profile
      ),
      friendlyCities: cities.filter(city => city.playerId === playerId),
      hostilePlayerIds: hostileIds,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      diplomatHandicap: profile.handicaps.has('diplomat'),
    });
    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (task.role === 'diplomat') delete state.unitTasks[unitId];
    }
    let actions = 0;
    for (const mission of missions) {
      state.unitTasks[mission.unit.id] = {
        role: 'diplomat',
        targetId: mission.targetId,
        targetX: mission.targetX,
        targetY: mission.targetY,
        assignedTurn: game.currentTurn,
      };
      if (mission.unit.movementLeft <= 0) continue;
      const distance = game.mapManager.getDistance(
        mission.unit.x,
        mission.unit.y,
        mission.targetX,
        mission.targetY
      );
      if (mission.kind === 'action' && mission.action && distance <= 1) {
        const result = await game.unitManager.executeUnitAction(
          mission.unit.id,
          mission.action,
          mission.targetX,
          mission.targetY,
          playerId
        );
        if (result.success) actions++;
        continue;
      }
      const result = await game.unitManager.executeUnitAction(
        mission.unit.id,
        ActionType.GOTO,
        mission.targetX,
        mission.targetY,
        playerId
      );
      if (result.success) actions++;
    }
    return actions;
  }

  private async manageHunters(
    gameId: string,
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(gameId, playerId);
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
    const hostileUnits = this.hostileUnitsForPlanning(game, playerId, hostileIds, profile).filter(
      unit => !unit.transportedBy
    );
    const plan = planHunters({
      turn: game.currentTurn,
      friendlyUnits: game.unitManager.getPlayerUnits(playerId),
      hostileUnits,
      existingTasks: state.unitTasks,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
    });
    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (task.role === 'hunter') delete state.unitTasks[unitId];
    }
    Object.assign(state.unitTasks, plan.assignments);

    let actions = 0;
    for (const [unitId, task] of Object.entries(plan.assignments).sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      const hunter = game.unitManager.getUnit(unitId);
      const target = task.targetId ? game.unitManager.getUnit(task.targetId) : undefined;
      if (!hunter || !target || hunter.movementLeft <= 0) continue;
      const type = game.unitManager.getUnitType(hunter.unitTypeId);
      if (!type) continue;
      if (
        game.mapManager.getDistance(hunter.x, hunter.y, target.x, target.y) <= (type.range ?? 1)
      ) {
        await game.unitManager.attackUnit(hunter.id, target.id);
        actions++;
        continue;
      }
      actions += await this.moveTowardMilitaryTarget(game, hunter, target);
    }
    return actions;
  }

  private async moveTowardMilitaryTarget(
    game: GameInstance,
    attacker: Unit,
    target: Unit
  ): Promise<number> {
    if (
      typeof game.mapManager.getNeighbors !== 'function' ||
      typeof game.pathfindingManager?.findPath !== 'function'
    ) {
      return 0;
    }
    const candidates = await Promise.all(
      game.mapManager.getNeighbors(target.x, target.y).map(async tile => ({
        tile,
        path: await game.pathfindingManager.findPath(attacker, tile.x, tile.y),
      }))
    );
    const destination = candidates
      .filter(candidate => candidate.path.valid && candidate.path.path.length > 1)
      .sort(
        (a, b) =>
          a.path.estimatedTurns - b.path.estimatedTurns ||
          a.path.totalCost - b.path.totalCost ||
          a.tile.x - b.tile.x ||
          a.tile.y - b.tile.y
      )[0]?.tile;
    if (!destination) return 0;
    const result = await game.unitManager.executeUnitAction(
      attacker.id,
      ActionType.GOTO,
      destination.x,
      destination.y,
      attacker.playerId
    );
    return result.success ? 1 : 0;
  }

  private async manageGovernment(game: GameInstance, playerId: string): Promise<number> {
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

  private async manageEconomy(game: GameInstance, playerId: string): Promise<number> {
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
    const hostileUnits = this.hostileUnitsForPlanning(game, playerId, hostileIds, profile);
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
      const result = await game.cityManager.buyProduction(cityId, playerId);
      if (result.success) actions++;
    }
    return actions;
  }

  private async automateExploration(game: GameInstance, playerId: string): Promise<number> {
    const unit = this.sortedUnits(game, playerId).find(candidate => {
      const type = game.unitManager.getUnitType(candidate.unitTypeId);
      return (
        candidate.movementLeft > 0 &&
        !candidate.automation &&
        !type?.canBuildImprovements &&
        (type?.attack ?? type?.combat ?? 0) <= 0 &&
        game.unitManager.canUnitPerformAction(candidate.id, ActionType.AUTO_EXPLORE)
      );
    });
    if (!unit) return 0;
    const result = await game.unitManager.executeUnitAction(
      unit.id,
      ActionType.AUTO_EXPLORE,
      undefined,
      undefined,
      playerId
    );
    return result.success ? 1 : 0;
  }

  private sortedUnits(game: GameInstance, playerId: string): Unit[] {
    return game.unitManager
      .getPlayerUnits(playerId)
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * H_TARGETS is the Freeciv limitation that prevents lower-skill AI from
   * selecting units or cities under fog. Higher levels deliberately retain
   * Freeciv's omniscient target selection when that handicap is absent.
   *
   * @reference reference/freeciv/ai/default/daiunit.c
   * @reference reference/freeciv/ai/default/daiair.c
   */
  private hostileUnitsForPlanning(
    game: GameInstance,
    playerId: string,
    hostilePlayerIds: ReadonlySet<string>,
    profile: AIProfile
  ): Unit[] {
    const candidates = profile.handicaps.has('targets')
      ? game.unitManager.getVisibleUnits(
          playerId,
          game.visibilityManager.getVisibleTiles(playerId),
          game.visibilityManager.getDetectionTiles(playerId)
        )
      : Array.from(game.unitManager.getAllUnits().values());
    return candidates.filter(unit => hostilePlayerIds.has(unit.playerId));
  }

  private targetableForeignCities(
    game: GameInstance,
    playerId: string,
    targetPlayerIds: ReadonlySet<string>,
    profile: AIProfile
  ) {
    return (game.cityManager.getAllCities?.() ?? []).filter(
      city =>
        targetPlayerIds.has(city.playerId) &&
        (!profile.handicaps.has('targets') ||
          game.visibilityManager.isTileVisible(playerId, city.x, city.y))
    );
  }

  private async manageDiplomacy(
    gameId: string,
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const snapshot = await this.diplomacyManager.getSnapshot(gameId, playerId);
    const player = game.players.get(playerId);
    const profile = createAIProfile(player?.aiLevel, player?.aiTraits);
    let actions = 0;
    for (const nation of snapshot.nations.slice().sort((a, b) => a.id.localeCompare(b.id))) {
      const memory = state.diplomacy[nation.id] ?? {
        love: 0,
        warDesire: 0,
        countdown: 0,
      };
      memory.love = Math.max(
        -1000,
        Math.min(
          1000,
          Math.round(
            memory.love * 0.8 +
              (nation.relation.attitude ?? 0) +
              (nation.relation.reputation ?? 0) / 10
          )
        )
      );
      memory.warDesire = Math.max(
        -1000,
        Math.min(
          1000,
          memory.warDesire +
            (nation.relation.state === 'war' ? 10 : -5) +
            (profile.traits.aggressive - 50)
        )
      );
      memory.countdown = Math.max(0, memory.countdown - 1);
      state.diplomacy[nation.id] = memory;

      const proposal = nation.relation.proposal;
      if (proposal?.status === 'pending' && proposal.recipientId === playerId) {
        const accepted = this.evaluateTreaty(
          proposal.clauses,
          playerId,
          nation.relation.state,
          memory.love,
          profile.handicaps.has('defensive')
        );
        await this.diplomacyManager.respondToTreaty(
          gameId,
          playerId,
          nation.id,
          proposal.id,
          accepted
        );
        memory.countdown = 3;
        actions++;
        continue;
      }
      if (
        proposal?.status === 'pending' ||
        memory.countdown > 0 ||
        !nation.known ||
        !nation.canMeet ||
        typeof this.diplomacyManager.proposeTreaty !== 'function'
      ) {
        continue;
      }
      const clauses = this.chooseProactiveTreaty(
        nation.relation.state,
        memory.love,
        profile.handicaps
      );
      if (!clauses) continue;
      await this.diplomacyManager.proposeTreaty(
        gameId,
        playerId,
        nation.id,
        clauses,
        `ai:${game.currentTurn}:${playerId}:${nation.id}:${clauses[0].type}`
      );
      memory.lastContactTurn = game.currentTurn;
      memory.countdown = 5;
      actions++;
    }
    return actions;
  }

  private evaluateTreaty(
    clauses: TreatyClause[],
    playerId: string,
    currentState: string,
    love: number,
    defensive: boolean
  ): boolean {
    return clauses.every(clause => {
      if (clause.type === 'ceasefire') return currentState === 'war' || love >= -100;
      if (clause.type === 'peace') return currentState !== 'alliance' && love >= -200;
      if (clause.type === 'alliance') return !defensive && love >= 40;
      if (clause.type === 'embassy' || clause.type === 'map' || clause.type === 'seamap') {
        return clause.giverId !== playerId || love >= 0;
      }
      if (clause.type === 'shared_vision') {
        return clause.giverId !== playerId || love >= 100;
      }
      return clause.giverId !== playerId || love >= 200;
    });
  }

  private chooseProactiveTreaty(
    currentState: string,
    love: number,
    handicaps: ReadonlySet<string>
  ): TreatyClause[] | undefined {
    if (currentState === 'war' && (love >= -50 || handicaps.has('ceasefire'))) {
      return [{ type: 'ceasefire' }];
    }
    if ((currentState === 'ceasefire' || currentState === 'armistice') && love >= 10) {
      return [{ type: 'peace' }];
    }
    if (
      currentState === 'peace' &&
      love >= 80 &&
      !handicaps.has('defensive') &&
      !handicaps.has('diplomacy')
    ) {
      return [{ type: 'alliance' }];
    }
    return undefined;
  }
}
