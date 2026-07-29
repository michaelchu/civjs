import { and, eq } from 'drizzle-orm';
import type { DatabaseProvider } from '@database';
import { players } from '@database/schema';
import { EffectsManager, EffectType, type EffectContext } from '@game/managers/EffectsManager';
import { rulesetLoader, type RulesetLoader } from '@shared/data/rulesets/RulesetLoader';

export type DiplomaticState =
  | 'no_contact'
  | 'war'
  | 'ceasefire'
  | 'armistice'
  | 'peace'
  | 'alliance'
  | 'team';

export type TreatyClauseType =
  | 'ceasefire'
  | 'peace'
  | 'alliance'
  | 'embassy'
  | 'shared_vision'
  | 'technology'
  | 'gold'
  | 'map'
  | 'seamap'
  | 'city';

type TreatyClauseBase = { giverId?: string };

export type TreatyClause =
  | (TreatyClauseBase & {
      type: 'ceasefire' | 'peace' | 'alliance' | 'embassy' | 'shared_vision' | 'map' | 'seamap';
    })
  | (TreatyClauseBase & { type: 'technology'; techId: string })
  | (TreatyClauseBase & { type: 'gold'; amount: number })
  | (TreatyClauseBase & { type: 'city'; cityId: string });

export interface TreatyProposal {
  id: string;
  requestId?: string;
  proposerId: string;
  recipientId: string;
  clauses: TreatyClause[];
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  createdAt: string;
  resolvedAt?: string;
}

export interface DiplomaticRelation {
  state: DiplomaticState;
  maxState: DiplomaticState;
  sinceTurn: number;
  turnsLeft: number;
  contactTurnsLeft: number;
  hasReasonToCancel: number;
  embassy: boolean;
  sharedVision: boolean;
  givesSharedVision?: boolean;
  reputation: number;
  attitude: number;
  proposal?: TreatyProposal;
}

interface DiplomacyPlayerRow {
  id: string;
  gameId: string;
  playerNumber: number;
  civilization: string;
  nation: string;
  leaderName: string;
  government: string;
  isAlive: boolean;
  isAI: boolean;
  teamId?: string | null;
  knownPlayers: unknown;
  diplomaticRelations: unknown;
}

export interface DiplomacySnapshot {
  playerId: string;
  nations: Array<{
    id: string;
    civilization: string;
    leaderName: string;
    isAlive: boolean;
    isAI: boolean;
    known: boolean;
    canMeet: boolean;
    relation: DiplomaticRelation;
  }>;
}

export interface DiplomacyEvent {
  type:
    | 'first_contact'
    | 'proposal'
    | 'accepted'
    | 'rejected'
    | 'cancelled'
    | 'ceasefire_expired'
    | 'armistice_completed'
    | 'war_declared'
    | 'vision_cancelled'
    | 'incident';
  gameId: string;
  playerIds: [string, string];
  message: string;
  offenderId?: string;
  victimId?: string;
  severity?: number;
  justified?: boolean;
}

const TREATY_TURNS = 16;
const CONTACT_TURNS = 20;
const STATE_RANK: Record<DiplomaticState, number> = {
  no_contact: 0,
  war: 1,
  ceasefire: 2,
  armistice: 3,
  peace: 4,
  alliance: 5,
  team: 6,
};

/**
 * Persisted, bilateral diplomacy state.
 * @reference reference/freeciv/common/player.h enum diplstate_type
 * @reference reference/freeciv/server/diplhand.c treaty handling
 */
export class DiplomacyManager {
  private readonly pairLocks = new Map<string, Promise<unknown>>();
  private eventSink?: (event: DiplomacyEvent) => void | Promise<void>;
  private transferExecutor?: (
    gameId: string,
    proposerId: string,
    recipientId: string,
    clauses: TreatyClause[]
  ) => Promise<void | (() => Promise<void>)>;

  constructor(
    private readonly databaseProvider: DatabaseProvider,
    private readonly currentTurnProvider: (gameId: string) => number = () => 0,
    private readonly playerBuildingProvider: (
      gameId: string,
      playerId: string
    ) => Set<string> = () => new Set(),
    private readonly effectsManager: EffectsManager = new EffectsManager(),
    private readonly ruleset: Pick<RulesetLoader, 'getNation'> = rulesetLoader
  ) {}

  setTransferExecutor(
    executor: (
      gameId: string,
      proposerId: string,
      recipientId: string,
      clauses: TreatyClause[]
    ) => Promise<void | (() => Promise<void>)>
  ): void {
    this.transferExecutor = executor;
  }

  setEventSink(sink: (event: DiplomacyEvent) => void | Promise<void>): void {
    this.eventSink = sink;
  }

  async getSnapshot(gameId: string, playerId: string): Promise<DiplomacySnapshot> {
    const db = this.databaseProvider.getDatabase();
    const gamePlayers = (await db.query.players.findMany({
      where: eq(players.gameId, gameId),
    })) as DiplomacyPlayerRow[];
    const player = gamePlayers.find(candidate => candidate.id === playerId);
    if (!player) throw new Error('Player not found in game');

    const knownPlayers = this.readKnownPlayers(player);
    const relations = this.readRelations(player);
    return {
      playerId,
      nations: gamePlayers
        .filter(candidate => candidate.id !== playerId)
        .sort((a, b) => a.playerNumber - b.playerNumber)
        .map(candidate => {
          const relation = this.normalizeRelation(
            relations[candidate.id],
            this.areTeammates(player, candidate)
          );
          const reverseRelation = this.normalizeRelation(
            this.readRelations(candidate)[player.id],
            this.areTeammates(player, candidate)
          );
          const known = knownPlayers.has(candidate.id) || relation.state === 'team';
          return {
            id: candidate.id,
            civilization: known ? candidate.civilization : 'unknown',
            leaderName: known ? candidate.leaderName : 'Unknown leader',
            isAlive: known ? candidate.isAlive : true,
            isAI: known ? candidate.isAI : false,
            known,
            canMeet: known && this.canMeet(relation, reverseRelation),
            relation: { ...relation, givesSharedVision: reverseRelation.sharedVision },
          };
        }),
    };
  }

  async getDiplomaticState(
    gameId: string,
    playerId: string,
    otherPlayerId: string
  ): Promise<DiplomaticState> {
    const [player, other] = await this.loadPairIncludingEliminated(gameId, playerId, otherPlayerId);
    if (this.areTeammates(player, other)) return 'team';
    return this.getRelation(player, otherPlayerId).state;
  }

  async processTurn(gameId: string): Promise<DiplomacyEvent[]> {
    const db = this.databaseProvider.getDatabase();
    const gamePlayers = (await db.query.players.findMany({
      where: eq(players.gameId, gameId),
    })) as DiplomacyPlayerRow[];
    const alive = gamePlayers.filter(player => player.isAlive);
    const events: DiplomacyEvent[] = [];
    for (let firstIndex = 0; firstIndex < alive.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < alive.length; secondIndex += 1) {
        const first = alive[firstIndex]!;
        const second = alive[secondIndex]!;
        await this.withPairLock(gameId, first.id, second.id, async () => {
          const [currentFirst, currentSecond] = await this.loadPairIncludingEliminated(
            gameId,
            first.id,
            second.id
          );
          let event: DiplomacyEvent | undefined;
          await this.persistPair(currentFirst, currentSecond, (firstRelation, secondRelation) => {
            if (this.areTeammates(currentFirst, currentSecond)) {
              return [
                this.normalizeRelation(firstRelation, true),
                this.normalizeRelation(secondRelation, true),
              ];
            }
            const nextFirst = {
              ...firstRelation,
              contactTurnsLeft: Math.max(0, firstRelation.contactTurnsLeft - 1),
              hasReasonToCancel: Math.max(0, firstRelation.hasReasonToCancel - 1),
            };
            const nextSecond = {
              ...secondRelation,
              contactTurnsLeft: Math.max(0, secondRelation.contactTurnsLeft - 1),
              hasReasonToCancel: Math.max(0, secondRelation.hasReasonToCancel - 1),
            };
            if (firstRelation.state !== 'ceasefire' && firstRelation.state !== 'armistice') {
              return [nextFirst, nextSecond];
            }
            const turnsLeft = Math.max(0, firstRelation.turnsLeft - 1);
            const state: DiplomaticState =
              turnsLeft === 0
                ? firstRelation.state === 'ceasefire'
                  ? 'war'
                  : 'peace'
                : firstRelation.state;
            if (turnsLeft === 0) {
              event = {
                type:
                  firstRelation.state === 'ceasefire' ? 'ceasefire_expired' : 'armistice_completed',
                gameId,
                playerIds: [first.id, second.id],
                message:
                  firstRelation.state === 'ceasefire'
                    ? `The ceasefire between ${first.leaderName} and ${second.leaderName} expired.`
                    : `The armistice between ${first.leaderName} and ${second.leaderName} became peace.`,
              };
            }
            return [
              {
                ...nextFirst,
                state,
                sinceTurn: turnsLeft === 0 ? this.currentTurnProvider(gameId) : nextFirst.sinceTurn,
                turnsLeft,
                sharedVision: state === 'war' ? false : nextFirst.sharedVision,
              },
              {
                ...nextSecond,
                state,
                sinceTurn:
                  turnsLeft === 0 ? this.currentTurnProvider(gameId) : nextSecond.sinceTurn,
                turnsLeft,
                sharedVision: state === 'war' ? false : nextSecond.sharedVision,
              },
            ];
          });
          if (event) {
            events.push(event);
            await this.emitEvent(event);
          }
        });
      }
    }
    return events;
  }

  async establishContact(gameId: string, playerId: string, otherPlayerId: string): Promise<void> {
    return this.withPairLock(gameId, playerId, otherPlayerId, () =>
      this.establishContactLocked(gameId, playerId, otherPlayerId)
    );
  }

  private async establishContactLocked(
    gameId: string,
    playerId: string,
    otherPlayerId: string
  ): Promise<void> {
    const [player, other] = await this.loadPair(gameId, playerId, otherPlayerId);
    const wasKnown =
      this.readKnownPlayers(player).has(other.id) && this.readKnownPlayers(other).has(player.id);
    await this.persistPair(player, other, (firstRelation, secondRelation) => [
      {
        ...firstRelation,
        state: firstRelation.state === 'no_contact' ? 'war' : firstRelation.state,
        maxState:
          firstRelation.state === 'no_contact'
            ? this.maxState(firstRelation.maxState, 'war')
            : firstRelation.maxState,
        contactTurnsLeft: CONTACT_TURNS,
      },
      {
        ...secondRelation,
        state: secondRelation.state === 'no_contact' ? 'war' : secondRelation.state,
        maxState:
          secondRelation.state === 'no_contact'
            ? this.maxState(secondRelation.maxState, 'war')
            : secondRelation.maxState,
        contactTurnsLeft: CONTACT_TURNS,
      },
    ]);
    if (!wasKnown) {
      await this.emitEvent({
        type: 'first_contact',
        gameId,
        playerIds: [player.id, other.id],
        message: `${player.leaderName} and ${other.leaderName} have made first contact.`,
      });
    }
  }

  async proposeTreaty(
    gameId: string,
    proposerId: string,
    recipientId: string,
    clauses: TreatyClause[],
    requestId?: string
  ): Promise<TreatyProposal> {
    return this.withPairLock(gameId, proposerId, recipientId, () =>
      this.proposeTreatyLocked(gameId, proposerId, recipientId, clauses, requestId)
    );
  }

  private async proposeTreatyLocked(
    gameId: string,
    proposerId: string,
    recipientId: string,
    clauses: TreatyClause[],
    requestId?: string
  ): Promise<TreatyProposal> {
    const [proposer, recipient] = await this.loadPair(gameId, proposerId, recipientId);
    this.assertDiplomacyAllowed(gameId, proposer, recipient);
    const proposerRelation = this.getRelation(proposer, recipientId);
    if (this.areTeammates(proposer, recipient) || proposerRelation.state === 'team') {
      throw new Error('Teammates cannot negotiate separate treaties');
    }
    if (!this.canMeet(proposerRelation, this.getRelation(recipient, proposerId))) {
      throw new Error('Diplomatic contact or an embassy is required');
    }
    const normalizedClauses = clauses.map(clause => ({
      ...clause,
      giverId: clause.giverId ?? proposerId,
    })) as TreatyClause[];
    this.validateClauses(normalizedClauses, proposerId, recipientId, proposerRelation.state);
    if (normalizedClauses.some(clause => clause.type === 'alliance')) {
      await this.assertAllianceCompatible(gameId, proposer, recipient);
    }

    if (
      requestId &&
      proposerRelation.proposal?.requestId === requestId &&
      proposerRelation.proposal.proposerId === proposerId
    ) {
      return proposerRelation.proposal;
    }
    if (proposerRelation.proposal?.status === 'pending') {
      throw new Error('A diplomatic meeting is already pending');
    }

    const proposal: TreatyProposal = {
      id: `treaty_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      requestId,
      proposerId,
      recipientId,
      clauses: normalizedClauses,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await this.persistPair(proposer, recipient, (firstRelation, secondRelation) => [
      { ...firstRelation, proposal },
      { ...secondRelation, proposal },
    ]);
    await this.emitEvent({
      type: 'proposal',
      gameId,
      playerIds: [proposerId, recipientId],
      message: `${proposer.leaderName} proposed a treaty to ${recipient.leaderName}.`,
    });
    return proposal;
  }

  async respondToTreaty(
    gameId: string,
    playerId: string,
    otherPlayerId: string,
    proposalId: string,
    accept: boolean
  ): Promise<TreatyProposal> {
    return this.withPairLock(gameId, playerId, otherPlayerId, () =>
      this.respondToTreatyLocked(gameId, playerId, otherPlayerId, proposalId, accept)
    );
  }

  private async respondToTreatyLocked(
    gameId: string,
    playerId: string,
    otherPlayerId: string,
    proposalId: string,
    accept: boolean
  ): Promise<TreatyProposal> {
    const [player, other] = await this.loadPair(gameId, playerId, otherPlayerId);
    const relation = this.getRelation(player, otherPlayerId);
    const proposal = relation.proposal;
    if (!proposal || proposal.id !== proposalId) throw new Error('Treaty proposal not found');
    if (proposal.status !== 'pending') return proposal;
    if (proposal.recipientId !== playerId) {
      throw new Error('Only the treaty recipient can respond');
    }
    this.assertDiplomacyAllowed(gameId, player, other);
    if (accept) {
      this.validateClauses(
        proposal.clauses,
        proposal.proposerId,
        proposal.recipientId,
        relation.state
      );
    }

    const resolved: TreatyProposal = {
      ...proposal,
      status: accept ? 'accepted' : 'rejected',
      resolvedAt: new Date().toISOString(),
    };
    const transferClauses = proposal.clauses.filter(clause =>
      ['technology', 'gold', 'map', 'seamap', 'city'].includes(clause.type)
    );
    let rollbackTransfers: void | (() => Promise<void>) = undefined;
    if (accept && transferClauses.length > 0) {
      if (!this.transferExecutor) throw new Error('Treaty transfers are not configured');
      rollbackTransfers = await this.transferExecutor(
        gameId,
        proposal.proposerId,
        proposal.recipientId,
        transferClauses
      );
    }
    try {
      await this.persistPair(player, other, (firstRelation, secondRelation) =>
        accept
          ? this.applyClauses(
              player.id,
              { ...firstRelation, proposal: resolved },
              { ...secondRelation, proposal: resolved },
              proposal.clauses,
              this.currentTurnProvider(gameId)
            )
          : [
              { ...firstRelation, proposal: resolved },
              { ...secondRelation, proposal: resolved },
            ]
      );
    } catch (error) {
      await rollbackTransfers?.();
      throw error;
    }
    await this.emitEvent({
      type: accept ? 'accepted' : 'rejected',
      gameId,
      playerIds: [proposal.proposerId, proposal.recipientId],
      message: accept
        ? `${player.leaderName} accepted the treaty.`
        : `${player.leaderName} rejected the treaty.`,
    });
    return resolved;
  }

  async cancelTreaty(
    gameId: string,
    playerId: string,
    otherPlayerId: string,
    proposalId: string
  ): Promise<TreatyProposal> {
    return this.withPairLock(gameId, playerId, otherPlayerId, () =>
      this.cancelTreatyLocked(gameId, playerId, otherPlayerId, proposalId)
    );
  }

  private async cancelTreatyLocked(
    gameId: string,
    playerId: string,
    otherPlayerId: string,
    proposalId: string
  ): Promise<TreatyProposal> {
    const [player, other] = await this.loadPair(gameId, playerId, otherPlayerId);
    const proposal = this.getRelation(player, otherPlayerId).proposal;
    if (!proposal || proposal.id !== proposalId) throw new Error('Treaty proposal not found');
    if (proposal.status !== 'pending') return proposal;
    if (proposal.proposerId !== playerId) throw new Error('Only the proposer can cancel a treaty');

    const cancelled: TreatyProposal = {
      ...proposal,
      status: 'cancelled',
      resolvedAt: new Date().toISOString(),
    };
    await this.persistPair(player, other, (firstRelation, secondRelation) => [
      { ...firstRelation, proposal: cancelled },
      { ...secondRelation, proposal: cancelled },
    ]);
    await this.emitEvent({
      type: 'cancelled',
      gameId,
      playerIds: [player.id, other.id],
      message: `${player.leaderName} cancelled the treaty proposal.`,
    });
    return cancelled;
  }

  async declareWar(gameId: string, playerId: string, otherPlayerId: string): Promise<void> {
    return this.withPairLock(gameId, playerId, otherPlayerId, () =>
      this.declareWarLocked(gameId, playerId, otherPlayerId)
    );
  }

  async establishEmbassy(gameId: string, playerId: string, otherPlayerId: string): Promise<void> {
    return this.withPairLock(gameId, playerId, otherPlayerId, async () => {
      const [player, other] = await this.loadPair(gameId, playerId, otherPlayerId);
      this.assertDiplomacyAllowed(gameId, player, other);
      await this.persistPair(player, other, (firstRelation, secondRelation) => [
        { ...firstRelation, embassy: true, contactTurnsLeft: CONTACT_TURNS },
        { ...secondRelation, contactTurnsLeft: CONTACT_TURNS },
      ]);
    });
  }

  private async declareWarLocked(
    gameId: string,
    playerId: string,
    otherPlayerId: string
  ): Promise<void> {
    const [player, other] = await this.loadPair(gameId, playerId, otherPlayerId);
    const relation = this.getRelation(player, otherPlayerId);
    if (this.areTeammates(player, other) || relation.state === 'team') {
      throw new Error('Cannot declare war on a teammate');
    }
    if (!this.canMeet(relation, this.getRelation(other, playerId))) {
      throw new Error('First contact is required before declaring war');
    }
    if (relation.state === 'war') {
      if (relation.proposal?.status === 'pending') {
        const cancelled: TreatyProposal = {
          ...relation.proposal,
          status: 'cancelled',
          resolvedAt: new Date().toISOString(),
        };
        await this.persistPair(player, other, (firstRelation, secondRelation) => [
          { ...firstRelation, proposal: cancelled, sharedVision: false },
          { ...secondRelation, proposal: cancelled, sharedVision: false },
        ]);
      }
      return;
    }
    const playerContext = this.getEffectContext(gameId, player);
    const senate = this.effectsManager.calculateEffect(EffectType.HAS_SENATE, playerContext).value;
    const noAnarchy = this.effectsManager.calculateEffect(
      EffectType.NO_ANARCHY,
      playerContext
    ).value;
    if (
      senate > 0 &&
      noAnarchy <= 0 &&
      relation.hasReasonToCancel <= 0 &&
      ['ceasefire', 'armistice', 'peace', 'alliance'].includes(relation.state)
    ) {
      throw new Error('The senate refuses to break the treaty');
    }
    const cancelProposal = (current: DiplomaticRelation): TreatyProposal | undefined =>
      current.proposal?.status === 'pending'
        ? {
            ...current.proposal,
            status: 'cancelled',
            resolvedAt: new Date().toISOString(),
          }
        : current.proposal;
    await this.persistPair(player, other, (firstRelation, secondRelation) => [
      {
        ...firstRelation,
        state: 'war',
        maxState: this.maxState(firstRelation.maxState, 'war'),
        sinceTurn: this.currentTurnProvider(gameId),
        turnsLeft: 0,
        sharedVision: false,
        proposal: cancelProposal(firstRelation),
      },
      {
        ...secondRelation,
        state: 'war',
        maxState: this.maxState(secondRelation.maxState, 'war'),
        sinceTurn: this.currentTurnProvider(gameId),
        turnsLeft: 0,
        sharedVision: false,
        reputation:
          firstRelation.hasReasonToCancel > 0
            ? secondRelation.reputation
            : Math.max(0, secondRelation.reputation - 200),
        attitude:
          firstRelation.hasReasonToCancel > 0
            ? secondRelation.attitude
            : Math.max(-1000, secondRelation.attitude - 300),
        hasReasonToCancel: 2,
        proposal: cancelProposal(secondRelation),
      },
    ]);
    await this.emitEvent({
      type: 'war_declared',
      gameId,
      playerIds: [player.id, other.id],
      justified: relation.hasReasonToCancel > 0,
      message: `${player.leaderName} declared war on ${other.leaderName}.`,
    });
  }

  async cancelPact(gameId: string, playerId: string, otherPlayerId: string): Promise<void> {
    return this.withPairLock(gameId, playerId, otherPlayerId, async () => {
      const [player, other] = await this.loadPair(gameId, playerId, otherPlayerId);
      const relation = this.getRelation(player, otherPlayerId);
      if (this.areTeammates(player, other) || relation.state === 'team') {
        throw new Error('Team relations cannot be cancelled');
      }
      if (relation.state === 'war' || relation.state === 'no_contact') {
        throw new Error('There is no pact to cancel');
      }
      this.assertTreatyBreakAllowed(gameId, player, relation);
      const nextState: DiplomaticState = relation.state === 'alliance' ? 'armistice' : 'war';
      const currentTurn = this.currentTurnProvider(gameId);
      await this.persistPair(player, other, (firstRelation, secondRelation) => [
        {
          ...firstRelation,
          state: nextState,
          sinceTurn: currentTurn,
          turnsLeft: TREATY_TURNS,
          sharedVision: false,
          hasReasonToCancel: 0,
        },
        {
          ...secondRelation,
          state: nextState,
          sinceTurn: currentTurn,
          turnsLeft: TREATY_TURNS,
          sharedVision: false,
          reputation:
            firstRelation.hasReasonToCancel > 0
              ? secondRelation.reputation
              : Math.max(0, secondRelation.reputation - 150),
          attitude:
            firstRelation.hasReasonToCancel > 0
              ? secondRelation.attitude
              : Math.max(-1000, secondRelation.attitude - 200),
        },
      ]);
      await this.emitEvent({
        type: nextState === 'war' ? 'war_declared' : 'cancelled',
        gameId,
        playerIds: [player.id, other.id],
        justified: relation.hasReasonToCancel > 0,
        message:
          nextState === 'war'
            ? `${player.leaderName} cancelled the pact and declared war on ${other.leaderName}.`
            : `${player.leaderName} cancelled the existing pact.`,
      });
    });
  }

  async cancelSharedVision(gameId: string, giverId: string, recipientId: string): Promise<void> {
    return this.withPairLock(gameId, giverId, recipientId, async () => {
      const [giver, recipient] = await this.loadPair(gameId, giverId, recipientId);
      await this.persistPair(giver, recipient, (giverRelation, recipientRelation) => {
        if (!recipientRelation.sharedVision) {
          throw new Error('Shared vision is not currently granted');
        }
        return [giverRelation, { ...recipientRelation, sharedVision: false }];
      });
      await this.emitEvent({
        type: 'vision_cancelled',
        gameId,
        playerIds: [giverId, recipientId],
        message: `${giver.leaderName} stopped sharing vision with ${recipient.leaderName}.`,
      });
    });
  }

  async recordIncident(
    gameId: string,
    offenderId: string,
    victimId: string,
    severity: number = 100
  ): Promise<void> {
    return this.withPairLock(gameId, offenderId, victimId, async () => {
      const [offender, victim] = await this.loadPair(gameId, offenderId, victimId);
      await this.persistPair(offender, victim, (offenderRelation, victimRelation) => [
        offenderRelation,
        {
          ...victimRelation,
          reputation: Math.max(0, victimRelation.reputation - severity),
          attitude: Math.max(-1000, victimRelation.attitude - severity),
          hasReasonToCancel: 2,
        },
      ]);
      await this.emitEvent({
        type: 'incident',
        gameId,
        playerIds: [offenderId, victimId],
        offenderId,
        victimId,
        severity,
        message: `${offender.leaderName} caused a diplomatic incident against ${victim.leaderName}.`,
      });
    });
  }

  private applyClauses(
    firstPlayerId: string,
    firstRelation: DiplomaticRelation,
    secondRelation: DiplomaticRelation,
    clauses: TreatyClause[],
    currentTurn: number
  ): [DiplomaticRelation, DiplomaticRelation] {
    let first = { ...firstRelation };
    let second = { ...secondRelation };
    let nextState = first.state;
    for (const clause of clauses) {
      const giverId = clause.giverId!;
      const giverIsFirst = giverId === firstPlayerId;
      if (clause.type === 'embassy') {
        if (giverIsFirst) second = { ...second, embassy: true };
        else first = { ...first, embassy: true };
      }
      if (clause.type === 'shared_vision') {
        if (giverIsFirst) second = { ...second, sharedVision: true };
        else first = { ...first, sharedVision: true };
      }
      if (clause.type === 'ceasefire') nextState = 'ceasefire';
      if (clause.type === 'peace') nextState = 'armistice';
      if (clause.type === 'alliance') nextState = 'alliance';
    }
    if (nextState !== first.state) {
      const turnsLeft = nextState === 'ceasefire' || nextState === 'armistice' ? TREATY_TURNS : 0;
      first = {
        ...first,
        state: nextState,
        maxState: this.maxState(first.maxState, nextState),
        sinceTurn: currentTurn,
        turnsLeft,
      };
      second = {
        ...second,
        state: nextState,
        maxState: this.maxState(second.maxState, nextState),
        sinceTurn: currentTurn,
        turnsLeft,
      };
    }
    return [first, second];
  }

  private validateClauses(
    clauses: TreatyClause[],
    proposerId: string,
    recipientId: string,
    currentState: DiplomaticState
  ): void {
    if (clauses.length === 0) throw new Error('A treaty must contain at least one clause');
    const allowed = new Set<TreatyClauseType>([
      'ceasefire',
      'peace',
      'alliance',
      'embassy',
      'shared_vision',
      'technology',
      'gold',
      'map',
      'seamap',
      'city',
    ]);
    const stateClauses = clauses.filter(clause =>
      ['ceasefire', 'peace', 'alliance'].includes(clause.type)
    );
    if (stateClauses.length > 1) throw new Error('A treaty can contain only one diplomatic state');
    if (clauses.some(clause => !allowed.has(clause.type)))
      throw new Error('Unsupported treaty clause');
    const clauseKeys = clauses.map(clause => {
      const value =
        clause.type === 'technology'
          ? clause.techId
          : clause.type === 'city'
            ? clause.cityId
            : clause.type === 'gold'
              ? clause.amount
              : '';
      return `${clause.giverId}:${clause.type}:${value}`;
    });
    if (new Set(clauseKeys).size !== clauses.length) {
      throw new Error('Treaty clauses must be unique');
    }
    for (const clause of clauses) {
      if (clause.giverId !== proposerId && clause.giverId !== recipientId) {
        throw new Error('Treaty clause giver must be one of the negotiating players');
      }
      if (clause.type === 'technology' && !clause.techId) {
        throw new Error('Technology clause requires a technology');
      }
      if (clause.type === 'gold' && (!Number.isInteger(clause.amount) || clause.amount <= 0)) {
        throw new Error('Gold clause requires a positive integer amount');
      }
      if (clause.type === 'city' && !clause.cityId) {
        throw new Error('City clause requires a city');
      }
    }
    const stateClause = stateClauses[0];
    if (stateClause?.type === 'ceasefire' && currentState !== 'war') {
      throw new Error('A ceasefire can only be agreed while at war');
    }
    if (stateClause?.type === 'peace' && currentState !== 'war' && currentState !== 'ceasefire') {
      throw new Error('Peace can only follow war or ceasefire');
    }
    if (stateClause && currentState === 'team') {
      throw new Error('Team relations cannot be renegotiated');
    }
    if (stateClause?.type === currentState) {
      throw new Error('The proposed diplomatic state is already active');
    }
  }

  private assertDiplomacyAllowed(
    gameId: string,
    first: DiplomacyPlayerRow,
    second: DiplomacyPlayerRow
  ): void {
    const noDiplomacy = [first, second].some(
      player =>
        this.effectsManager.calculateEffect(
          EffectType.NO_DIPLOMACY,
          this.getEffectContext(gameId, player)
        ).value > 0
    );
    if (noDiplomacy) throw new Error('Diplomacy is not possible with this nation');
  }

  private getEffectContext(gameId: string, player: DiplomacyPlayerRow): EffectContext {
    let nationGroups = new Set<string>();
    try {
      const nation = this.ruleset.getNation(player.nation ?? player.civilization);
      nationGroups = new Set([nation.class, ...(nation.groups ?? [])]);
    } catch {
      // Invalid/missing nation data fails closed for nation-group effects.
    }
    return {
      playerId: player.id,
      government: player.government,
      playerNationGroups: nationGroups,
      playerBuildings: this.playerBuildingProvider(gameId, player.id),
    };
  }

  private async loadPair(
    gameId: string,
    playerId: string,
    otherPlayerId: string
  ): Promise<[DiplomacyPlayerRow, DiplomacyPlayerRow]> {
    const pair = await this.loadPairIncludingEliminated(gameId, playerId, otherPlayerId);
    if (!pair[0].isAlive || !pair[1].isAlive) {
      throw new Error('Eliminated players cannot negotiate');
    }
    return pair;
  }

  private async loadPairIncludingEliminated(
    gameId: string,
    playerId: string,
    otherPlayerId: string
  ): Promise<[DiplomacyPlayerRow, DiplomacyPlayerRow]> {
    if (playerId === otherPlayerId) throw new Error('Cannot conduct diplomacy with yourself');
    const db = this.databaseProvider.getDatabase();
    const rows = (await db.query.players.findMany({
      where: eq(players.gameId, gameId),
    })) as DiplomacyPlayerRow[];
    const player = rows.find(candidate => candidate.id === playerId);
    const other = rows.find(candidate => candidate.id === otherPlayerId);
    if (!player || !other) throw new Error('Diplomatic player not found in game');
    return [player, other];
  }

  private async persistPair(
    first: DiplomacyPlayerRow,
    second: DiplomacyPlayerRow,
    updateRelations: (
      firstRelation: DiplomaticRelation,
      secondRelation: DiplomaticRelation
    ) => [DiplomaticRelation, DiplomaticRelation]
  ): Promise<void> {
    const db = this.databaseProvider.getDatabase();
    const firstRelations = this.readRelations(first);
    const secondRelations = this.readRelations(second);
    const [nextFirstRelation, nextSecondRelation] = updateRelations(
      this.getRelation(first, second.id),
      this.getRelation(second, first.id)
    );
    firstRelations[second.id] = nextFirstRelation;
    secondRelations[first.id] = nextSecondRelation;

    const firstKnown = [...this.readKnownPlayers(first).add(second.id)];
    const secondKnown = [...this.readKnownPlayers(second).add(first.id)];
    const persist = async (executor: typeof db) => {
      await executor
        .update(players)
        .set({ knownPlayers: firstKnown, diplomaticRelations: firstRelations })
        .where(and(eq(players.id, first.id), eq(players.gameId, first.gameId)));
      await executor
        .update(players)
        .set({ knownPlayers: secondKnown, diplomaticRelations: secondRelations })
        .where(and(eq(players.id, second.id), eq(players.gameId, second.gameId)));
    };
    if (typeof (db as any).transaction === 'function') {
      await (db as any).transaction((transaction: typeof db) => persist(transaction));
    } else {
      await persist(db);
    }
  }

  private withPairLock<T>(
    gameId: string,
    playerId: string,
    otherPlayerId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const key = `${gameId}:${[playerId, otherPlayerId].sort().join(':')}`;
    const previous = this.pairLocks.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(operation)
      .finally(() => {
        if (this.pairLocks.get(key) === next) this.pairLocks.delete(key);
      });
    this.pairLocks.set(key, next);
    return next;
  }

  private getRelation(player: DiplomacyPlayerRow, otherPlayerId: string): DiplomaticRelation {
    const otherRelation = this.readRelations(player)[otherPlayerId];
    return this.normalizeRelation(otherRelation, false);
  }

  private readKnownPlayers(player: DiplomacyPlayerRow): Set<string> {
    return new Set(Array.isArray(player.knownPlayers) ? (player.knownPlayers as string[]) : []);
  }

  private readRelations(player: DiplomacyPlayerRow): Record<string, DiplomaticRelation> {
    if (!player.diplomaticRelations || typeof player.diplomaticRelations !== 'object') return {};
    return { ...(player.diplomaticRelations as Record<string, DiplomaticRelation>) };
  }

  private defaultRelation(team = false): DiplomaticRelation {
    return {
      state: team ? 'team' : 'no_contact',
      maxState: team ? 'team' : 'no_contact',
      sinceTurn: 0,
      turnsLeft: 0,
      contactTurnsLeft: team ? CONTACT_TURNS : 0,
      hasReasonToCancel: 0,
      embassy: false,
      sharedVision: false,
      reputation: 1000,
      attitude: team ? 1000 : 0,
    };
  }

  private normalizeRelation(
    relation: Partial<DiplomaticRelation> | undefined,
    team: boolean
  ): DiplomaticRelation {
    const fallback = this.defaultRelation(team);
    if (!relation) return fallback;
    const state = team ? 'team' : (relation.state ?? fallback.state);
    return {
      ...fallback,
      ...relation,
      state,
      maxState: team ? 'team' : (relation.maxState ?? this.maxState(fallback.maxState, state)),
      turnsLeft: Number.isInteger(relation.turnsLeft) ? Math.max(0, relation.turnsLeft!) : 0,
      contactTurnsLeft: Number.isInteger(relation.contactTurnsLeft)
        ? Math.max(0, relation.contactTurnsLeft!)
        : state === 'no_contact'
          ? 0
          : CONTACT_TURNS,
      hasReasonToCancel: Number.isInteger(relation.hasReasonToCancel)
        ? Math.max(0, relation.hasReasonToCancel!)
        : 0,
      reputation: Number.isFinite(relation.reputation)
        ? Math.max(0, Math.min(1000, relation.reputation!))
        : 1000,
      attitude: Number.isFinite(relation.attitude)
        ? Math.max(-1000, Math.min(1000, relation.attitude!))
        : team
          ? 1000
          : 0,
    };
  }

  private areTeammates(first: DiplomacyPlayerRow, second: DiplomacyPlayerRow): boolean {
    return Boolean(first.teamId && second.teamId && first.teamId === second.teamId);
  }

  private canMeet(relation: DiplomaticRelation, reverseRelation?: DiplomaticRelation): boolean {
    return (
      relation.state === 'team' ||
      relation.contactTurnsLeft > 0 ||
      relation.embassy ||
      Boolean(reverseRelation?.embassy)
    );
  }

  private maxState(first: DiplomaticState, second: DiplomaticState): DiplomaticState {
    return STATE_RANK[first] >= STATE_RANK[second] ? first : second;
  }

  private assertTreatyBreakAllowed(
    gameId: string,
    player: DiplomacyPlayerRow,
    relation: DiplomaticRelation
  ): void {
    const playerContext = this.getEffectContext(gameId, player);
    const senate = this.effectsManager.calculateEffect(EffectType.HAS_SENATE, playerContext).value;
    const noAnarchy = this.effectsManager.calculateEffect(
      EffectType.NO_ANARCHY,
      playerContext
    ).value;
    if (senate > 0 && noAnarchy <= 0 && relation.hasReasonToCancel <= 0) {
      throw new Error('The senate refuses to break the treaty');
    }
  }

  private async assertAllianceCompatible(
    gameId: string,
    first: DiplomacyPlayerRow,
    second: DiplomacyPlayerRow
  ): Promise<void> {
    const rows = (await this.databaseProvider.getDatabase().query.players.findMany({
      where: eq(players.gameId, gameId),
    })) as DiplomacyPlayerRow[];
    for (const third of rows) {
      if (!third.isAlive || third.id === first.id || third.id === second.id) continue;
      const firstToThird = this.getRelation(first, third.id).state;
      const secondToThird = this.getRelation(second, third.id).state;
      const firstAllied = firstToThird === 'alliance' || this.areTeammates(first, third);
      const secondAllied = secondToThird === 'alliance' || this.areTeammates(second, third);
      if ((firstToThird === 'war' && secondAllied) || (secondToThird === 'war' && firstAllied)) {
        throw new Error('An alliance would create conflicting wars with a third nation');
      }
    }
  }

  private async emitEvent(event: DiplomacyEvent): Promise<void> {
    await this.eventSink?.(event);
  }
}
