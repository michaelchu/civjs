import { DiplomacyManager } from '@game/managers/DiplomacyManager';
import { EffectsManager } from '@game/managers/EffectsManager';

const createPlayer = (id: string, playerNumber: number) => ({
  id,
  gameId: 'game-1',
  playerNumber,
  nation: id === 'p1' ? 'roman' : 'greek',
  civilization: id === 'p1' ? 'roman' : 'greek',
  leaderName: id === 'p1' ? 'Caesar' : 'Pericles',
  government: 'despotism',
  isAlive: true,
  isAI: id === 'p2',
  teamId: null as string | null,
  knownPlayers: [],
  diplomaticRelations: {},
});

describe('DiplomacyManager', () => {
  let rows: ReturnType<typeof createPlayer>[];
  let manager: DiplomacyManager;
  let failUpdates: boolean;
  let database: any;

  beforeEach(() => {
    rows = [createPlayer('p1', 0), createPlayer('p2', 1)];
    failUpdates = false;
    database = {
      query: {
        players: {
          findMany: jest.fn(async () => rows),
        },
      },
      update: jest.fn(() => ({
        set: (data: any) => ({
          where: async () => {
            if (failUpdates) throw new Error('persistence failed');
            const relationTarget = Object.keys(data.diplomaticRelations)[0];
            const row = rows.find(candidate => candidate.id !== relationTarget)!;
            Object.assign(row, data);
          },
        }),
      })),
    };
    manager = new DiplomacyManager({ getDatabase: () => database } as any, () => 7);
  });

  function useCiv2Civ3ContactEffects(effectOwners: Set<string>): void {
    manager = new DiplomacyManager(
      { getDatabase: () => database } as any,
      () => 7,
      (_gameId, playerId) => new Set(effectOwners.has(playerId) ? ['marco_polos_embassy'] : []),
      new EffectsManager('civ2civ3')
    );
  }

  it('persists bilateral contact and returns nation intelligence', async () => {
    await manager.establishContact('game-1', 'p1', 'p2');

    const first = await manager.getSnapshot('game-1', 'p1');
    const second = await manager.getSnapshot('game-1', 'p2');
    expect(first.nations[0]).toMatchObject({ id: 'p2', known: true, isAI: true });
    expect(second.nations[0]).toMatchObject({ id: 'p1', known: true });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3399-3420
   * @reference reference/freeciv/server/srv_main.c:784-798
   * @reference reference/freeciv/server/plrhand.c:2305-2364
   * @assertion Marco Polo's Embassy gives its living owner bilateral first contact with every living player and refreshes the configured contact duration after each turn.
   * @c2c3-surface diplomacy-espionage
   * @c2c3-surface-scenario normal, turn
   */
  it('applies c2c3 Marco Polo contacts to every living player each turn', async () => {
    rows.push(createPlayer('p3', 2));
    useCiv2Civ3ContactEffects(new Set(['p1']));

    await manager.applyEffectContacts('game-1');

    expect(await manager.getSnapshot('game-1', 'p1')).toEqual(
      expect.objectContaining({
        nations: expect.arrayContaining([
          expect.objectContaining({
            id: 'p2',
            known: true,
            canMeet: true,
            relation: expect.objectContaining({ state: 'war', contactTurnsLeft: 20 }),
          }),
          expect.objectContaining({
            id: 'p3',
            known: true,
            canMeet: true,
            relation: expect.objectContaining({ state: 'war', contactTurnsLeft: 20 }),
          }),
        ]),
      })
    );
    expect((await manager.getSnapshot('game-1', 'p2')).nations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'p1', known: true, canMeet: true }),
        expect.objectContaining({ id: 'p3', known: false, canMeet: false }),
      ])
    );

    await manager.processTurn('game-1');
    expect((await manager.getSnapshot('game-1', 'p1')).nations[0]?.relation.contactTurnsLeft).toBe(
      19
    );
    await manager.applyEffectContacts('game-1');
    expect((await manager.getSnapshot('game-1', 'p1')).nations[0]?.relation.contactTurnsLeft).toBe(
      20
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3399-3420
   * @reference reference/freeciv/server/srv_main.c:784-798
   * @reference reference/freeciv/server/plrhand.c:2305-2364
   * @assertion The contact effect has no target when no player owns Marco Polo's Embassy, and eliminated players are excluded from an owner's automatic contact list.
   * @c2c3-surface diplomacy-espionage
   * @c2c3-surface-scenario boundary
   */
  it('keeps non-owners and eliminated players outside c2c3 effect contacts', async () => {
    rows.push({ ...createPlayer('p3', 2), isAlive: false });
    useCiv2Civ3ContactEffects(new Set());

    await manager.applyEffectContacts('game-1');
    expect((await manager.getSnapshot('game-1', 'p1')).nations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'p2', known: false, canMeet: false }),
        expect.objectContaining({ id: 'p3', known: false, canMeet: false }),
      ])
    );

    useCiv2Civ3ContactEffects(new Set(['p1']));
    await manager.applyEffectContacts('game-1');
    expect((await manager.getSnapshot('game-1', 'p1')).nations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'p2', known: true, canMeet: true }),
        expect.objectContaining({ id: 'p3', known: false, canMeet: false }),
      ])
    );
  });

  it('returns a stable omniscient replay snapshot without volatile proposal metadata', async () => {
    await manager.establishContact('game-1', 'p1', 'p2');
    await manager.proposeTreaty('game-1', 'p1', 'p2', [{ type: 'peace' }], 'replay-request');

    const first = await manager.getReplaySnapshot('game-1');
    const second = await manager.getReplaySnapshot('game-1');
    const firstRelation = first.players[0]!.relations[0]!;

    expect(second).toEqual(first);
    expect(first.players).toHaveLength(2);
    expect(firstRelation).toMatchObject({
      playerId: 'p2',
      state: 'war',
      contactTurnsLeft: 20,
      proposal: {
        proposerId: 'p1',
        recipientId: 'p2',
        clauses: [{ type: 'peace', giverId: 'p1' }],
        status: 'pending',
      },
    });
    expect(firstRelation.proposal).not.toHaveProperty('id');
    expect(firstRelation.proposal).not.toHaveProperty('createdAt');
  });

  it('deduplicates proposal request IDs and applies bilateral and directional clauses', async () => {
    await manager.establishContact('game-1', 'p1', 'p2');
    const proposal = await manager.proposeTreaty(
      'game-1',
      'p1',
      'p2',
      [{ type: 'peace' }, { type: 'shared_vision' }],
      'request-1'
    );
    const duplicate = await manager.proposeTreaty(
      'game-1',
      'p1',
      'p2',
      [{ type: 'peace' }],
      'request-1'
    );
    expect(duplicate.id).toBe(proposal.id);

    await manager.respondToTreaty('game-1', 'p2', 'p1', proposal.id, true);

    expect((await manager.getSnapshot('game-1', 'p1')).nations[0].relation).toMatchObject({
      state: 'armistice',
      turnsLeft: 16,
      sharedVision: false,
      proposal: { status: 'accepted' },
    });
    expect((await manager.getSnapshot('game-1', 'p2')).nations[0].relation).toMatchObject({
      state: 'armistice',
      turnsLeft: 16,
      sharedVision: true,
      proposal: { status: 'accepted' },
    });
  });

  it('makes war immediate, cancels a pending meeting, and revokes shared vision', async () => {
    await manager.establishContact('game-1', 'p1', 'p2');
    const proposal = await manager.proposeTreaty(
      'game-1',
      'p1',
      'p2',
      [{ type: 'shared_vision' }],
      'vision'
    );
    await manager.respondToTreaty('game-1', 'p2', 'p1', proposal.id, true);
    await manager.proposeTreaty('game-1', 'p1', 'p2', [{ type: 'peace' }], 'peace');

    await manager.declareWar('game-1', 'p2', 'p1');

    const snapshot = await manager.getSnapshot('game-1', 'p1');
    expect(snapshot.nations[0].relation).toMatchObject({
      state: 'war',
      sharedVision: false,
      proposal: { status: 'cancelled' },
    });
  });

  it('executes C2C3 material clauses when the recipient accepts', async () => {
    await manager.establishContact('game-1', 'p1', 'p2');
    const executeTransfers = jest.fn().mockResolvedValue(undefined);
    manager.setTransferExecutor(executeTransfers);
    const clauses = [
      { type: 'technology' as const, techId: 'alphabet' },
      { type: 'gold' as const, amount: 50 },
      { type: 'map' as const },
      { type: 'seamap' as const },
      { type: 'city' as const, cityId: 'rome' },
    ];
    const proposal = await manager.proposeTreaty('game-1', 'p1', 'p2', clauses);

    await manager.respondToTreaty('game-1', 'p2', 'p1', proposal.id, true);

    expect(executeTransfers).toHaveBeenCalledWith(
      'game-1',
      'p1',
      'p2',
      clauses.map(clause => ({ ...clause, giverId: 'p1' }))
    );
    expect((await manager.getSnapshot('game-1', 'p1')).nations[0].relation.proposal).toEqual(
      expect.objectContaining({ status: 'accepted' })
    );
  });

  it('serializes simultaneous meetings for the same pair', async () => {
    await manager.establishContact('game-1', 'p1', 'p2');
    const results = await Promise.allSettled([
      manager.proposeTreaty('game-1', 'p1', 'p2', [{ type: 'peace' }], 'from-p1'),
      manager.proposeTreaty('game-1', 'p2', 'p1', [{ type: 'ceasefire' }], 'from-p2'),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await manager.getSnapshot('game-1', 'p1')).toEqual(
      expect.objectContaining({
        nations: [
          expect.objectContaining({
            relation: expect.objectContaining({
              proposal: expect.objectContaining({ status: 'pending' }),
            }),
          }),
        ],
      })
    );
  });

  it('lets the C2C3 Democracy senate block an unprovoked treaty break', async () => {
    rows[0].government = 'democracy';
    await manager.establishContact('game-1', 'p1', 'p2');
    const proposal = await manager.proposeTreaty(
      'game-1',
      'p1',
      'p2',
      [{ type: 'peace' }],
      'peace'
    );
    await manager.respondToTreaty('game-1', 'p2', 'p1', proposal.id, true);

    await expect(manager.declareWar('game-1', 'p1', 'p2')).rejects.toThrow('senate refuses');
  });

  it('prohibits treaties and embassies with the C2C3 Barbarian nation group', async () => {
    rows[1].nation = 'barbarian';
    rows[1].civilization = 'barbarian';

    await expect(manager.proposeTreaty('game-1', 'p1', 'p2', [{ type: 'peace' }])).rejects.toThrow(
      'Diplomacy is not possible'
    );
    await expect(manager.establishEmbassy('game-1', 'p1', 'p2')).rejects.toThrow(
      'Diplomacy is not possible'
    );
  });

  it('requires first contact before disclosing identities or allowing negotiations', async () => {
    const snapshot = await manager.getSnapshot('game-1', 'p1');
    expect(snapshot.nations[0]).toMatchObject({
      known: false,
      canMeet: false,
      civilization: 'unknown',
      leaderName: 'Unknown leader',
    });
    await expect(
      manager.proposeTreaty('game-1', 'p1', 'p2', [{ type: 'ceasefire' }])
    ).rejects.toThrow('contact or an embassy');
  });

  it('advances armistices to peace and expires ceasefires into war', async () => {
    await manager.establishContact('game-1', 'p1', 'p2');
    const peace = await manager.proposeTreaty('game-1', 'p1', 'p2', [{ type: 'peace' }]);
    await manager.respondToTreaty('game-1', 'p2', 'p1', peace.id, true);
    for (let turn = 0; turn < 16; turn += 1) await manager.processTurn('game-1');
    expect((await manager.getSnapshot('game-1', 'p1')).nations[0].relation).toMatchObject({
      state: 'peace',
      turnsLeft: 0,
    });

    await manager.declareWar('game-1', 'p1', 'p2');
    const ceasefire = await manager.proposeTreaty('game-1', 'p1', 'p2', [{ type: 'ceasefire' }]);
    await manager.respondToTreaty('game-1', 'p2', 'p1', ceasefire.id, true);
    for (let turn = 0; turn < 16; turn += 1) await manager.processTurn('game-1');
    expect((await manager.getSnapshot('game-1', 'p1')).nations[0].relation.state).toBe('war');
  });

  it('rolls material transfers back when accepted-state persistence fails', async () => {
    await manager.establishContact('game-1', 'p1', 'p2');
    const rollback = jest.fn().mockResolvedValue(undefined);
    manager.setTransferExecutor(jest.fn().mockResolvedValue(rollback));
    const proposal = await manager.proposeTreaty('game-1', 'p1', 'p2', [
      { type: 'gold', amount: 25 },
    ]);
    failUpdates = true;

    await expect(manager.respondToTreaty('game-1', 'p2', 'p1', proposal.id, true)).rejects.toThrow(
      'persistence failed'
    );
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('treats team relations as permanent and non-hostile', async () => {
    rows[0].teamId = 'team-1';
    rows[1].teamId = 'team-1';
    expect((await manager.getSnapshot('game-1', 'p1')).nations[0]).toMatchObject({
      known: true,
      relation: { state: 'team' },
    });
    await expect(manager.declareWar('game-1', 'p1', 'p2')).rejects.toThrow('teammate');
    await expect(
      manager.proposeTreaty('game-1', 'p1', 'p2', [{ type: 'alliance' }])
    ).rejects.toThrow('Teammates');
  });

  it('downgrades alliances to armistice and tracks justified cancellation incidents', async () => {
    const eventSink = jest.fn();
    manager.setEventSink(eventSink);
    await manager.establishContact('game-1', 'p1', 'p2');
    const alliance = await manager.proposeTreaty('game-1', 'p1', 'p2', [{ type: 'alliance' }]);
    await manager.respondToTreaty('game-1', 'p2', 'p1', alliance.id, true);
    await manager.cancelPact('game-1', 'p1', 'p2');
    expect((await manager.getSnapshot('game-1', 'p1')).nations[0].relation).toMatchObject({
      state: 'armistice',
      turnsLeft: 16,
    });

    rows[0].government = 'republic';
    await manager.recordIncident('game-1', 'p2', 'p1');
    const victimView = (await manager.getSnapshot('game-1', 'p1')).nations[0].relation;
    expect(victimView).toMatchObject({
      reputation: 900,
      attitude: -100,
      hasReasonToCancel: 2,
    });
    expect(eventSink).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'incident',
        playerIds: ['p2', 'p1'],
        offenderId: 'p2',
        victimId: 'p1',
        severity: 100,
      })
    );
    await expect(manager.cancelPact('game-1', 'p1', 'p2')).resolves.toBeUndefined();
    expect(eventSink).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'war_declared',
        playerIds: ['p1', 'p2'],
        justified: true,
      })
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3985-4109
   * @reference reference/freeciv/common/player.c:1652-1689
   * @reference reference/freeciv/server/actiontools.c:115-203
   * @assertion C2C3 grants the victim a treaty-cancellation reason only when the exact covert-action source and outcome have a Casus_Belli effect; the same caught Bribe Unit at war has no effect.
   * @c2c3-surface diplomacy-espionage
   * @c2c3-surface-scenario normal, boundary
   */
  it('applies C2C3 action casus belli only for configured sources outside war', async () => {
    manager = new DiplomacyManager(
      { getDatabase: () => database } as any,
      () => 7,
      () => new Set(),
      new EffectsManager('civ2civ3')
    );

    await expect(
      manager.recordActionCasusBelli('game-1', 'p2', 'p1', {
        sourceAction: 'Targeted Steal Tech Escape Expected',
        outcome: 'success',
        context: { diplomaticRelations: new Set(['Foreign']) },
        severity: 143,
      })
    ).resolves.toBe(true);
    expect((await manager.getSnapshot('game-1', 'p1')).nations[0]?.relation).toMatchObject({
      hasReasonToCancel: 2,
      reputation: 857,
      attitude: -143,
    });

    await expect(
      manager.recordActionCasusBelli('game-1', 'p2', 'p1', {
        sourceAction: 'Bribe Unit',
        outcome: 'caught',
        context: { diplomaticRelations: new Set(['Foreign']) },
        severity: 143,
      })
    ).resolves.toBe(true);
    const beforeWarAttempt = (await manager.getSnapshot('game-1', 'p1')).nations[0]?.relation;

    await expect(
      manager.recordActionCasusBelli('game-1', 'p2', 'p1', {
        sourceAction: 'Bribe Unit',
        outcome: 'caught',
        context: { diplomaticRelations: new Set(['Foreign', 'War']) },
        severity: 143,
      })
    ).resolves.toBe(false);
    expect((await manager.getSnapshot('game-1', 'p1')).nations[0]?.relation).toEqual(
      beforeWarAttempt
    );

    await expect(
      manager.recordActionCasusBelli('game-1', 'p2', 'p1', {
        sourceAction: 'Sabotage City Escape',
        outcome: 'success',
        context: { diplomaticRelations: new Set(['Foreign']) },
        severity: 143,
      })
    ).resolves.toBe(false);
  });

  it('supports repeated material types and contributions from both parties', async () => {
    await manager.establishContact('game-1', 'p1', 'p2');
    const executeTransfers = jest.fn().mockResolvedValue(undefined);
    manager.setTransferExecutor(executeTransfers);
    const clauses = [
      { type: 'technology' as const, techId: 'alphabet', giverId: 'p1' },
      { type: 'technology' as const, techId: 'writing', giverId: 'p1' },
      { type: 'gold' as const, amount: 25, giverId: 'p2' },
    ];
    const proposal = await manager.proposeTreaty('game-1', 'p1', 'p2', clauses);
    await manager.respondToTreaty('game-1', 'p2', 'p1', proposal.id, true);
    expect(executeTransfers).toHaveBeenCalledWith('game-1', 'p1', 'p2', clauses);
  });
});
