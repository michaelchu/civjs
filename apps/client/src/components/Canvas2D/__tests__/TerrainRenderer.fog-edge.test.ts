import { describe, expect, it, vi } from 'vitest';
import { TerrainRenderer } from '../renderers/TerrainRenderer';
import type { RenderState } from '../renderers/BaseRenderer';

describe('TerrainRenderer fog-edge neighbors', () => {
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
