import { describe, expect, it, vi } from 'vitest';
import { TerrainRenderer } from '../renderers/TerrainRenderer';
import type { RenderState } from '../renderers/BaseRenderer';

describe('TerrainRenderer fog-edge neighbors', () => {
  it('selects the generated lake corner sprites for MATCH_PAIR', () => {
    const globals = window as unknown as Record<string, unknown>;
    const previous = {
      tile_types_setup: globals.tile_types_setup,
      ts_layer: globals.ts_layer,
      ts_tiles: globals.ts_tiles,
      cellgroup_map: globals.cellgroup_map,
    };
    globals.tile_types_setup = {
      'l0.lake': {
        match_style: 2,
        sprite_type: 1,
        match_indices: 2,
        match_index: [0, 2],
      },
    };
    globals.ts_layer = [{ match_types: ['shallow', 'deep', 'land'] }];
    globals.ts_tiles = { lake: { layer0_match_type: 'shallow' } };
    globals.cellgroup_map = {};

    try {
      const renderer = new TerrainRenderer({} as CanvasRenderingContext2D, {} as never, 96, 48);
      const neighbors = Array.from({ length: 8 }, () => ({ graphic_str: 'lake' }));
      const sprites = (
        renderer as unknown as {
          fillTerrainSpriteArray: (
            layer: number,
            tile: unknown,
            terrain: { graphic_str: string },
            neighbors: Array<{ graphic_str: string }>
          ) => Array<{ key: string }>;
        }
      ).fillTerrainSpriteArray(0, {}, { graphic_str: 'lake' }, neighbors);

      expect(sprites).toHaveLength(4);
      expect(sprites.map(sprite => sprite.key)).toEqual([
        't.l0.lake_cell_u_s_s_s',
        't.l0.lake_cell_d_s_s_s',
        't.l0.lake_cell_r_s_s_s',
        't.l0.lake_cell_l_s_s_s',
      ]);

      const mixedNeighbors = Array.from({ length: 8 }, () => ({ graphic_str: 'lake' }));
      // Freeciv-web's DIR8 order is NW, N, NE, W, E, SW, S, SE.
      mixedNeighbors[3] = { graphic_str: 'land' };
      globals.tile_types_setup = {
        'l0.lake': {
          match_style: 2,
          sprite_type: 1,
          match_indices: 2,
          match_index: [0, 2],
        },
        'l0.land': { match_index: [2] },
      };
      const mixedSprites = (
        renderer as unknown as {
          fillTerrainSpriteArray: (
            layer: number,
            tile: unknown,
            terrain: { graphic_str: string },
            neighbors: Array<{ graphic_str: string }>
          ) => Array<{ key: string }>;
        }
      ).fillTerrainSpriteArray(0, {}, { graphic_str: 'lake' }, mixedNeighbors);

      expect(mixedSprites[0].key).toBe('t.l0.lake_cell_u_l_s_s');

      const unknownNeighbors = Array.from({ length: 8 }, () => ({ graphic_str: 'unconfigured' }));
      const unknownSprites = (
        renderer as unknown as {
          fillTerrainSpriteArray: (
            layer: number,
            tile: unknown,
            terrain: { graphic_str: string },
            neighbors: Array<{ graphic_str: string }>
          ) => Array<{ key: string }>;
        }
      ).fillTerrainSpriteArray(0, {}, { graphic_str: 'lake' }, unknownNeighbors);

      expect(unknownSprites[0].key).toBe('t.l0.lake_cell_u_s_s_s');
    } finally {
      Object.entries(previous).forEach(([key, value]) => {
        globals[key] = value;
      });
    }
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
      { getSprite: (key: string) => ({ key }) } as never,
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

  it('samples direct terrain neighbors from the browser map grid', () => {
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
      // Browser freeciv-web uses direct map-grid x/y for the 2D painter.
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

    expect(neighbors[4].graphic_str).toBe('desert');
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
