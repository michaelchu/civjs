import { createAIProfile } from '@game/ai/FreecivAIProfile';
import type { FreecivAIState } from '@game/ai/FreecivAIStateStore';
import type { DiplomacyManager, TreatyClause } from '@game/managers/DiplomacyManager';
import type { GameInstance } from '@game/managers/GameManager';

/**
 * Applies Freeciv diplomacy memory and treaty decisions through the
 * authoritative diplomacy manager.
 */
export class FreecivAIDiplomacyController {
  constructor(private readonly diplomacyManager: DiplomacyManager) {}

  async processPlayer(
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

      // Freeciv keeps diplomatic memory current in away mode, but refuses
      // treaties until normal AI control resumes.
      // @reference reference/freeciv/ai/default/daidiplomacy.c:375-385
      if (profile.handicaps.has('away')) continue;

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
