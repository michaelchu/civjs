import type { DatabaseProvider } from '@database';
import { FreecivAIPlayerController } from '@game/ai/FreecivAIPlayerController';
import {
  assertAIState,
  FreecivAIStateStore,
  type FreecivAIState,
} from '@game/ai/FreecivAIStateStore';
import type { DiplomacyManager } from '@game/managers/DiplomacyManager';
import type { GameInstance } from '@game/managers/GameManager';
import type { Unit } from '@game/managers/UnitManager';
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
      game.visibilityManager.updatePlayerVisibility(player.id);
      const playerActions = await this.playerController.processPlayer(
        gameId,
        game,
        player.id,
        state,
        (label, decision) => this.attempt(label, decision)
      );
      actions += playerActions;
      state.lastProcessedTurn = game.currentTurn;
      state.lastDecisionCount = playerActions;
      player.aiState = state as unknown as Record<string, unknown>;
      await this.attempt('state persistence', async () => {
        await this.stateStore.save(gameId, player.id, state);
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
    this.mutateAllAIStates(gameId, game, state => {
      delete state.unitTasks[unit.id];
      for (const [unitId, task] of Object.entries(state.unitTasks)) {
        if (task.targetId === unit.id) delete state.unitTasks[unitId];
      }
    });
  }

  /**
   * City removal/capture invalidates production wants and guard charges
   * immediately. Capture clears references for every AI because ownership and
   * diplomatic legality may have changed for both sides.
   */
  onCityInvalidated(gameId: string, game: GameInstance, cityId: string): void {
    this.mutateAllAIStates(gameId, game, state => {
      delete state.cityWants[cityId];
      for (const [unitId, task] of Object.entries(state.unitTasks)) {
        if (task.targetId === cityId) delete state.unitTasks[unitId];
      }
    });
  }

  private mutateAllAIStates(
    gameId: string,
    game: GameInstance,
    mutate: (state: FreecivAIState) => void
  ): void {
    for (const player of game.players.values()) {
      if (!player.isAI) continue;
      const state = assertAIState(player.aiState);
      mutate(state);
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
}
