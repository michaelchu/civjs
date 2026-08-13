import { describe, expect, it, vi } from 'vitest';
import { TerrainRenderer } from '../renderers/TerrainRenderer';
import type { RenderState } from '../renderers/BaseRenderer';
import type { TerrainCompositionProfile } from '../tilesets/TilesetProvider';

describe('TerrainRenderer fog-edge neighbors', () => {
  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:597-610
   * @assertion The pinned browser leaves MATCH_PAIR corner composition
   * unfinished and returns no sprites; provider metadata must not silently
   * introduce a different result.
   */
  it('preserves the pinned browser MATCH_PAIR behavior without script globals', () => {
    const renderer = new TerrainRenderer({} as CanvasRenderingContext2D, {} as never, 96, 48);
    const pairLayer = {
      matchStyle: 2,
      spriteType: 1,
      matchIndices: 2,
      matchIndex: [0, 2],
      dither: false,
      matchType: 'shallow',
      matchWith: ['land'],
    };
    const profile: TerrainCompositionProfile = {
      mode: 'legacy-cellgroup',
      matchTypes: [['shallow', 'deep', 'land']],
      terrains: {
        lake: { numLayers: 1, blendLayer: 0, layers: [pairLayer] },
        land: {
          numLayers: 1,
          blendLayer: 0,
          layers: [{ ...pairLayer, matchIndex: [2, 2], matchType: 'land' }],
        },
      },
      cellgroupMap: {},
    };
    const sprites = (
      renderer as unknown as {
        fillTerrainSpriteArray: (
          layer: number,
          composition: TerrainCompositionProfile,
          graphic: string,
          neighbors: string[]
        ) => Array<{ key: string }>;
      }
    ).fillTerrainSpriteArray(0, profile, 'lake', [
      'lake',
      'lake',
      'lake',
      'land',
      'lake',
      'lake',
      'lake',
      'lake',
    ]);

    expect(sprites).toEqual([]);
  });

  it('draws terrain layer-first across the visible tile set', () => {
    const drawOrder: string[] = [];
    const context = {
      canvas: { width: 800, height: 600 },
      drawImage: vi.fn((sprite: { key: string }) => drawOrder.push(sprite.key)),
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const renderer = new TerrainRenderer(
      context,
      {
        getSprite: (key: string) => ({ key }),
        getTerrainComposition: () => null,
        getGeometry: () => ({
          tileWidth: 96,
          tileHeight: 48,
          fullTileWidth: 96,
          fullTileHeight: 48,
          hexWidth: 0,
          hexHeight: 0,
        }),
      } as never,
      96,
      48
    );
    (
      renderer as unknown as {
        fillTerrainSpriteArraySimple: (
          layer: number,
          tile: { x: number }
        ) => Array<{ key: string }>;
      }
    ).fillTerrainSpriteArraySimple = (layer, tile) => [{ key: `${layer}:${tile.x}` }];
    const tiles = [
      { x: 0, y: 0, terrain: 'plains', known: true, visible: true },
      { x: 1, y: 0, terrain: 'grassland', known: true, visible: true },
    ];

    renderer.renderTerrain(
      {
        viewport: { x: 0, y: 0, width: 800, height: 600 },
        map: {
          width: 2,
          height: 1,
          tiles: Object.fromEntries(tiles.map(tile => [`${tile.x},${tile.y}`, tile])),
        },
        units: {},
        cities: {},
        players: {},
      },
      tiles
    );

    expect(drawOrder).toEqual(['0:0', '0:1', '1:0', '1:1', '2:0', '2:1']);
  });

  it('extends the current terrain into unknown neighbors like Freeciv', () => {
    const renderer = new TerrainRenderer({} as CanvasRenderingContext2D, {} as never, 96, 48);
    renderer.invalidateTileCache({
      '1,1': { x: 1, y: 1, terrain: 'grassland', known: true, visible: true },
      '1,0': { x: 1, y: 0, terrain: 'unknown', known: false, visible: false },
      '2,1': { x: 2, y: 1, terrain: 'plains', known: true, visible: false },
    });
    const neighbors = (
      renderer as unknown as {
        getNeighboringTerrains(tile: {
          x: number;
          y: number;
          terrain: string;
        }): Array<{ graphic_str: string }>;
      }
    ).getNeighboringTerrains({ x: 1, y: 1, terrain: 'grassland' });

    expect(neighbors[0].graphic_str).toBe('grassland');
    expect(neighbors[4].graphic_str).toBe('plains');
  });

  it('steps logical terrain neighbors through the native ISO-hex grid', () => {
    const renderer = new TerrainRenderer({} as CanvasRenderingContext2D, {} as never, 96, 48);
    const state = {
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      map: {
        width: 32,
        height: 64,
        xsize: 32,
        ysize: 64,
        topology_id: 3,
        wrap_id: 3,
        tiles: {},
      },
      units: {},
      cities: {},
      players: {},
    } satisfies RenderState;
    renderer.invalidateTileCache({
      '10,10': { x: 10, y: 10, terrain: 'grassland', known: true, visible: true },
      // Logical east from native (10,10) is native (10,11) on ISO-hex maps.
      '10,11': { x: 10, y: 11, terrain: 'plains', known: true, visible: true },
      '11,10': { x: 11, y: 10, terrain: 'desert', known: true, visible: true },
    });
    (
      renderer as unknown as {
        setMapTopology(candidate: RenderState): void;
      }
    ).setMapTopology(state);

    const neighbors = (
      renderer as unknown as {
        getNeighboringTerrains(tile: {
          x: number;
          y: number;
          terrain: string;
        }): Array<{ graphic_str: string }>;
      }
    ).getNeighboringTerrains({ x: 10, y: 10, terrain: 'grassland' });

    expect(neighbors[4].graphic_str).toBe('plains');
  });

  it('preserves the browser ISO edge adjustment for diagonal neighbors', () => {
    const renderer = new TerrainRenderer({} as CanvasRenderingContext2D, {} as never, 96, 48);
    const state = {
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      map: {
        width: 3,
        height: 3,
        xsize: 3,
        ysize: 3,
        topology_id: 1,
        wrap_id: 0,
        tiles: {},
      },
      units: {},
      cities: {},
      players: {},
    } satisfies RenderState;
    const edgeTiles = {
      '0,0': { x: 0, y: 0, terrain: 'grassland', known: true, visible: true },
      '2,0': { x: 2, y: 0, terrain: 'desert', known: true, visible: true },
      '2,1': { x: 2, y: 1, terrain: 'mountains', known: true, visible: true },
      '0,2': { x: 0, y: 2, terrain: 'plains', known: true, visible: true },
    };
    renderer.invalidateTileCache(edgeTiles);
    (renderer as unknown as { buildTileMap(): void }).buildTileMap();
    (
      renderer as unknown as {
        setMapTopology(candidate: RenderState): void;
        getDirectionalNeighborTile(
          tile: { x: number; y: number },
          dx: number,
          dy: number
        ): { x: number; y: number } | undefined;
      }
    ).setMapTopology(state);

    const getNeighbor = (tile: { x: number; y: number }, dx: number, dy: number) =>
      (
        renderer as unknown as {
          getDirectionalNeighborTile(
            tile: { x: number; y: number },
            dx: number,
            dy: number
          ): { x: number; y: number } | undefined;
        }
      ).getDirectionalNeighborTile(tile, dx, dy);

    expect(getNeighbor({ x: 0, y: 0 }, -1, 0)).toMatchObject({ x: 2, y: 0 });
    expect(getNeighbor({ x: 0, y: 0 }, -1, 1)).toMatchObject({ x: 2, y: 1 });
    expect(getNeighbor({ x: 2, y: 0 }, 1, 0)).toMatchObject({ x: 0, y: 0 });
  });
});
