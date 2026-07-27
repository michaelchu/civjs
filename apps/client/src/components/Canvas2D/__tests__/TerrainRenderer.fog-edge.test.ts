import { afterEach, describe, expect, it } from 'vitest';
import { TerrainRenderer } from '../renderers/TerrainRenderer';

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
});
