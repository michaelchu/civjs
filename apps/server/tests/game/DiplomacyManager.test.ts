import { DiplomacyManager } from '@game/managers/DiplomacyManager';

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
  knownPlayers: [],
  diplomaticRelations: {},
});

describe('DiplomacyManager', () => {
  let rows: ReturnType<typeof createPlayer>[];
  let manager: DiplomacyManager;

  beforeEach(() => {
    rows = [createPlayer('p1', 0), createPlayer('p2', 1)];
    const database = {
      query: {
        players: {
          findMany: jest.fn(async () => rows),
        },
      },
      update: jest.fn(() => ({
        set: (data: any) => ({
          where: async () => {
            const relationTarget = Object.keys(data.diplomaticRelations)[0];
            const row = rows.find(candidate => candidate.id !== relationTarget)!;
            Object.assign(row, data);
          },
        }),
      })),
    };
    manager = new DiplomacyManager({ getDatabase: () => database } as any, () => 7);
  });

  it('persists bilateral contact and returns nation intelligence', async () => {
    await manager.establishContact('game-1', 'p1', 'p2');

    const first = await manager.getSnapshot('game-1', 'p1');
    const second = await manager.getSnapshot('game-1', 'p2');
    expect(first.nations[0]).toMatchObject({ id: 'p2', known: true, isAI: true });
    expect(second.nations[0]).toMatchObject({ id: 'p1', known: true });
  });

  it('deduplicates proposal request IDs and applies accepted clauses to both players', async () => {
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

    for (const playerId of ['p1', 'p2']) {
      const snapshot = await manager.getSnapshot('game-1', playerId);
      expect(snapshot.nations[0].relation).toMatchObject({
        state: 'peace',
        sharedVision: true,
        proposal: { status: 'accepted' },
      });
    }
  });

  it('makes war immediate, cancels a pending meeting, and revokes shared vision', async () => {
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

  it('executes classic material clauses when the recipient accepts', async () => {
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

    expect(executeTransfers).toHaveBeenCalledWith('game-1', 'p1', 'p2', clauses);
    expect((await manager.getSnapshot('game-1', 'p1')).nations[0].relation.proposal).toEqual(
      expect.objectContaining({ status: 'accepted' })
    );
  });

  it('serializes simultaneous meetings for the same pair', async () => {
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

  it('lets the classic senate block an unprovoked treaty break', async () => {
    rows[0].government = 'republic';
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

  it('prohibits treaties and embassies with the classic Barbarian nation group', async () => {
    rows[1].nation = 'barbarian';
    rows[1].civilization = 'barbarian';

    await expect(manager.proposeTreaty('game-1', 'p1', 'p2', [{ type: 'peace' }])).rejects.toThrow(
      'Diplomacy is not possible'
    );
    await expect(manager.establishEmbassy('game-1', 'p1', 'p2')).rejects.toThrow(
      'Diplomacy is not possible'
    );
  });
});
