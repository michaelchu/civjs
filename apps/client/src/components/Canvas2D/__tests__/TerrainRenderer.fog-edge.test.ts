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
      mixedNeighbors[6] = { graphic_str: 'land' };
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
    expect(neighbors[2].graphic_str).toBe('plains');
    expect(neighbors[4].graphic_str).toBe('grassland');
  });

  it('pads ocean across the full canvas when viewport dimensions lag', () => {
    const context = {
      canvas: { width: 500, height: 300 },
    } as unknown as CanvasRenderingContext2D;
    const renderer = new TerrainRenderer(context, {} as never, 96, 48);
    const renderedPositions: Array<{ x: number; y: number }> = [];
    (
      renderer as unknown as {
        renderTerrainLayers: (tile: unknown, screenPosition: { x: number; y: number }) => void;
      }
    ).renderTerrainLayers = vi.fn((_tile, screenPosition) => {
      renderedPositions.push(screenPosition);
    });

    renderer.renderOceanPadding({
      viewport: { x: 0, y: 0, width: 100, height: 100 },
      map: { width: 1, height: 1, xsize: 1, ysize: 1, tiles: {} },
      units: {},
      cities: {},
      players: {},
    } satisfies RenderState);

    expect(Math.max(...renderedPositions.map(position => position.x))).toBeGreaterThan(100);
    expect(Math.max(...renderedPositions.map(position => position.y))).toBeGreaterThan(100);
  });
});
