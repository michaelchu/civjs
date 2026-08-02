/**
 * @module server/game/managers/DiplomacyManager
 * Coordinates authoritative Diplomacy Manager game state.
 */
import { and, eq } from 'drizzle-orm';
import type { DatabaseProvider } from '@database';
import { players } from '@database/schema';
import { EffectsManager, EffectType, type EffectContext } from '@game/managers/EffectsManager';
import { rulesetLoader, type RulesetLoader } from '@shared/data/rulesets/RulesetLoader';

export type DiplomaticState =
  'no_contact' | 'war' | 'ceasefire' | 'armistice' | 'peace' | 'alliance' | 'team';

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

export interface DiplomacyReplaySnapshot {
  players: Array<{
    playerId: string;
    playerNumber: number;
    civilization: string;
    isAlive: boolean;
    isAI: boolean;
    teamId: string | null;
    relations: Array<{
      playerId: string;
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
      proposal?: {
        proposerId: string;
        recipientId: string;
        clauses: TreatyClause[];
        status: TreatyProposal['status'];
      };
    }>;
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
  scope?: 'victim_only' | 'international_outcry';
}

export interface DiplomacyReplayEvent {
  type: DiplomacyEvent['type'];
  playerIds: [string, string];
  message: string;
  offenderId?: string;
  victimId?: string;
  severity?: number;
  justified?: boolean;
  scope?: DiplomacyEvent['scope'];
}

export function toDiplomacyReplayEvent(event: DiplomacyEvent): DiplomacyReplayEvent {
  return {
    type: event.type,
    playerIds: [event.playerIds[0], event.playerIds[1]],
    message: event.message,
    ...(event.offenderId === undefined ? {} : { offenderId: event.offenderId }),
    ...(event.victimId === undefined ? {} : { victimId: event.victimId }),
    ...(event.severity === undefined ? {} : { severity: event.severity }),
    ...(event.justified === undefined ? {} : { justified: event.justified }),
    ...(event.scope === undefined ? {} : { scope: event.scope }),
  };
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
  private readonly effectsManagersByRuleset = new Map<string, EffectsManager>();
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
    private readonly ruleset: Pick<RulesetLoader, 'getNation'> = rulesetLoader,
    private readonly rulesetNameProvider: (gameId: string) => string = () =>
      this.effectsManager.getRulesetName()
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

  async getReplaySnapshot(gameId: string): Promise<DiplomacyReplaySnapshot> {
    const db = this.databaseProvider.getDatabase();
    const gamePlayers = (await db.query.players.findMany({
      where: eq(players.gameId, gameId),
    })) as DiplomacyPlayerRow[];
    const orderedPlayers = gamePlayers
      .slice()
      .sort(
        (first, second) =>
          first.playerNumber - second.playerNumber || first.id.localeCompare(second.id)
      );

    return {
      players: orderedPlayers.map(player => {
        const relations = this.readRelations(player);
        return {
          playerId: player.id,
          playerNumber: player.playerNumber,
          civilization: player.civilization,
          isAlive: player.isAlive,
          isAI: player.isAI,
          teamId: player.teamId ?? null,
          relations: orderedPlayers
            .filter(other => other.id !== player.id)
            .map(other =>
              this.toReplayRelation(
                other.id,
                this.normalizeRelation(relations[other.id], this.areTeammates(player, other))
              )
            ),
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
          if (
            this.getRelation(currentFirst, currentSecond.id).state === 'no_contact' &&
            this.getRelation(currentSecond, currentFirst.id).state === 'no_contact'
          ) {
            return;
          }
          let event: DiplomacyEvent | undefined;
          await this.persistPair(currentFirst, currentSecond, (firstRelation, secondRelation) => {
            const update = this.advancePairRelations(
              gameId,
              first,
              second,
              currentFirst,
              currentSecond,
              firstRelation,
              secondRelation
            );
            event = update.event;
            return update.relations;
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

  /**
   * Give every living player contact with every other living player when a
   * player-owned ruleset effect grants it (Marco Polo's Embassy in c2c3).
   *
   * @reference reference/freeciv/server/srv_main.c:784-798 do_have_contacts_effect()
   * @reference reference/freeciv/server/plrhand.c:2305-2364 make_contact()
   */
  async applyEffectContacts(gameId: string): Promise<void> {
    const db = this.databaseProvider.getDatabase();
    const gamePlayers = (await db.query.players.findMany({
      where: eq(players.gameId, gameId),
    })) as DiplomacyPlayerRow[];
    const effectsManager = this.getEffectsManager(gameId);

    for (const player of gamePlayers) {
      if (
        !player.isAlive ||
        effectsManager.calculateEffect(
          EffectType.HAVE_CONTACTS,
          this.getEffectContext(gameId, player)
        ).value <= 0
      ) {
        continue;
      }
      for (const other of gamePlayers) {
        if (player.id === other.id || !other.isAlive) continue;
        await this.withPairLock(gameId, player.id, other.id, () =>
          this.establishContactLocked(gameId, player.id, other.id, gamePlayers)
        );
      }
    }
  }

  private advancePairRelations(
    gameId: string,
    first: DiplomacyPlayerRow,
    second: DiplomacyPlayerRow,
    currentFirst: DiplomacyPlayerRow,
    currentSecond: DiplomacyPlayerRow,
    firstRelation: DiplomaticRelation,
    secondRelation: DiplomaticRelation
  ): { relations: [DiplomaticRelation, DiplomaticRelation]; event?: DiplomacyEvent } {
    if (this.areTeammates(currentFirst, currentSecond))
      return {
        relations: [
          this.normalizeRelation(firstRelation, true),
          this.normalizeRelation(secondRelation, true),
        ],
      };
    const next = this.decrementPairRelations(firstRelation, secondRelation);
    if (!['ceasefire', 'armistice'].includes(firstRelation.state)) return { relations: next };
    return this.advanceTimedRelation(gameId, first, second, firstRelation, next);
  }

  private decrementPairRelations(
    first: DiplomaticRelation,
    second: DiplomaticRelation
  ): [DiplomaticRelation, DiplomaticRelation] {
    return [
      {
        ...first,
        contactTurnsLeft: Math.max(0, first.contactTurnsLeft - 1),
        hasReasonToCancel: Math.max(0, first.hasReasonToCancel - 1),
      },
      {
        ...second,
        contactTurnsLeft: Math.max(0, second.contactTurnsLeft - 1),
        hasReasonToCancel: Math.max(0, second.hasReasonToCancel - 1),
      },
    ];
  }

  private advanceTimedRelation(
    gameId: string,
    first: DiplomacyPlayerRow,
    second: DiplomacyPlayerRow,
    relation: DiplomaticRelation,
    next: [DiplomaticRelation, DiplomaticRelation]
  ): { relations: [DiplomaticRelation, DiplomaticRelation]; event?: DiplomacyEvent } {
    const turnsLeft = Math.max(0, relation.turnsLeft - 1);
    const state: DiplomaticState =
      turnsLeft === 0 ? (relation.state === 'ceasefire' ? 'war' : 'peace') : relation.state;
    const event =
      turnsLeft === 0
        ? ({
            type: relation.state === 'ceasefire' ? 'ceasefire_expired' : 'armistice_completed',
            gameId,
            playerIds: [first.id, second.id],
            message:
              relation.state === 'ceasefire'
                ? `The ceasefire between ${first.leaderName} and ${second.leaderName} expired.`
                : `The armistice between ${first.leaderName} and ${second.leaderName} became peace.`,
          } as DiplomacyEvent)
        : undefined;
    return {
      event,
      relations: next.map(item => ({
        ...item,
        state,
        sinceTurn: turnsLeft === 0 ? this.currentTurnProvider(gameId) : item.sinceTurn,
        turnsLeft,
        sharedVision: state === 'war' ? false : item.sharedVision,
      })) as [DiplomaticRelation, DiplomaticRelation],
    };
  }

  async establishContact(gameId: string, playerId: string, otherPlayerId: string): Promise<void> {
    return this.withPairLock(gameId, playerId, otherPlayerId, () =>
      this.establishContactLocked(gameId, playerId, otherPlayerId)
    );
  }

  private async establishContactLocked(
    gameId: string,
    playerId: string,
    otherPlayerId: string,
    gamePlayers?: DiplomacyPlayerRow[]
  ): Promise<void> {
    const [player, other] = await this.loadPair(gameId, playerId, otherPlayerId);
    const firstContact = this.getRelation(player, other.id).state === 'no_contact';
    const defaultState = firstContact
      ? this.getDefaultContactState(
          player,
          other,
          gamePlayers ??
            ((await this.databaseProvider.getDatabase().query.players.findMany({
              where: eq(players.gameId, gameId),
            })) as DiplomacyPlayerRow[])
        )
      : undefined;
    const contactTurns = this.canMaintainContact(gameId, player, other) ? CONTACT_TURNS : undefined;
    await this.persistPair(player, other, (firstRelation, secondRelation) => [
      {
        ...firstRelation,
        state: firstContact ? defaultState! : firstRelation.state,
        maxState: firstContact
          ? this.maxState(firstRelation.maxState, defaultState!)
          : firstRelation.maxState,
        contactTurnsLeft: contactTurns ?? firstRelation.contactTurnsLeft,
      },
      {
        ...secondRelation,
        state: firstContact ? defaultState! : secondRelation.state,
        maxState: firstContact
          ? this.maxState(secondRelation.maxState, defaultState!)
          : secondRelation.maxState,
        contactTurnsLeft: contactTurns ?? secondRelation.contactTurnsLeft,
      },
    ]);
    if (firstContact) {
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
    this.assertTreatyNegotiationAllowed(
      proposer,
      recipient,
      proposerRelation,
      this.getRelation(recipient, proposerId)
    );
    const normalizedClauses = clauses.map(clause => ({
      ...clause,
      giverId: clause.giverId ?? proposerId,
    })) as TreatyClause[];
    this.validateClauses(normalizedClauses, proposerId, recipientId, proposerRelation.state);
    await this.assertAllianceForClauses(gameId, proposer, recipient, normalizedClauses);
    const existingProposal = this.getExistingTreatyProposal(
      proposerRelation,
      requestId,
      proposerId
    );
    if (existingProposal) return existingProposal;

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

  private assertTreatyNegotiationAllowed(
    proposer: DiplomacyPlayerRow,
    recipient: DiplomacyPlayerRow,
    proposerRelation: DiplomaticRelation,
    recipientRelation: DiplomaticRelation
  ): void {
    if (this.areTeammates(proposer, recipient) || proposerRelation.state === 'team')
      throw new Error('Teammates cannot negotiate separate treaties');
    if (!this.canMeet(proposerRelation, recipientRelation))
      throw new Error('Diplomatic contact or an embassy is required');
  }

  private async assertAllianceForClauses(
    gameId: string,
    proposer: DiplomacyPlayerRow,
    recipient: DiplomacyPlayerRow,
    clauses: TreatyClause[]
  ): Promise<void> {
    if (clauses.some(clause => clause.type === 'alliance'))
      await this.assertAllianceCompatible(gameId, proposer, recipient);
  }

  private getExistingTreatyProposal(
    relation: DiplomaticRelation,
    requestId: string | undefined,
    proposerId: string
  ): TreatyProposal | undefined {
    if (
      requestId &&
      relation.proposal?.requestId === requestId &&
      relation.proposal.proposerId === proposerId
    )
      return relation.proposal;
    if (relation.proposal?.status === 'pending')
      throw new Error('A diplomatic meeting is already pending');
    return undefined;
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
    this.assertTreatyResponse(gameId, playerId, player, other, proposal, relation, accept);

    const resolved: TreatyProposal = {
      ...proposal,
      status: accept ? 'accepted' : 'rejected',
      resolvedAt: new Date().toISOString(),
    };
    const rollbackTransfers = await this.transferTreatyClauses(gameId, proposal, accept);
    try {
      await this.persistTreatyResponse(gameId, player, other, proposal, resolved, accept);
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

  private assertTreatyResponse(
    gameId: string,
    playerId: string,
    player: DiplomacyPlayerRow,
    other: DiplomacyPlayerRow,
    proposal: TreatyProposal,
    relation: DiplomaticRelation,
    accept: boolean
  ): void {
    if (proposal.recipientId !== playerId) throw new Error('Only the treaty recipient can respond');
    this.assertDiplomacyAllowed(gameId, player, other);
    if (accept)
      this.validateClauses(
        proposal.clauses,
        proposal.proposerId,
        proposal.recipientId,
        relation.state
      );
  }

  private async transferTreatyClauses(
    gameId: string,
    proposal: TreatyProposal,
    accept: boolean
  ): Promise<void | (() => Promise<void>)> {
    const clauses = proposal.clauses.filter(clause =>
      ['technology', 'gold', 'map', 'seamap', 'city'].includes(clause.type)
    );
    if (!accept || clauses.length === 0) return undefined;
    if (!this.transferExecutor) throw new Error('Treaty transfers are not configured');
    return this.transferExecutor(gameId, proposal.proposerId, proposal.recipientId, clauses);
  }

  private async persistTreatyResponse(
    gameId: string,
    player: DiplomacyPlayerRow,
    other: DiplomacyPlayerRow,
    proposal: TreatyProposal,
    resolved: TreatyProposal,
    accept: boolean
  ): Promise<void> {
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
    const senate = this.getEffectsManager(gameId).calculateEffect(
      EffectType.HAS_SENATE,
      playerContext
    ).value;
    const noAnarchy = this.getEffectsManager(gameId).calculateEffect(
      EffectType.NO_ANARCHY,
      playerContext
    ).value;
    this.assertSenateAllowsWar(senate, noAnarchy, relation);
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

  private assertSenateAllowsWar(
    senate: number,
    noAnarchy: number,
    relation: DiplomaticRelation
  ): void {
    if (
      senate > 0 &&
      noAnarchy <= 0 &&
      relation.hasReasonToCancel <= 0 &&
      ['ceasefire', 'armistice', 'peace', 'alliance'].includes(relation.state)
    )
      throw new Error('The senate refuses to break the treaty');
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
    severity: number = 100,
    scope: DiplomacyEvent['scope'] = 'victim_only'
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
        scope,
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
      const applied = this.applyClause(clause, giverIsFirst, first, second, nextState);
      first = applied.first;
      second = applied.second;
      nextState = applied.nextState;
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

  private applyClause(
    clause: TreatyClause,
    giverIsFirst: boolean,
    first: DiplomaticRelation,
    second: DiplomaticRelation,
    nextState: DiplomaticState
  ): { first: DiplomaticRelation; second: DiplomaticRelation; nextState: DiplomaticState } {
    if (clause.type === 'embassy')
      return giverIsFirst
        ? { first, second: { ...second, embassy: true }, nextState }
        : { first: { ...first, embassy: true }, second, nextState };
    if (clause.type === 'shared_vision')
      return giverIsFirst
        ? { first, second: { ...second, sharedVision: true }, nextState }
        : { first: { ...first, sharedVision: true }, second, nextState };
    const states: Record<string, DiplomaticState> = {
      ceasefire: 'ceasefire',
      peace: 'armistice',
      alliance: 'alliance',
    };
    return { first, second, nextState: states[clause.type] ?? nextState };
  }

  private validateClauses(
    clauses: TreatyClause[],
    proposerId: string,
    recipientId: string,
    currentState: DiplomaticState
  ): void {
    this.assertClauseShape(clauses);
    const stateClauses = this.getStateClauses(clauses);
    this.assertClauseValues(clauses, proposerId, recipientId);
    const stateClause = stateClauses[0];
    this.assertStateClause(stateClause, currentState);
  }

  private assertClauseShape(clauses: TreatyClause[]): void {
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
    if (clauses.filter(c => ['ceasefire', 'peace', 'alliance'].includes(c.type)).length > 1)
      throw new Error('A treaty can contain only one diplomatic state');
    if (clauses.some(c => !allowed.has(c.type))) throw new Error('Unsupported treaty clause');
    const keys = clauses.map(
      c =>
        `${c.giverId}:${c.type}:${(c as any).techId ?? (c as any).cityId ?? (c as any).amount ?? ''}`
    );
    if (new Set(keys).size !== clauses.length) throw new Error('Treaty clauses must be unique');
  }

  private getStateClauses(clauses: TreatyClause[]): TreatyClause[] {
    return clauses.filter(c => ['ceasefire', 'peace', 'alliance'].includes(c.type));
  }

  private assertClauseValues(
    clauses: TreatyClause[],
    proposerId: string,
    recipientId: string
  ): void {
    for (const clause of clauses) this.assertClauseValue(clause, proposerId, recipientId);
  }

  private assertClauseValue(clause: TreatyClause, proposerId: string, recipientId: string): void {
    if (clause.giverId !== proposerId && clause.giverId !== recipientId)
      throw new Error('Treaty clause giver must be one of the negotiating players');
    if (clause.type === 'technology' && !clause.techId)
      throw new Error('Technology clause requires a technology');
    if (clause.type === 'gold' && (!Number.isInteger(clause.amount) || clause.amount <= 0))
      throw new Error('Gold clause requires a positive integer amount');
    if (clause.type === 'city' && !clause.cityId) throw new Error('City clause requires a city');
  }

  private assertStateClause(clause: TreatyClause | undefined, state: DiplomaticState): void {
    this.assertCeasefireState(clause, state);
    this.assertPeaceState(clause, state);
    if (clause && state === 'team') throw new Error('Team relations cannot be renegotiated');
    if (clause?.type === state) throw new Error('The proposed diplomatic state is already active');
  }

  private assertCeasefireState(clause: TreatyClause | undefined, state: DiplomaticState): void {
    if (clause?.type === 'ceasefire' && state !== 'war')
      throw new Error('A ceasefire can only be agreed while at war');
  }

  private assertPeaceState(clause: TreatyClause | undefined, state: DiplomaticState): void {
    if (clause?.type === 'peace' && state !== 'war' && state !== 'ceasefire')
      throw new Error('Peace can only follow war or ceasefire');
  }

  private assertDiplomacyAllowed(
    gameId: string,
    first: DiplomacyPlayerRow,
    second: DiplomacyPlayerRow
  ): void {
    const noDiplomacy = [first, second].some(
      player =>
        this.getEffectsManager(gameId).calculateEffect(
          EffectType.NO_DIPLOMACY,
          this.getEffectContext(gameId, player)
        ).value > 0
    );
    if (noDiplomacy) throw new Error('Diplomacy is not possible with this nation');
  }

  private getRulesetName(gameId: string): string {
    return this.rulesetNameProvider(gameId) || this.effectsManager.getRulesetName();
  }

  private getEffectsManager(gameId: string): EffectsManager {
    const rulesetName = this.getRulesetName(gameId);
    if (rulesetName === this.effectsManager.getRulesetName()) return this.effectsManager;

    let effectsManager = this.effectsManagersByRuleset.get(rulesetName);
    if (!effectsManager) {
      effectsManager = new EffectsManager(rulesetName);
      this.effectsManagersByRuleset.set(rulesetName, effectsManager);
    }
    return effectsManager;
  }

  private canMaintainContact(
    gameId: string,
    first: DiplomacyPlayerRow,
    second: DiplomacyPlayerRow
  ): boolean {
    const effectsManager = this.getEffectsManager(gameId);
    return [first, second].every(
      player =>
        effectsManager.calculateEffect(
          EffectType.NO_DIPLOMACY,
          this.getEffectContext(gameId, player)
        ).value <= 0
    );
  }

  private getDefaultContactState(
    first: DiplomacyPlayerRow,
    second: DiplomacyPlayerRow,
    playersInGame: DiplomacyPlayerRow[]
  ): 'war' | 'peace' {
    const commonAlly = playersInGame.some(
      other =>
        other.isAlive &&
        other.id !== first.id &&
        other.id !== second.id &&
        this.areAllied(first, other) &&
        this.areAllied(second, other)
    );
    return commonAlly ? 'peace' : 'war';
  }

  private getEffectContext(gameId: string, player: DiplomacyPlayerRow): EffectContext {
    let nationGroups = new Set<string>();
    try {
      const nation = this.ruleset.getNation(
        player.nation ?? player.civilization,
        this.getRulesetName(gameId)
      );
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

  private toReplayRelation(
    playerId: string,
    relation: DiplomaticRelation
  ): DiplomacyReplaySnapshot['players'][number]['relations'][number] {
    return {
      playerId,
      state: relation.state,
      maxState: relation.maxState,
      sinceTurn: relation.sinceTurn,
      turnsLeft: relation.turnsLeft,
      contactTurnsLeft: relation.contactTurnsLeft,
      hasReasonToCancel: relation.hasReasonToCancel,
      embassy: relation.embassy,
      sharedVision: relation.sharedVision,
      ...(relation.givesSharedVision === undefined
        ? {}
        : { givesSharedVision: relation.givesSharedVision }),
      reputation: relation.reputation,
      attitude: relation.attitude,
      ...(relation.proposal
        ? {
            proposal: {
              proposerId: relation.proposal.proposerId,
              recipientId: relation.proposal.recipientId,
              clauses: relation.proposal.clauses.map(clause => ({ ...clause })),
              status: relation.proposal.status,
            },
          }
        : {}),
    };
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
    const values = this.normalizeRelationValues(relation, team, state, fallback);
    return {
      ...fallback,
      ...relation,
      state,
      ...values,
    };
  }

  private normalizeRelationValues(
    relation: Partial<DiplomaticRelation>,
    team: boolean,
    state: DiplomaticState,
    fallback: DiplomaticRelation
  ): Partial<DiplomaticRelation> {
    return {
      maxState: this.normalizeMaxState(relation, team, state, fallback),
      turnsLeft: this.nonNegativeInteger(relation.turnsLeft),
      contactTurnsLeft: this.normalizeContactTurns(relation.contactTurnsLeft, state),
      hasReasonToCancel: this.nonNegativeInteger(relation.hasReasonToCancel),
      reputation: this.normalizeReputation(relation.reputation),
      attitude: this.normalizeAttitude(relation.attitude, team),
    };
  }

  private normalizeMaxState(
    relation: Partial<DiplomaticRelation>,
    team: boolean,
    state: DiplomaticState,
    fallback: DiplomaticRelation
  ): DiplomaticState {
    return team ? 'team' : (relation.maxState ?? this.maxState(fallback.maxState, state));
  }
  private nonNegativeInteger(value: number | undefined): number {
    return Number.isInteger(value) ? Math.max(0, value!) : 0;
  }
  private normalizeContactTurns(value: number | undefined, state: DiplomaticState): number {
    return Number.isInteger(value)
      ? Math.max(0, value!)
      : state === 'no_contact'
        ? 0
        : CONTACT_TURNS;
  }
  private normalizeReputation(value: number | undefined): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(1000, value!)) : 1000;
  }
  private normalizeAttitude(value: number | undefined, team: boolean): number {
    return Number.isFinite(value) ? Math.max(-1000, Math.min(1000, value!)) : team ? 1000 : 0;
  }

  private areTeammates(first: DiplomacyPlayerRow, second: DiplomacyPlayerRow): boolean {
    return Boolean(first.teamId && second.teamId && first.teamId === second.teamId);
  }

  private areAllied(first: DiplomacyPlayerRow, second: DiplomacyPlayerRow): boolean {
    return (
      this.areTeammates(first, second) ||
      (this.getRelation(first, second.id).state === 'alliance' &&
        this.getRelation(second, first.id).state === 'alliance')
    );
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
    const senate = this.getEffectsManager(gameId).calculateEffect(
      EffectType.HAS_SENATE,
      playerContext
    ).value;
    const noAnarchy = this.getEffectsManager(gameId).calculateEffect(
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
      if (this.hasConflictingAlliance(first, second, third, firstToThird, secondToThird))
        throw new Error('An alliance would create conflicting wars with a third nation');
    }
  }

  private hasConflictingAlliance(
    first: DiplomacyPlayerRow,
    second: DiplomacyPlayerRow,
    third: DiplomacyPlayerRow,
    firstState: DiplomaticState,
    secondState: DiplomaticState
  ): boolean {
    const firstAllied = firstState === 'alliance' || this.areTeammates(first, third);
    const secondAllied = secondState === 'alliance' || this.areTeammates(second, third);
    return (firstState === 'war' && secondAllied) || (secondState === 'war' && firstAllied);
  }

  private async emitEvent(event: DiplomacyEvent): Promise<void> {
    await this.eventSink?.(event);
  }
}
