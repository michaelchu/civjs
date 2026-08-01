import { UnitManagementService } from '@game/services/UnitManagementService';

describe('UnitManagementService combat presentation', () => {
  it('publishes pre-destruction combatants with final health values', async () => {
    const attacker = {
      id: 'attacker-1',
      playerId: 'player-1',
      unitTypeId: 'warriors',
      x: 0,
      y: 0,
      health: 100,
      movementLeft: 3,
      veteranLevel: 0,
      fortified: false,
    };
    const defender = {
      id: 'defender-1',
      playerId: 'player-2',
      unitTypeId: 'warriors',
      x: 1,
      y: 0,
      health: 100,
      movementLeft: 3,
      veteranLevel: 0,
      fortified: false,
    };
    let combatResolved = false;
    const broadcastCombatOccurred = jest.fn();
    const gameInstance = {
      state: 'active',
      players: new Map([
        ['player-1', {}],
        ['player-2', {}],
      ]),
      unitManager: {
        getUnit: (id: string) => {
          if (id === attacker.id) return attacker;
          return combatResolved ? undefined : defender;
        },
        getUnitsAt: () => [defender],
        getUnitType: () => ({ name: 'Warriors' }),
        attackUnit: async () => {
          combatResolved = true;
          return {
            attackerId: attacker.id,
            defenderId: defender.id,
            attackerDamage: 0,
            defenderDamage: 100,
            attackerDestroyed: false,
            defenderDestroyed: true,
          };
        },
      },
      visibilityManager: { onUnitDestroyed: jest.fn() },
    };
    const service = new UnitManagementService(new Map([['game-1', gameInstance as any]]), {
      broadcastUnitInfo: jest.fn(),
      broadcastUnitDestroyed: jest.fn(),
      broadcastCombatOccurred,
    });

    await service.attackUnit('game-1', 'player-1', attacker.id, defender.id);

    expect(broadcastCombatOccurred).toHaveBeenCalledWith(
      'game-1',
      expect.objectContaining({
        style: 'swords',
        combatants: expect.arrayContaining([
          expect.objectContaining({ id: attacker.id, hpBefore: 100, hpAfter: 100 }),
          expect.objectContaining({
            id: defender.id,
            hpBefore: 100,
            hpAfter: 0,
            destroyed: true,
          }),
        ]),
      })
    );
  });
});
