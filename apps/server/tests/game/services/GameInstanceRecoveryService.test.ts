import { GameInstanceRecoveryService } from '@game/services/GameInstanceRecoveryService';

describe('GameInstanceRecoveryService map deserialization', () => {
  it('restores the current column-major array tile format', () => {
    const recoveryService = new GameInstanceRecoveryService(
      {} as any,
      new Map(),
      new Map(),
      {} as any,
      jest.fn(),
      jest.fn(),
      jest.fn(),
      {} as any
    );

    const tiles = (recoveryService as any).deserializeMapTiles(
      [
        [
          { x: 0, y: 0, terrain: 'grassland', altitude: 12, riverMask: 1 },
          { x: 0, y: 1, terrain: 'plains', altitude: 8 },
        ],
        [
          { x: 1, y: 0, terrain: 'forest', altitude: 16 },
          { x: 1, y: 1, terrain: 'ocean', altitude: 0 },
        ],
      ],
      2,
      2
    );

    expect(tiles[0][0]).toMatchObject({ terrain: 'grassland', altitude: 12, riverMask: 1 });
    expect(tiles[0][1]).toMatchObject({ terrain: 'plains', altitude: 8 });
    expect(tiles[1][0]).toMatchObject({ terrain: 'forest', altitude: 16 });
  });

  it('restores authoritative unit statistics into runtime players', () => {
    const playerToGame = new Map<string, string>();
    const recoveryService = new GameInstanceRecoveryService(
      {} as any,
      new Map(),
      playerToGame,
      {} as any,
      jest.fn(),
      jest.fn(),
      jest.fn(),
      {} as any
    );

    const players = (recoveryService as any).buildPlayersMap(
      {
        players: [
          {
            id: 'player-1',
            playerNumber: 0,
            isAI: false,
            unitsBuilt: 7,
            unitsKilled: 3,
            unitsLost: 2,
          },
          { id: 'player-2', playerNumber: 1, isAI: false },
        ],
      },
      'game-1'
    );

    expect(players.get('player-1')).toMatchObject({ unitsBuilt: 7, unitsKilled: 3, unitsLost: 2 });
    expect(players.get('player-2')).toMatchObject({ unitsBuilt: 0, unitsKilled: 0, unitsLost: 0 });
    expect(playerToGame).toEqual(
      new Map([
        ['player-1', 'game-1'],
        ['player-2', 'game-1'],
      ])
    );
  });
});
