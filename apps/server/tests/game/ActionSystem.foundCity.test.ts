import { ActionSystem } from '@game/systems/ActionSystem';
import { ActionType } from '@app-types/shared/actions';
import type { Unit } from '@game/managers/UnitManager';

const makeSettler = (id: string, x: number, y: number): Unit => ({
  id,
  gameId: 'game-1',
  playerId: 'ai-player',
  unitTypeId: 'settlers',
  x,
  y,
  health: 100,
  movementLeft: 3,
  fortified: false,
  veteranLevel: 0,
  experience: 0,
});

describe('ActionSystem - automated city names', () => {
  it('prefers the owning nation city list when available', async () => {
    const foundCity = jest.fn().mockResolvedValue('city-1');
    const actionSystem = new ActionSystem(
      'game-1',
      {
        foundCity,
        requestPath: jest.fn(),
        getCityNames: () => [],
        getPlayerNation: () => 'american',
      },
      undefined,
      'civ2civ3'
    );

    await actionSystem.executeAction(makeSettler('settler-1', 15, 12), ActionType.FOUND_CITY);

    expect(foundCity.mock.calls[0][2]).toBe('Washington');
  });

  it('assigns unused names without exposing the founding coordinates', async () => {
    const foundCity = jest.fn().mockResolvedValueOnce('city-1').mockResolvedValueOnce('city-2');
    const usedNames = ['New Rome'];
    const actionSystem = new ActionSystem('game-1', {
      foundCity,
      requestPath: jest.fn(),
      getCityNames: () => usedNames,
    });

    await expect(
      actionSystem.executeAction(makeSettler('settler-1', 15, 12), ActionType.FOUND_CITY)
    ).resolves.toMatchObject({ success: true, message: expect.stringContaining('Alexandria') });
    usedNames.push('Alexandria');
    await actionSystem.executeAction(makeSettler('settler-2', 17, 8), ActionType.FOUND_CITY);

    expect(foundCity.mock.calls.map(call => call[2])).toEqual(['Alexandria', 'Byzantium']);
    expect(foundCity.mock.calls.map(call => call[2])).not.toEqual(
      expect.arrayContaining(['New City (15,12)', 'New City (17,8)'])
    );
  });

  it('uses unique numbered fallback names after the default pool is exhausted', async () => {
    const foundCity = jest.fn().mockResolvedValue('city');
    const actionSystem = new ActionSystem('game-1', {
      foundCity,
      requestPath: jest.fn(),
      getCityNames: () => [
        'New Rome',
        'Alexandria',
        'Byzantium',
        'Carthage',
        'Babylon',
        'Memphis',
        'Thebes',
        'Damascus',
        'Antioch',
        'Palmyra',
        'New Athens',
        'Corinth',
        'Sparta',
        'Troy',
        'Marathon',
        'New York',
        'Boston',
        'Philadelphia',
        'Charleston',
        'Savannah',
        'New City 2',
      ],
    });

    await actionSystem.executeAction(makeSettler('settler-1', 1, 1), ActionType.FOUND_CITY);

    expect(foundCity).toHaveBeenCalledWith('game-1', 'ai-player', 'New City 3', 1, 1);
  });
});
