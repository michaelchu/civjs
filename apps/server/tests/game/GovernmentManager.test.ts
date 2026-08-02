import { GovernmentManager, getGovernments } from '@game/managers/GovernmentManager';
import { EffectsManager } from '@game/managers/EffectsManager';
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

  /**
   * @evidence parity
   * @reference reference/freeciv/server/plrhand.c:515-525
   * @reference reference/freeciv/server/plrhand.c:576-617
   * @assertion A random revolution length selects one through the configured maximum and enters the revolution government with a target.
   */
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

  it('checks the player research provider before allowing a government change', async () => {
    const manager = new GovernmentManager('game-1', createMockDatabaseProvider());
    await manager.initializePlayerGovernment('player-1');
    manager.setPlayerTechsProvider(() => new Set());
    await expect(manager.canChangeGovernment('player-1', 'republic')).resolves.toBe(false);

    manager.setPlayerTechsProvider(() => new Set(['The Republic']));
    await expect(manager.canChangeGovernment('player-1', 'republic')).resolves.toBe(true);
  });

  it('allows an unavailable government when an Any_Government effect is active', async () => {
    const manager = new GovernmentManager(
      'game-1',
      createMockDatabaseProvider(),
      new EffectsManager('civ2civ3')
    );
    await manager.initializePlayerGovernment('player-1');
    manager.setPlayerTechsProvider(() => new Set());
    manager.setPlayerBuildingsProvider(() => new Set(['statue_of_liberty']));

    await expect(manager.canChangeGovernment('player-1', 'democracy')).resolves.toBe(true);
    await expect(
      manager.startRevolution('player-1', 'democracy', new Set())
    ).resolves.toMatchObject({
      success: true,
    });
  });

  it('selects a valid replacement when a revolution target loses its technology', async () => {
    const manager = new GovernmentManager(
      'game-1',
      createMockDatabaseProvider(),
      undefined,
      () => 0
    );
    await manager.initializePlayerGovernment('player-1');
    let technologies = new Set(['monarchy']);
    manager.setPlayerTechsProvider(() => technologies);
    await expect(
      manager.startRevolution('player-1', 'monarchy', technologies)
    ).resolves.toMatchObject({ success: true });

    technologies = new Set();
    await expect(manager.reconcileAfterTechnologyLoss('player-1')).resolves.toBe('despotism');
    expect(manager.getPlayerGovernment('player-1')).toMatchObject({
      currentGovernment: 'anarchy',
      requestedGovernment: 'despotism',
    });
  });
});
