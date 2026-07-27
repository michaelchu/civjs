import { BorderManager } from '@game/managers/BorderManager';
import { calculateCityBorderRadiusSq } from '@game/constants/BorderConstants';

describe('BorderManager culture-driven territory', () => {
  it.each([
    [0, 2],
    [9, 2],
    [10, 5],
    [99, 5],
    [100, 10],
    [1_000, 17],
    [10_000, 26],
  ])('maps %i accumulated culture to radius squared %i', (culture, expectedRadiusSq) => {
    expect(calculateCityBorderRadiusSq(culture)).toBe(expectedRadiusSq);
  });

  it('claims one surrounding tile initially and expands after a culture milestone', () => {
    const tiles = new Map<string, any>();
    for (let x = 0; x < 9; x++) {
      for (let y = 0; y < 9; y++) {
        tiles.set(`${x},${y}`, { x, y, terrain: 'grassland' });
      }
    }

    const city = {
      id: 'city-1',
      x: 4,
      y: 4,
      playerId: 'player-1',
      size: 1,
      history: 0,
      buildings: [],
    };
    const mapManager = {
      getMapData: jest.fn(() => ({ width: 9, height: 9 })),
      getTile: jest.fn((x: number, y: number) => tiles.get(`${x},${y}`)),
    };
    const cityManager = {
      getCityAt: jest.fn((x: number, y: number) =>
        x === city.x && y === city.y ? city : undefined
      ),
    };
    const effectsManager = {
      calculateEffect: jest.fn(() => ({ value: 0, effects: [] })),
    };
    const manager = new BorderManager(mapManager as any, cityManager as any, effectsManager as any);
    const onBorderUpdate = jest.fn();
    manager.setCallbacks({ onBorderUpdate });

    manager.addCityBorderSource(city);

    expect(
      manager.getAllTileOwnership().filter(tile => tile.playerId === city.playerId)
    ).toHaveLength(9);
    expect(tiles.get('3,3').owner).toBe(city.playerId);
    expect(tiles.get('2,4').owner).toBeUndefined();

    city.history = 10;
    const update = manager.recalculateAllBorders();

    expect(
      manager.getAllTileOwnership().filter(tile => tile.playerId === city.playerId)
    ).toHaveLength(21);
    expect(tiles.get('2,4').owner).toBe(city.playerId);
    expect(update.tiles).toHaveLength(12);
    expect(onBorderUpdate).toHaveBeenCalledTimes(2);
  });
});
