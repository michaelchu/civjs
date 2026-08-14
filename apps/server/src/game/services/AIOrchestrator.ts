/**
 * @module server/game/services/AIOrchestrator
 * Provides the server-side AIOrchestrator service.
 */
import type { DatabaseProvider } from '@database';
import { FreecivAIPlayerController } from '@game/ai/AIPlayerController';
import {
  assertAIState,
  FreecivAIStateStore,
  type AIDiplomacyMemory,
  type FreecivAIState,
} from '@game/ai/AIStateStore';
import type { DiplomacyEvent, DiplomacyManager } from '@game/managers/DiplomacyManager';
import type { GameInstance } from '@game/runtime/GameTypes';
import type { UnitLifecycleEvent } from '@game/units/UnitTypes';
import { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';
import { AIPlanningBudget } from '@game/ai/AIPlanningBudget';
import type { PathfindingDiagnostics } from '@game/managers/PathfindingManager';
import { logger } from '@utils/logger';

/**
 * Owns AI lifecycle, ordered per-player dispatch, and restart-safe state.
 * Domain decisions live behind the player controller and mutate the game only
 * through authoritative managers.
 */
export class FreecivAIOrchestrator {
  private readonly playerController: FreecivAIPlayerController;
  private readonly stateStore: FreecivAIStateStore;

  constructor(
    diplomacyManager: DiplomacyManager,
    hostilityPolicy?: DiplomacyHostilityPolicy,
    databaseProvider?: DatabaseProvider
  ) {
    this.playerController = new FreecivAIPlayerController(diplomacyManager, hostilityPolicy);
    this.stateStore = new FreecivAIStateStore(databaseProvider);
  }

  async processTurn(gameId: string, game: GameInstance): Promise<number> {
    if (game.state !== 'active') return 0;

    game.pathfindingManager.beginTurn?.(game.currentTurn);
    game.pathfindingManager.resetDiagnostics?.();
    let actions = 0;
    for (const player of game.players.values()) {
      if (!player.isAI) continue;
      const state = assertAIState(player.aiState);
      player.aiState = state as unknown as Record<string, unknown>;
      if (typeof game.currentTurn === 'number' && state.lastProcessedTurn === game.currentTurn) {
        continue;
      }
      if (typeof game.currentTurn === 'number' && state.inProgressTurn === game.currentTurn) {
        state.lastProcessedTurn = game.currentTurn;
        state.lastDecisionCount = 0;
        delete state.inProgressTurn;
        await this.stateStore.save(gameId, player.id, state);
        continue;
      }
      state.inProgressTurn = game.currentTurn;
      await this.stateStore.save(gameId, player.id, state);
      game.visibilityManager.updatePlayerVisibility(player.id);
      const playerStartedAt = Date.now();
      const budget = new AIPlanningBudget();
      const pathfindingBefore = game.pathfindingManager.getDiagnostics?.();
      let playerActions = 0;
      game.pathfindingManager.setPlanningBudget?.(budget);
      try {
        playerActions = await this.playerController.processPlayer(
          gameId,
          game,
          player.id,
          state,
          (label, decision) =>
            this.attempt(state, game, player.id, game.currentTurn ?? 0, label, decision)
        );
      } finally {
        game.pathfindingManager.setPlanningBudget?.();
      }
      const durationMs = Date.now() - playerStartedAt;
      const pathfindingAfter = game.pathfindingManager.getDiagnostics?.();
      const pathfinding = this.diagnosticsDelta(pathfindingBefore, pathfindingAfter);
      const budgetSnapshot = budget.snapshot();
      state.recentProcessingDiagnostics = {
        turn: game.currentTurn ?? 0,
        durationMs,
        pathfinding,
        budget: budgetSnapshot,
      };
      logger.info('CivJS AI player turn completed', {
        gameId,
        playerId: player.id,
        turn: game.currentTurn ?? 0,
        durationMs,
        actions: playerActions,
        pathfinding,
        budget: budgetSnapshot,
      });
      actions += playerActions;
      state.recentPlanSnapshot = {
        turn: game.currentTurn ?? 0,
        candidateScores: this.candidateScores(state),
        selectedActions: this.selectedActions(game, player.id),
        unitTasks: this.unitTasks(state),
        ...(state.treasuryGoal ? { treasuryGoal: { ...state.treasuryGoal } } : {}),
      };
      state.lastProcessedTurn = game.currentTurn;
      state.lastDecisionCount = playerActions;
      delete state.inProgressTurn;
      player.aiState = state as unknown as Record<string, unknown>;
      await this.attempt(
        state,
        game,
        player.id,
        game.currentTurn ?? 0,
        'state persistence',
        async () => {
          await this.stateStore.save(gameId, player.id, state);
          return 0;
        }
      );
      // The persistence attempt itself is traced after its write completes;
      // save once more so restart recovery sees that final trace entry too.
      await this.stateStore.save(gameId, player.id, state);
    }
    return actions;
  }

  onUnitLifecycle(gameId: string, game: GameInstance, event: UnitLifecycleEvent): void {
    if (event.type === 'created') return;
    this.mutateAllAIStates(gameId, game, state => {
      if (event.type === 'moved') {
        let changed = false;
        for (const task of Object.values(state.unitTasks)) {
          if (task.targetId !== event.unit.id) continue;
          task.targetX = event.unit.x;
          task.targetY = event.unit.y;
          changed = true;
        }
        return changed;
      }

      let changed = delete state.unitTasks[event.unit.id];
      for (const [unitId, task] of Object.entries(state.unitTasks)) {
        if (task.targetId === event.unit.id) {
          delete state.unitTasks[unitId];
          changed = true;
        }
      }
      return changed;
    });
  }

  /**
   * City removal/capture invalidates production wants and guard charges
   * immediately. Capture clears references for every AI because ownership and
   * diplomatic legality may have changed for both sides.
   */
  onCityInvalidated(gameId: string, game: GameInstance, cityId: string): void {
    this.mutateAllAIStates(gameId, game, state => {
      let changed = delete state.cityWants[cityId];
      for (const [unitId, task] of Object.entries(state.unitTasks)) {
        if (task.targetId === cityId) {
          delete state.unitTasks[unitId];
          changed = true;
        }
      }
      return changed;
    });
  }

  /**
   * Apply Freeciv's persistent relationship consequences at the incident
   * boundary. The regular diplomacy phase can then decay and reassess this
   * memory without losing events that occurred between AI turns.
   */
  onDiplomacyEvent(gameId: string, game: GameInstance, event: DiplomacyEvent): void {
    // Relationship changes alter border, city-entry, hostile-stack, and ZOC
    // legality. Drop any route-map snapshot before applying AI-only memory.
    if (
      event.type === 'first_contact' ||
      event.type === 'accepted' ||
      event.type === 'ceasefire_expired' ||
      event.type === 'armistice_completed' ||
      event.type === 'war_declared' ||
      event.type === 'incident'
    ) {
      game.pathfindingManager.invalidateCache?.();
    }
    if (event.type !== 'incident' && event.type !== 'war_declared') return;
    if (event.type === 'war_declared' && event.justified) return;
    const offenderId = event.offenderId ?? event.playerIds[0];
    const victimId = event.victimId ?? event.playerIds[1];

    this.mutateAllAIStates(gameId, game, (state, playerId) =>
      this.applyDiplomacyPenalty(state, playerId, event, offenderId, victimId)
    );
  }

  private applyDiplomacyPenalty(
    state: FreecivAIState,
    playerId: string,
    event: DiplomacyEvent,
    offenderId: string,
    victimId: string
  ): boolean {
    if (playerId === offenderId) return false;
    const memory = state.diplomacy[offenderId] ?? {
      love: 0,
      warDesire: 0,
      countdown: 0,
    };
    if (event.type === 'war_declared') {
      this.applyWarPenalty(memory, playerId === victimId);
    } else {
      const applied = this.applyIncidentPenalty(
        memory,
        event,
        playerId === victimId,
        offenderId === victimId
      );
      if (!applied) return false;
    }
    state.diplomacy[offenderId] = memory;
    return true;
  }

  private applyWarPenalty(memory: AIDiplomacyMemory, victim: boolean): void {
    memory.love = Math.max(-1000, memory.love - (victim ? 366 : 33));
    if (victim) memory.warDesire = Math.min(1000, memory.warDesire + 250);
  }

  private applyIncidentPenalty(
    memory: AIDiplomacyMemory,
    event: DiplomacyEvent,
    victim: boolean,
    selfDirected: boolean
  ): boolean {
    if (victim) {
      const severity =
        Math.max(1, event.severity ?? 100) * (event.scope === 'international_outcry' ? 2 : 1);
      memory.love = Math.max(-1000, memory.love - severity);
      memory.warDesire = Math.min(1000, memory.warDesire + Math.max(1, Math.round(severity / 2)));
      return true;
    }
    if (event.scope !== 'international_outcry') return false;
    const severity = Math.max(1, event.severity ?? 100);
    const multiplier = selfDirected ? 35 / 1000 : 35 / 500;
    memory.love = Math.max(-1000, memory.love - Math.max(1, Math.round(severity * multiplier)));
    return true;
  }

  private mutateAllAIStates(
    gameId: string,
    game: GameInstance,
    mutate: (state: FreecivAIState, playerId: string) => boolean
  ): void {
    for (const player of game.players.values()) {
      if (!player.isAI) continue;
      try {
        const state = assertAIState(player.aiState);
        if (!mutate(state, player.id)) continue;
        player.aiState = state as unknown as Record<string, unknown>;
        void this.stateStore.save(gameId, player.id, state).catch(error => {
          logger.warn('CivJS AI lifecycle state persistence failed', {
            gameId,
            playerId: player.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      } catch (error) {
        logger.warn('CivJS AI lifecycle mutation failed', {
          gameId,
          playerId: player.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async attempt(
    state: FreecivAIState,
    game: GameInstance,
    playerId: string,
    turn: number,
    label: string,
    decision: () => Promise<number>
  ): Promise<number> {
    const before = this.traceSnapshot(game, playerId, state);
    const startedAt = Date.now();
    try {
      const actions = await decision();
      const durationMs = Date.now() - startedAt;
      const after = this.traceSnapshot(game, playerId, state);
      this.recordDecision(state, {
        turn,
        label,
        actions,
        durationMs,
        input: before.input,
        economicDelta: this.economicDelta(before.economy, after.economy),
        outcome: this.outcome(before, after, actions),
      });
      logger.debug('CivJS AI decision completed', { playerId, turn, decision: label, durationMs });
      return actions;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startedAt;
      const after = this.traceSnapshot(game, playerId, state);
      this.recordDecision(state, {
        turn,
        label,
        actions: 0,
        durationMs,
        input: before.input,
        economicDelta: this.economicDelta(before.economy, after.economy),
        outcome: this.outcome(before, after, 0),
        error: message,
      });
      logger.warn('CivJS AI decision failed', {
        playerId,
        turn,
        decision: label,
        durationMs,
        error: message,
      });
      return 0;
    }
  }

  private traceSnapshot(game: GameInstance, playerId: string, state: FreecivAIState) {
    const cities = game.cityManager.getPlayerCities(playerId);
    const units = game.unitManager.getPlayerUnits(playerId);
    const finite = (value: number | undefined) => (Number.isFinite(value) ? (value as number) : 0);
    return {
      input: {
        cities: cities.length,
        units: units.length,
        tasks: Object.keys(state.unitTasks).length,
      },
      economy: {
        population: cities.reduce((total, city) => total + finite(city.population), 0),
        food: cities.reduce((total, city) => total + finite(city.foodPerTurn), 0),
        production: cities.reduce((total, city) => total + finite(city.productionPerTurn), 0),
        trade: cities.reduce((total, city) => total + finite(city.tradePerTurn), 0),
        science: cities.reduce((total, city) => total + finite(city.sciencePerTurn), 0),
      },
      unitPositions: Object.fromEntries(
        units
          .filter(unit => typeof unit.id === 'string')
          .sort((left, right) => left.id.localeCompare(right.id))
          .map(unit => [unit.id, `${unit.x},${unit.y},${unit.movementLeft ?? 0}`])
      ),
      taskSignatures: Object.fromEntries(
        Object.entries(state.unitTasks)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([unitId, task]) => [unitId, JSON.stringify(task)])
      ),
      cityProduction: Object.fromEntries(
        cities
          .slice()
          .sort((left, right) => left.id.localeCompare(right.id))
          .map(city => [city.id, city.currentProduction ?? null])
      ),
      research: game.researchManager.getPlayerResearch(playerId)?.currentTech ?? null,
    };
  }

  private outcome(
    before: ReturnType<FreecivAIOrchestrator['traceSnapshot']>,
    after: ReturnType<FreecivAIOrchestrator['traceSnapshot']>,
    reportedActions: number
  ) {
    const union = new Set([
      ...Object.keys(before.unitPositions),
      ...Object.keys(after.unitPositions),
    ]);
    const taskUnion = new Set([
      ...Object.keys(before.taskSignatures),
      ...Object.keys(after.taskSignatures),
    ]);
    const productionUnion = new Set([
      ...Object.keys(before.cityProduction),
      ...Object.keys(after.cityProduction),
    ]);
    const unitsMoved = [...union].filter(
      unitId => before.unitPositions[unitId] !== after.unitPositions[unitId]
    ).length;
    const taskChanges = [...taskUnion].filter(
      unitId => before.taskSignatures[unitId] !== after.taskSignatures[unitId]
    ).length;
    const productionChanges = [...productionUnion].filter(
      cityId => before.cityProduction[cityId] !== after.cityProduction[cityId]
    ).length;
    const citiesDelta = after.input.cities - before.input.cities;
    const unitsDelta = after.input.units - before.input.units;
    const tasksDelta = after.input.tasks - before.input.tasks;
    const researchChanged = before.research !== after.research;
    return {
      reportedActions,
      citiesDelta,
      unitsDelta,
      tasksDelta,
      taskChanges,
      unitsMoved,
      productionChanges,
      researchChanged,
      noOp:
        reportedActions === 0 &&
        citiesDelta === 0 &&
        unitsDelta === 0 &&
        tasksDelta === 0 &&
        taskChanges === 0 &&
        unitsMoved === 0 &&
        productionChanges === 0 &&
        !researchChanged,
    };
  }

  private economicDelta(
    before: ReturnType<FreecivAIOrchestrator['traceSnapshot']>['economy'],
    after: ReturnType<FreecivAIOrchestrator['traceSnapshot']>['economy']
  ) {
    return {
      population: after.population - before.population,
      food: after.food - before.food,
      production: after.production - before.production,
      trade: after.trade - before.trade,
      science: after.science - before.science,
    };
  }

  private candidateScores(state: FreecivAIState) {
    return {
      cityProduction: Object.fromEntries(
        Object.entries(state.cityWants)
          .sort(([left], [right]) => left.localeCompare(right))
          .slice(0, 100)
          .map(([cityId, scores]) => [
            cityId,
            Object.fromEntries(
              Object.entries(scores)
                .sort(([, left], [, right]) => right - left)
                .slice(0, 12)
                .sort(([left], [right]) => left.localeCompare(right))
            ),
          ])
      ),
      research: Object.fromEntries(
        Object.entries(state.techWants)
          .sort(([, left], [, right]) => right - left)
          .slice(0, 30)
          .sort(([left], [right]) => left.localeCompare(right))
      ),
    };
  }

  private unitTasks(state: FreecivAIState) {
    return Object.fromEntries(
      Object.entries(state.unitTasks)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, 200)
        .map(([unitId, task]) => [unitId, { ...task }])
    );
  }

  private selectedActions(game: GameInstance, playerId: string) {
    return {
      cityProduction: Object.fromEntries(
        game.cityManager
          .getPlayerCities(playerId)
          .sort((left, right) => left.id.localeCompare(right.id))
          .map(city => [city.id, city.currentProduction ?? null])
      ),
      research: game.researchManager.getPlayerResearch(playerId)?.currentTech ?? null,
    };
  }

  private recordDecision(
    state: FreecivAIState,
    entry: NonNullable<FreecivAIState['recentDecisionTrace']>[number]
  ): void {
    state.recentDecisionTrace = [...(state.recentDecisionTrace ?? []), entry].slice(-50);
  }

  private diagnosticsDelta(
    before: PathfindingDiagnostics | undefined,
    after: PathfindingDiagnostics | undefined
  ): PathfindingDiagnostics {
    const empty: PathfindingDiagnostics = {
      pathRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      searches: 0,
      expandedNodes: 0,
      budgetExhaustions: 0,
      accessibleSearches: 0,
    };
    if (!before || !after) return empty;
    return {
      pathRequests: after.pathRequests - before.pathRequests,
      cacheHits: after.cacheHits - before.cacheHits,
      cacheMisses: after.cacheMisses - before.cacheMisses,
      searches: after.searches - before.searches,
      expandedNodes: after.expandedNodes - before.expandedNodes,
      budgetExhaustions: after.budgetExhaustions - before.budgetExhaustions,
      accessibleSearches: after.accessibleSearches - before.accessibleSearches,
    };
  }
}
