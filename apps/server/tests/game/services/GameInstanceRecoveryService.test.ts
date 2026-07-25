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
      jest.fn()
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
});
