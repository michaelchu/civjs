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
  | 'alliance';

export type TreatyClauseType = 'ceasefire' | 'peace' | 'alliance' | 'embassy' | 'shared_vision';

export interface TreatyClause {
  type: TreatyClauseType;
}

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
  sinceTurn: number;
  embassy: boolean;
  sharedVision: boolean;
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
    relation: DiplomaticRelation;
  }>;
}

/**
 * Persisted, bilateral diplomacy state.
 * @reference reference/freeciv/common/player.h enum diplstate_type
 * @reference reference/freeciv/server/diplhand.c treaty handling
 */
export class DiplomacyManager {
  private readonly pairLocks = new Map<string, Promise<unknown>>();

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
        .map(candidate => ({
          id: candidate.id,
          civilization: candidate.civilization,
          leaderName: candidate.leaderName,
          isAlive: candidate.isAlive,
          isAI: candidate.isAI,
          known: knownPlayers.has(candidate.id),
          relation: relations[candidate.id] ?? this.defaultRelation(),
        })),
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
    otherPlayerId: string
  ): Promise<void> {
    const [player, other] = await this.loadPair(gameId, playerId, otherPlayerId);
    await this.persistPair(player, other, relation => relation);
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
    this.validateClauses(clauses);
    const [proposer, recipient] = await this.loadPair(gameId, proposerId, recipientId);
    this.assertDiplomacyAllowed(gameId, proposer, recipient);
    const proposerRelation = this.getRelation(proposer, recipientId);

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
      clauses,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await this.persistPair(proposer, recipient, relation => ({ ...relation, proposal }));
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

    const resolved: TreatyProposal = {
      ...proposal,
      status: accept ? 'accepted' : 'rejected',
      resolvedAt: new Date().toISOString(),
    };
    await this.persistPair(player, other, current =>
      accept
        ? this.applyClauses(
            { ...current, proposal: resolved },
            proposal.clauses,
            this.currentTurnProvider(gameId)
          )
        : { ...current, proposal: resolved }
    );
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
    await this.persistPair(player, other, relation => ({ ...relation, proposal: cancelled }));
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
      await this.persistPair(player, other, relation => ({ ...relation, embassy: true }));
    });
  }

  private async declareWarLocked(
    gameId: string,
    playerId: string,
    otherPlayerId: string
  ): Promise<void> {
    const [player, other] = await this.loadPair(gameId, playerId, otherPlayerId);
    const relation = this.getRelation(player, otherPlayerId);
    const playerContext = this.getEffectContext(gameId, player);
    const senate = this.effectsManager.calculateEffect(EffectType.HAS_SENATE, playerContext).value;
    const noAnarchy = this.effectsManager.calculateEffect(
      EffectType.NO_ANARCHY,
      playerContext
    ).value;
    if (
      senate > 0 &&
      noAnarchy <= 0 &&
      ['ceasefire', 'armistice', 'peace', 'alliance'].includes(relation.state)
    ) {
      throw new Error('The senate refuses to break the treaty');
    }
    await this.persistPair(player, other, relation => ({
      ...relation,
      state: 'war',
      sinceTurn: this.currentTurnProvider(gameId),
      sharedVision: false,
      proposal:
        relation.proposal?.status === 'pending'
          ? {
              ...relation.proposal,
              status: 'cancelled',
              resolvedAt: new Date().toISOString(),
            }
          : relation.proposal,
    }));
  }

  private applyClauses(
    relation: DiplomaticRelation,
    clauses: TreatyClause[],
    currentTurn: number
  ): DiplomaticRelation {
    const next = { ...relation, sinceTurn: relation.sinceTurn };
    for (const clause of clauses) {
      if (clause.type === 'embassy') next.embassy = true;
      if (clause.type === 'shared_vision') next.sharedVision = true;
      if (clause.type === 'ceasefire') next.state = 'ceasefire';
      if (clause.type === 'peace') next.state = 'peace';
      if (clause.type === 'alliance') next.state = 'alliance';
    }
    if (next.state !== relation.state) next.sinceTurn = currentTurn;
    return next;
  }

  private validateClauses(clauses: TreatyClause[]): void {
    if (clauses.length === 0) throw new Error('A treaty must contain at least one clause');
    const allowed = new Set<TreatyClauseType>([
      'ceasefire',
      'peace',
      'alliance',
      'embassy',
      'shared_vision',
    ]);
    const stateClauses = clauses.filter(clause =>
      ['ceasefire', 'peace', 'alliance'].includes(clause.type)
    );
    if (stateClauses.length > 1) throw new Error('A treaty can contain only one diplomatic state');
    if (clauses.some(clause => !allowed.has(clause.type)))
      throw new Error('Unsupported treaty clause');
    if (new Set(clauses.map(clause => clause.type)).size !== clauses.length) {
      throw new Error('Treaty clauses must be unique');
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
    if (playerId === otherPlayerId) throw new Error('Cannot conduct diplomacy with yourself');
    const db = this.databaseProvider.getDatabase();
    const rows = (await db.query.players.findMany({
      where: eq(players.gameId, gameId),
    })) as DiplomacyPlayerRow[];
    const player = rows.find(candidate => candidate.id === playerId);
    const other = rows.find(candidate => candidate.id === otherPlayerId);
    if (!player || !other) throw new Error('Diplomatic player not found in game');
    if (!player.isAlive || !other.isAlive) throw new Error('Eliminated players cannot negotiate');
    return [player, other];
  }

  private async persistPair(
    first: DiplomacyPlayerRow,
    second: DiplomacyPlayerRow,
    updateRelation: (relation: DiplomaticRelation) => DiplomaticRelation
  ): Promise<void> {
    const db = this.databaseProvider.getDatabase();
    const firstRelations = this.readRelations(first);
    const secondRelations = this.readRelations(second);
    const nextRelation = updateRelation(this.getRelation(first, second.id));
    firstRelations[second.id] = nextRelation;
    secondRelations[first.id] = nextRelation;

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
    return this.readRelations(player)[otherPlayerId] ?? this.defaultRelation();
  }

  private readKnownPlayers(player: DiplomacyPlayerRow): Set<string> {
    return new Set(Array.isArray(player.knownPlayers) ? (player.knownPlayers as string[]) : []);
  }

  private readRelations(player: DiplomacyPlayerRow): Record<string, DiplomaticRelation> {
    if (!player.diplomaticRelations || typeof player.diplomaticRelations !== 'object') return {};
    return { ...(player.diplomaticRelations as Record<string, DiplomaticRelation>) };
  }

  private defaultRelation(): DiplomaticRelation {
    return {
      state: 'no_contact',
      sinceTurn: 0,
      embassy: false,
      sharedVision: false,
    };
  }
}
