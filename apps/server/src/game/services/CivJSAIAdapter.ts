import type { GameInstance } from '@game/managers/GameManager';
import type { DiplomacyManager, TreatyClause } from '@game/managers/DiplomacyManager';
import type { Unit } from '@game/managers/UnitManager';
import { ActionType } from '@app-types/shared/actions';
import { logger } from '@utils/logger';
import { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';
import { BUILDING_TYPES } from '@game/managers/CityManager';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import {
  chooseCityProduction,
  chooseResearch,
  rankCitySites,
  rankMilitaryTargets,
} from '@game/ai/FreecivAIPlanner';
import { createAIProfile } from '@game/ai/FreecivAIProfile';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { DatabaseProvider } from '@database';
import {
  FreecivAIStateStore,
  normalizeAIState,
  type FreecivAIState,
} from '@game/ai/FreecivAIStateStore';
import { planCityGuards } from '@game/ai/FreecivAIGuardPlanner';
import { planHunters } from '@game/ai/FreecivAIHunterPlanner';

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
    'enable authoritative worker and exploration automation',
    'use legal caravan, city-join, home-city, and unit-upgrade outcomes',
    'score military targets by expected shield profit and pursue reachable targets',
    'persist city guard assignments, reinforce danger, and fortify defenders',
    'assign specialist hunters to persistent high-value mobile targets',
    'value incoming treaties and make proactive cease-fire, peace, and alliance proposals',
    'persist difficulty, traits, diplomacy memory, assignments, and wants across restarts',
    'yield game completion to the authoritative conquest evaluator',
  ],
  remaining: [
    'complete lifecycle event callbacks and use persisted assignments across every advisor',
    'complete city, technology, government, rates, spending, and advisor want parity',
    'settlement-site and worker-improvement reservation parity',
    'ferries, amphibious operations, air, paradrop, and diplomat planning',
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
      const actionsBeforePlayer = actions;
      actions += await this.attempt('research', () => this.selectResearch(game, playerId));
      actions += await this.attempt('government', () => this.manageGovernment(game, playerId));
      actions += await this.attempt('economy', () => this.manageEconomy(game, playerId));
      actions += await this.attempt('production', () => this.selectCityProduction(game, playerId));
      actions += await this.attempt('expansion', () => this.foundReadyCities(game, playerId));
      actions += await this.attempt('city unit actions', () =>
        this.executeCityUnitActions(game, playerId)
      );
      actions += await this.attempt('workers', () => this.automateWorkers(game, playerId));
      actions += await this.attempt('guards', () => this.manageCityGuards(game, playerId, state));
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
      void this.stateStore.save(gameId, player.id, state);
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
      void this.stateStore.save(gameId, player.id, state);
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
    const choice = catalogue
      ? chooseResearch({
          available,
          catalogue,
          unitTypes: UNIT_TYPES,
          buildingTypes: BUILDING_TYPES,
          governmentTechs,
          militaryPressure: hostileIds.size,
          cityCount: cities.length,
          profile,
        })?.value
      : available.sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))[0];
    if (!choice || choice.id === research?.currentTech) return 0;
    await game.researchManager.setCurrentResearch(playerId, choice.id);
    return 1;
  }

  private async selectCityProduction(game: GameInstance, playerId: string): Promise<number> {
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
    const hostileUnits = Array.from(game.unitManager.getAllUnits().values()).filter(unit =>
      hostilePlayerIds.has(unit.playerId)
    );

    for (const city of cities) {
      if (city.currentProduction) continue;

      const scored =
        typeof game.cityManager.canCityContinueProduction === 'function'
          ? chooseCityProduction({
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
            })
          : undefined;

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
      actions++;
    }
    return actions;
  }

  private async foundReadyCities(game: GameInstance, playerId: string): Promise<number> {
    let actions = 0;
    for (const unit of this.sortedUnits(game, playerId)) {
      if (unit.movementLeft <= 0 || !game.unitManager.getUnitType(unit.unitTypeId)?.canFoundCity) {
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
      actions += await this.moveSettlerTowardBestSite(game, unit);
    }
    return actions;
  }

  private async moveSettlerTowardBestSite(game: GameInstance, unit: Unit): Promise<number> {
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
    const hostileUnits = Array.from(game.unitManager.getAllUnits().values()).filter(enemy =>
      hostileIds.has(enemy.playerId)
    );
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
    const enemies = Array.from(game.unitManager.getAllUnits().values())
      .filter(unit => hostilePlayerIds.has(unit.playerId) && !unit.transportedBy)
      .sort((a, b) => a.id.localeCompare(b.id));
    let actions = 0;

    for (const attacker of this.sortedUnits(game, playerId)) {
      if (state.unitTasks[attacker.id]?.role === 'guard') continue;
      if (state.unitTasks[attacker.id]?.role === 'defend') continue;
      if (state.unitTasks[attacker.id]?.role === 'hunter') continue;
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
    const hostileUnits = Array.from(game.unitManager.getAllUnits().values()).filter(unit =>
      hostileIds.has(unit.playerId)
    );
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
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

  private async manageHunters(
    gameId: string,
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(gameId, playerId);
    const hostileUnits = Array.from(game.unitManager.getAllUnits().values()).filter(
      unit => hostileIds.has(unit.playerId) && !unit.transportedBy
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

    const available = manager
      .getAvailableGovernments(new Set(research.researchedTechs))
      .filter(candidate => candidate.available && candidate.id !== 'anarchy');
    const preferredOrder = ['democracy', 'republic', 'communism', 'monarchy', 'despotism'];
    const best = available.sort(
      (a, b) =>
        preferredOrder.indexOf(a.id) - preferredOrder.indexOf(b.id) || a.id.localeCompare(b.id)
    )[0];
    if (!best || best.id === current.currentGovernment) return 0;
    if (!(await manager.canChangeGovernment(playerId, best.id))) return 0;
    await manager.initiateRevolution(playerId, best.id);
    return 1;
  }

  private async manageEconomy(game: GameInstance, playerId: string): Promise<number> {
    const manager = game.turnManager.getEconomicManager?.();
    if (!manager) return 0;
    const status = await manager.getPlayerEconomicStatus(playerId);
    const cities = game.cityManager.getPlayerCities(playerId);
    const netGold = cities.reduce((sum, city) => sum + (city.goldPerTurn ?? 0), 0);
    const unrest = cities.reduce(
      (sum, city) => sum + city.happiness.unhappy + city.happiness.angry,
      0
    );
    const desired = {
      tax: status.currentGold < 30 || netGold < 0 ? 60 : 30,
      luxury: unrest > 0 ? 20 : 0,
      science: 0,
    };
    desired.science = 100 - desired.tax - desired.luxury;
    if (
      status.taxRates.tax === desired.tax &&
      status.taxRates.luxury === desired.luxury &&
      status.taxRates.science === desired.science
    ) {
      return 0;
    }
    const result = manager.setPlayerTaxRates({ playerId, newRates: desired });
    return result.isValid ? 1 : 0;
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
