import { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';

describe('DiplomacyHostilityPolicy', () => {
  it('treats only war relations as hostile', async () => {
    const diplomacyManager = {
      getSnapshot: jest.fn().mockResolvedValue({
        nations: [
          { id: 'enemy', relation: { state: 'war' } },
          { id: 'ally', relation: { state: 'alliance' } },
          { id: 'neutral', known: false, relation: { state: 'peace' } },
        ],
      }),
    };
    const policy = new DiplomacyHostilityPolicy(diplomacyManager as any);

    await expect(policy.canAttack('game', 'player', 'enemy')).resolves.toBe(true);
    await expect(policy.canAttack('game', 'player', 'ally')).resolves.toBe(false);
    await expect(policy.canAttack('game', 'player', 'neutral')).resolves.toBe(false);
    await expect(policy.canAttack('game', 'player', 'player')).resolves.toBe(false);

    await expect(policy.getRelationPlayerIds('game', 'player')).resolves.toEqual({
      hostile: new Set(['enemy']),
      allied: new Set(['ally']),
      unknown: new Set(['neutral']),
    });
  });

  it('reuses one snapshot within an AI planning scope and refreshes after it', async () => {
    const diplomacyManager = {
      getSnapshot: jest.fn().mockResolvedValue({
        nations: [{ id: 'enemy', relation: { state: 'war' } }],
      }),
    };
    const policy = new DiplomacyHostilityPolicy(diplomacyManager as any);

    await policy.withSnapshotScope('game', 'player', async () => {
      await policy.getHostilePlayerIds('game', 'player');
      await policy.getRelationPlayerIds('game', 'player');
      await policy.getDiplomacySnapshot('game', 'player');
    });

    expect(diplomacyManager.getSnapshot).toHaveBeenCalledTimes(1);
    await policy.getHostilePlayerIds('game', 'player');
    expect(diplomacyManager.getSnapshot).toHaveBeenCalledTimes(2);
  });
});
