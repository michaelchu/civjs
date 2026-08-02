/**
 * @module server/game/ai/AIDiplomacyController
 * Implements AIDiplomacy Controller decision logic for AI-controlled players.
 */
import { createAIProfile } from '@game/ai/AIProfile';
import type { AIDiplomacyMemory, FreecivAIState } from '@game/ai/AIStateStore';
import type {
  DiplomacyManager,
  DiplomacySnapshot,
  TreatyClause,
} from '@game/managers/DiplomacyManager';
import type { GameInstance } from '@game/runtime/GameTypes';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import {
  calculateWarDesire,
  evaluateTreaty,
  type TreatyValuationContext,
} from '@game/ai/AIDiplomacyPlanner';
import {
  isSpaceshipOptimal,
  normalizeSpaceshipState,
  spaceshipProgress,
} from '@game/services/SpaceshipService';

function researchedTechnologies(game: GameInstance, playerId: string): Set<string> {
  return new Set(
    game.researchManager.getResearchedTechs?.(playerId) ??
      game.researchManager.getPlayerResearch(playerId)?.researchedTechs ??
      []
  );
}

function calculateLove(
  memory: AIDiplomacyMemory,
  nation: DiplomacySnapshot['nations'][number]
): number {
  return Math.max(
    -1000,
    Math.min(
      1000,
      Math.round(
        memory.love * 0.8 +
          (nation.relation.attitude ?? 0) +
          ((nation.relation.reputation ?? 1000) - 500) / 10 -
          (nation.relation.hasReasonToCancel > 0 ? 100 : 0)
      )
    )
  );
}

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
    const ownCities = game.cityManager.getPlayerCities(playerId);
    const ownUnits = game.unitManager.getPlayerUnits(playerId);
    const ownTechs = researchedTechnologies(game, playerId);
    const catalogue = new Map(
      (
        game.researchManager.getTechnologyCatalogue?.(playerId) ??
        game.researchManager.getAvailableTechnologies(playerId)
      ).map(technology => [technology.id, technology])
    );
    const spaceRaceEnabled = (game.config?.victoryConditions ?? []).some(condition =>
      ['science', 'spaceship'].includes(condition)
    );
    const spaceshipByPlayer = new Map(
      [...game.players.keys()].map(candidateId => {
        const counts = normalizeSpaceshipState(game.players.get(candidateId)?.spaceshipState);
        return [candidateId, { counts, progress: spaceshipProgress(counts) }] as const;
      })
    );
    const spaceLeaderId = spaceRaceEnabled
      ? [...spaceshipByPlayer.entries()].sort(
          ([leftId, left], [rightId, right]) =>
            right.progress - left.progress || leftId.localeCompare(rightId)
        )[0]?.[0]
      : undefined;
    let actions = 0;
    const contacted = new Set<string>();
    for (const nation of snapshot.nations.slice().sort((a, b) => a.id.localeCompare(b.id))) {
      const otherCities = game.cityManager.getPlayerCities(nation.id);
      const otherUnits = game.unitManager.getPlayerUnits(nation.id);
      const otherTechs = researchedTechnologies(game, nation.id);
      const memory = this.updateDiplomacyMemory({
        memory: state.diplomacy[nation.id],
        nation,
        game,
        playerId,
        ownCities,
        ownUnits,
        ownTechs,
        otherCities,
        otherUnits,
        otherTechs,
        aggressiveTrait: profile.traits.aggressive,
        diplomacyHandicap: profile.handicaps.has('diplomacy'),
        spaceRaceEnabled,
        spaceLeaderId,
        spaceshipByPlayer,
      });
      state.diplomacy[nation.id] = memory;

      const madeContact = await this.processNationTreaty({
        gameId,
        game,
        playerId,
        state,
        snapshot,
        nation,
        memory,
        ownCities,
        otherCities,
        ownTechs,
        otherTechs,
        catalogue,
        handicaps: profile.handicaps,
      });
      if (madeContact) {
        contacted.add(nation.id);
        actions++;
      }
    }

    actions += await this.processWarCountdown({
      gameId,
      playerId,
      state,
      snapshot,
      contacted,
      away: profile.handicaps.has('away'),
      defensive: profile.handicaps.has('defensive'),
    });
    return actions;
  }

  private updateDiplomacyMemory(options: {
    memory?: AIDiplomacyMemory;
    nation: DiplomacySnapshot['nations'][number];
    game: GameInstance;
    playerId: string;
    ownCities: ReturnType<GameInstance['cityManager']['getPlayerCities']>;
    ownUnits: ReturnType<GameInstance['unitManager']['getPlayerUnits']>;
    ownTechs: ReadonlySet<string>;
    otherCities: ReturnType<GameInstance['cityManager']['getPlayerCities']>;
    otherUnits: ReturnType<GameInstance['unitManager']['getPlayerUnits']>;
    otherTechs: ReadonlySet<string>;
    aggressiveTrait: number;
    diplomacyHandicap: boolean;
    spaceRaceEnabled: boolean;
    spaceLeaderId?: string;
    spaceshipByPlayer: Map<
      string,
      {
        counts: ReturnType<typeof normalizeSpaceshipState>;
        progress: number;
      }
    >;
  }): AIDiplomacyMemory {
    const {
      nation,
      game,
      playerId,
      ownCities,
      ownUnits,
      ownTechs,
      otherCities,
      otherUnits,
      otherTechs,
      aggressiveTrait,
      diplomacyHandicap,
      spaceRaceEnabled,
      spaceLeaderId,
      spaceshipByPlayer,
    } = options;
    const memory = options.memory ?? { love: 0, warDesire: 0, countdown: 0 };
    const distance = Math.min(
      30,
      ...ownCities.flatMap(own =>
        otherCities.map(other => game.mapManager.getDistance(own.x, own.y, other.x, other.y))
      )
    );
    memory.love = calculateLove(memory, nation);
    const targetSpaceship = spaceshipByPlayer.get(nation.id);
    const pursuingSpaceVictory = this.isPursuingSpaceVictory(
      spaceRaceEnabled,
      spaceLeaderId,
      playerId,
      spaceshipByPlayer
    );
    const targetSpaceshipLaunched = this.isSpaceshipLaunched(targetSpaceship);
    const assessedWarDesire = calculateWarDesire({
      ownCities,
      targetCities: otherCities,
      ownUnits,
      targetUnits: otherUnits,
      unitTypes: game.unitManager.getUnitTypes?.() ?? UNIT_TYPES,
      ownTechCount: ownTechs.size,
      targetTechCount: otherTechs.size,
      targetGold: game.players.get(nation.id)?.gold ?? 0,
      distance: Number.isFinite(distance) ? distance : 30,
      love: memory.love,
      relation: nation.relation,
      aggressiveTrait,
      diplomacyHandicap,
      targetIsHuman: !nation.isAI,
      pursuingSpaceVictory,
      targetSpaceshipProgress: targetSpaceship?.progress ?? 0,
      targetSpaceshipLaunched,
    });
    memory.warDesire = Math.max(
      -1000,
      Math.min(1000, Math.round(memory.warDesire * 0.5 + assessedWarDesire))
    );
    memory.countdown = Math.max(0, memory.countdown - 1);
    return memory;
  }

  private isPursuingSpaceVictory(
    enabled: boolean,
    leaderId: string | undefined,
    playerId: string,
    ships: Map<string, any>
  ): boolean {
    return enabled && leaderId === playerId && (ships.get(playerId)?.progress ?? 0) > 0;
  }

  private isSpaceshipLaunched(target: any): boolean {
    if (target?.counts.launchedTurn !== undefined) return true;
    return isSpaceshipOptimal(target?.counts ?? { structurals: 0, components: 0, modules: 0 });
  }

  private async processNationTreaty(options: {
    gameId: string;
    game: GameInstance;
    playerId: string;
    state: FreecivAIState;
    snapshot: DiplomacySnapshot;
    nation: DiplomacySnapshot['nations'][number];
    memory: AIDiplomacyMemory;
    ownCities: TreatyValuationContext['ownCities'];
    otherCities: TreatyValuationContext['otherCities'];
    ownTechs: ReadonlySet<string>;
    otherTechs: ReadonlySet<string>;
    catalogue: TreatyValuationContext['catalogue'];
    handicaps: ReadonlySet<string>;
  }): Promise<boolean> {
    const {
      gameId,
      game,
      playerId,
      state,
      snapshot,
      nation,
      memory,
      ownCities,
      otherCities,
      ownTechs,
      otherTechs,
      catalogue,
      handicaps,
    } = options;
    // Freeciv keeps diplomatic memory current in away mode, but refuses
    // treaties until normal AI control resumes.
    // @reference reference/freeciv/ai/default/daidiplomacy.c:375-385
    if (handicaps.has('away')) return false;

    const proposal = nation.relation.proposal;
    const otherSnapshot = await this.diplomacyManager.getSnapshot(gameId, nation.id);
    const ourRelations = new Map(
      snapshot.nations.map(candidate => [candidate.id, candidate.relation])
    );
    const alliedWithEnemy = otherSnapshot.nations.some(
      candidate =>
        candidate.id !== playerId &&
        ['alliance', 'team'].includes(candidate.relation.state) &&
        ourRelations.get(candidate.id)?.state === 'war'
    );
    const sharedVisionSafe = !otherSnapshot.nations.some(candidate => {
      if (!candidate.relation.givesSharedVision || candidate.id === playerId) return false;
      const stateWithRecipient = ourRelations.get(candidate.id)?.state ?? 'no_contact';
      return !['no_contact', 'alliance', 'team'].includes(stateWithRecipient);
    });
    const context = this.treatyContext({
      playerId,
      otherPlayerId: nation.id,
      game,
      state,
      love: memory.love,
      relation: nation.relation,
      ownCities,
      otherCities,
      ownTechs,
      otherTechs,
      catalogue,
      diplomacyHandicap: handicaps.has('diplomacy'),
      alliedWithEnemy,
      sharedVisionSafe,
    });
    if (proposal?.status === 'pending' && proposal.recipientId === playerId) {
      const accepted = evaluateTreaty(proposal.clauses, context).acceptable;
      await this.diplomacyManager.respondToTreaty(
        gameId,
        playerId,
        nation.id,
        proposal.id,
        accepted
      );
      memory.countdown = 3;
      return true;
    }
    if (
      proposal?.status === 'pending' ||
      memory.countdown > 0 ||
      !nation.known ||
      !nation.canMeet ||
      typeof this.diplomacyManager.proposeTreaty !== 'function'
    ) {
      return false;
    }
    const clauses =
      this.chooseProactiveTreaty(nation.relation.state, memory.love, handicaps) ??
      this.chooseTechnologyExchange(playerId, nation.id, ownTechs, otherTechs, context);
    if (!clauses) return false;
    await this.diplomacyManager.proposeTreaty(
      gameId,
      playerId,
      nation.id,
      clauses,
      `ai:${game.currentTurn}:${playerId}:${nation.id}:${clauses[0].type}`
    );
    memory.lastContactTurn = game.currentTurn;
    memory.countdown = 5;
    return true;
  }

  private async processWarCountdown(options: {
    gameId: string;
    playerId: string;
    state: FreecivAIState;
    snapshot: DiplomacySnapshot;
    contacted: ReadonlySet<string>;
    away: boolean;
    defensive: boolean;
  }): Promise<number> {
    const { gameId, playerId, state, snapshot, contacted, away, defensive } = options;
    const warTarget = snapshot.nations
      .filter(
        nation =>
          nation.known &&
          nation.canMeet &&
          !['war', 'team', 'no_contact'].includes(nation.relation.state) &&
          !contacted.has(nation.id) &&
          nation.relation.proposal?.status !== 'pending'
      )
      .map(nation => ({ nation, memory: state.diplomacy[nation.id] }))
      .filter(
        (
          candidate
        ): candidate is {
          nation: (typeof snapshot.nations)[number];
          memory: NonNullable<(typeof state.diplomacy)[string]>;
        } => Boolean(candidate.memory)
      )
      .sort(
        (left, right) =>
          right.memory.warDesire - left.memory.warDesire ||
          left.nation.id.localeCompare(right.nation.id)
      )[0];
    for (const [otherId, memory] of Object.entries(state.diplomacy)) {
      if (otherId !== warTarget?.nation.id) delete memory.warCountdown;
    }
    if (warTarget && warTarget.memory.warDesire >= 250 && !away && !defensive) {
      if (warTarget.memory.warCountdown === undefined) {
        warTarget.memory.warCountdown = 3;
      } else if (warTarget.memory.warCountdown > 0) {
        warTarget.memory.warCountdown--;
      } else if (typeof this.diplomacyManager.declareWar === 'function') {
        await this.diplomacyManager.declareWar(gameId, playerId, warTarget.nation.id);
        delete warTarget.memory.warCountdown;
        return 1;
      }
    } else if (warTarget) {
      delete warTarget.memory.warCountdown;
    }
    return 0;
  }

  private treatyContext(options: {
    playerId: string;
    otherPlayerId: string;
    game: GameInstance;
    state: FreecivAIState;
    love: number;
    relation: TreatyValuationContext['relation'];
    ownCities: TreatyValuationContext['ownCities'];
    otherCities: TreatyValuationContext['otherCities'];
    ownTechs: ReadonlySet<string>;
    otherTechs: ReadonlySet<string>;
    catalogue: TreatyValuationContext['catalogue'];
    diplomacyHandicap: boolean;
    alliedWithEnemy: boolean;
    sharedVisionSafe: boolean;
  }): TreatyValuationContext {
    return {
      playerId: options.playerId,
      otherPlayerId: options.otherPlayerId,
      currentState: options.relation.state,
      relation: options.relation,
      love: options.love,
      turn: options.game.currentTurn ?? 1,
      ownCities: options.ownCities,
      otherCities: options.otherCities,
      ownTechs: options.ownTechs,
      otherTechs: options.otherTechs,
      catalogue: options.catalogue,
      techWants: options.state.techWants,
      diplomacyHandicap: options.diplomacyHandicap,
      sharedVisionSafe: options.sharedVisionSafe,
      alliedWithEnemy: options.alliedWithEnemy,
    };
  }

  private chooseTechnologyExchange(
    playerId: string,
    otherPlayerId: string,
    ownTechs: ReadonlySet<string>,
    otherTechs: ReadonlySet<string>,
    context: TreatyValuationContext
  ): TreatyClause[] | undefined {
    if (!['peace', 'alliance'].includes(context.currentState)) return undefined;
    const wanted = [...otherTechs]
      .filter(techId => !ownTechs.has(techId) && context.catalogue.has(techId))
      .sort(
        (left, right) =>
          (context.techWants[right] ?? 0) - (context.techWants[left] ?? 0) ||
          left.localeCompare(right)
      );
    const offered = [...ownTechs]
      .filter(techId => !otherTechs.has(techId) && context.catalogue.has(techId))
      .sort((left, right) => left.localeCompare(right));
    let best:
      | {
          clauses: TreatyClause[];
          balance: number;
        }
      | undefined;
    for (const receiveTech of wanted) {
      for (const giveTech of offered) {
        const clauses: TreatyClause[] = [
          { type: 'technology', techId: receiveTech, giverId: otherPlayerId },
          { type: 'technology', techId: giveTech, giverId: playerId },
        ];
        const valuation = evaluateTreaty(clauses, context);
        if (!valuation.acceptable) continue;
        if (!best || valuation.balance < best.balance) {
          best = { clauses, balance: valuation.balance };
        }
      }
    }
    return best?.clauses;
  }

  private chooseProactiveTreaty(
    currentState: string,
    love: number,
    handicaps: ReadonlySet<string>
  ): TreatyClause[] | undefined {
    if (currentState === 'war' && (love >= -50 || handicaps.has('ceasefire'))) {
      return [{ type: 'ceasefire' }];
    }
    // Armistice is the manager's internal transition state after a peace
    // proposal; proposing peace again is invalid until it settles.
    if (currentState === 'ceasefire' && love >= 10) {
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
