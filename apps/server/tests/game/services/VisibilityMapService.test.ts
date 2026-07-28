import { VisibilityMapService } from '@game/services/VisibilityMapService';

describe('VisibilityMapService', () => {
  it('returns only currently visible tiles instead of live data around the starting position', () => {
    const hiddenStartTile = {
      x: 1,
      y: 1,
      terrain: 'grassland',
      resource: 'wheat',
      unitIds: ['enemy-unit'],
    };
    const visibleTile = {
      x: 4,
      y: 3,
      terrain: 'plains',
      resource: undefined,
      elevation: 10,
      riverMask: 0,
      continentId: 1,
      hasRoad: false,
      hasRailroad: false,
      improvements: [],
      cityId: undefined,
      unitIds: [],
      owner: undefined,
      claimer: undefined,
    };
    const updatePlayerVisibility = jest.fn();
    const game = {
      mapManager: {
        getMapData: () => ({
          width: 5,
          height: 5,
          startingPositions: [{ playerId: 'player-1', x: 1, y: 1 }],
        }),
        getTile: (x: number, y: number) => {
          if (x === 1 && y === 1) return hiddenStartTile;
          if (x === 4 && y === 3) return visibleTile;
          return null;
        },
      },
      visibilityManager: {
        updatePlayerVisibility,
        getVisibleTiles: () => new Set(['4,3']),
      },
    } as any;
    const service = new VisibilityMapService(new Map([['game-1', game]]));

    const tiles = service.getPlayerVisibleTiles('game-1', 'player-1');

    expect(updatePlayerVisibility).toHaveBeenCalledWith('player-1');
    expect(tiles).toEqual([expect.objectContaining({ x: 4, y: 3, terrain: 'plains' })]);
    expect(tiles).not.toContainEqual(expect.objectContaining({ x: 1, y: 1 }));
  });
});
