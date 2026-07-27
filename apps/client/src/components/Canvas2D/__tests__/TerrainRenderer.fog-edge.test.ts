import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerrainRenderer } from '../renderers/TerrainRenderer';
import type { RenderState } from '../renderers/BaseRenderer';

describe('TerrainRenderer fog-edge neighbors', () => {
  afterEach(() => {
    delete (window as unknown as { tiles?: unknown }).tiles;
  });

  it('extends the current terrain into unknown neighbors like Freeciv', () => {
    (window as unknown as { tiles: unknown[] }).tiles = [
      { x: 1, y: 1, terrain: 'grassland', known: 2 },
      { x: 1, y: 0, terrain: 'unknown', known: 0 },
      { x: 2, y: 1, terrain: 'plains', known: 1 },
    ];

    const renderer = new TerrainRenderer({} as CanvasRenderingContext2D, {} as never, 96, 48);
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
    (window as unknown as { map: { xsize: number; ysize: number } }).map = {
      xsize: 1,
      ysize: 1,
    };
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
      map: {},
      units: {},
      cities: {},
      players: {},
    } satisfies RenderState);

    expect(Math.max(...renderedPositions.map(position => position.x))).toBeGreaterThan(100);
    expect(Math.max(...renderedPositions.map(position => position.y))).toBeGreaterThan(100);
  });
});
