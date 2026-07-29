import type { DatabaseProvider } from '@database';
import { FreecivAIPlayerController } from '@game/ai/AIPlayerController';
import {
  assertAIState,
  FreecivAIStateStore,
  type AIDiplomacyMemory,
  type FreecivAIState,
} from '@game/ai/AIStateStore';
import type { DiplomacyEvent, DiplomacyManager } from '@game/managers/DiplomacyManager';
import type { GameInstance } from '@game/managers/GameManager';
import type { UnitLifecycleEvent } from '@game/managers/UnitManager';
import { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';
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
      const playerActions = await this.playerController.processPlayer(
        gameId,
        game,
        player.id,
        state,
        (label, decision) => this.attempt(state, game.currentTurn ?? 0, label, decision)
      );
      actions += playerActions;
      state.lastProcessedTurn = game.currentTurn;
      state.lastDecisionCount = playerActions;
      delete state.inProgressTurn;
      player.aiState = state as unknown as Record<string, unknown>;
      await this.attempt(state, game.currentTurn ?? 0, 'state persistence', async () => {
        await this.stateStore.save(gameId, player.id, state);
        return 0;
      });
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
    turn: number,
    label: string,
    decision: () => Promise<number>
  ): Promise<number> {
    try {
      const actions = await decision();
      this.recordDecision(state, { turn, label, actions });
      return actions;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordDecision(state, { turn, label, actions: 0, error: message });
      logger.warn('CivJS AI decision failed', {
        decision: label,
        error: message,
      });
      return 0;
    }
  }

  private recordDecision(state: FreecivAIState, entry: NonNullable<FreecivAIState['recentDecisionTrace']>[number]): void {
    state.recentDecisionTrace = [...(state.recentDecisionTrace ?? []), entry].slice(-50);
  }
}
