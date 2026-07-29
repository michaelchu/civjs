import { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';

describe('DiplomacyHostilityPolicy', () => {
  it('treats only war relations as hostile', async () => {
    const diplomacyManager = {
      getSnapshot: jest.fn().mockResolvedValue({
        nations: [
          { id: 'enemy', relation: { state: 'war' } },
          { id: 'ally', relation: { state: 'alliance' } },
          { id: 'neutral', relation: { state: 'peace' } },
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
    });
  });
});
