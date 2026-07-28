import { GovernmentManager, getGovernments } from '@game/managers/GovernmentManager';
import { TECHNOLOGIES } from '@game/managers/ResearchManager';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('GovernmentManager classic progression', () => {
  it('unlocks every selectable classic government through the technology tree', () => {
    const manager = new GovernmentManager('game-1', createMockDatabaseProvider());
    const allTechnologies = new Set(Object.keys(TECHNOLOGIES));

    const availability = manager.getAvailableGovernments(allTechnologies);

    expect(availability).toHaveLength(Object.keys(getGovernments()).length);
    expect(
      availability.filter(entry => entry.id !== 'anarchy').every(entry => entry.available)
    ).toBe(true);
  });

  it('uses the Freeciv default random one-to-five-turn revolution length', async () => {
    const manager = new GovernmentManager(
      'game-1',
      createMockDatabaseProvider(),
      undefined,
      () => 0.999
    );
    await manager.initializePlayerGovernment('player-1');

    const result = await manager.startRevolution('player-1', 'monarchy', new Set(['monarchy']), 12);

    expect(result).toEqual({
      success: true,
      message: 'Revolution started. 5 turns of Anarchy remaining.',
    });
    expect(manager.getPlayerGovernment('player-1')).toMatchObject({
      currentGovernment: 'anarchy',
      requestedGovernment: 'monarchy',
      revolutionTurns: 5,
    });
  });
});
