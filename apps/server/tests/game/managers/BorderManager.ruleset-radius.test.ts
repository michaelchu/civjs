import { BorderManager } from '@game/managers/BorderManager';
import { EffectType } from '@game/managers/EffectsManager';

describe('BorderManager C2C3 population-driven territory', () => {
  it('uses the configured C2C3 base radius plus the capped city-size effect', () => {
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
      calculateEffect: jest.fn((effectType: EffectType) => ({
        value: effectType === EffectType.TILE_CLAIMABLE ? 1 : 0,
        effects: [],
      })),
    };
    const manager = new BorderManager(
      mapManager as any,
      cityManager as any,
      effectsManager as any,
      {
        borderCityRadiusSq: 2,
        borderSizeEffect: 1,
      }
    );
    const onBorderUpdate = jest.fn();
    manager.setCallbacks({ onBorderUpdate });

    manager.addCityBorderSource(city);

    expect(
      manager.getAllTileOwnership().filter(tile => tile.playerId === city.playerId)
    ).toHaveLength(9);
    expect(tiles.get('3,3').owner).toBe(city.playerId);
    expect(tiles.get('2,4').owner).toBeUndefined();

    city.size = 3;
    const update = manager.recalculateAllBorders();

    expect(
      manager.getAllTileOwnership().filter(tile => tile.playerId === city.playerId)
    ).toHaveLength(21);
    expect(tiles.get('2,4').owner).toBe(city.playerId);
    expect(update.tiles).toHaveLength(20);
    expect(onBorderUpdate).toHaveBeenCalledTimes(2);
  });
});
