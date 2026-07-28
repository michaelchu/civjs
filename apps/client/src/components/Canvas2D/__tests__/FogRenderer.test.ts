import { describe, expect, it, vi } from 'vitest';
import { FogRenderer } from '../renderers/FogRenderer';
import type { RenderState } from '../renderers/BaseRenderer';

describe('FogRenderer', () => {
  it('draws remembered-terrain transitions without overlapping fully unknown masks', () => {
    const sprites = new Map<string, HTMLCanvasElement>();
    const context = {
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const loader = {
      getSprite: (key: string) => {
        if (!sprites.has(key)) sprites.set(key, {} as HTMLCanvasElement);
        return sprites.get(key) ?? null;
      },
    };
    const renderer = new FogRenderer(context, loader as never, 96, 48);

    renderer.render({
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      map: {
        width: 3,
        height: 1,
        xsize: 3,
        ysize: 1,
        tiles: {
          '0,0': { x: 0, y: 0, terrain: 'unknown', known: false, visible: false },
          '1,0': { x: 1, y: 0, terrain: 'plains', known: true, visible: false },
          '2,0': { x: 2, y: 0, terrain: 'plains', known: true, visible: true },
        },
      },
      units: {},
      cities: {},
      players: {},
    });

    expect(loader.getSprite('t.fog_u_f_u_u')).toBeDefined();
    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('t.fog_u_f_u_u'), 0, 24);
    expect(sprites.has('t.fog_u_u_u_u')).toBe(false);
    expect(sprites.has('t.fog_k_k_k_k')).toBe(false);
  });

  it('draws the dimming mask across a fully explored but currently unseen area', () => {
    const sprites = new Map<string, HTMLCanvasElement>();
    const context = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const loader = {
      getSprite: (key: string) => {
        if (!sprites.has(key)) sprites.set(key, {} as HTMLCanvasElement);
        return sprites.get(key) ?? null;
      },
    };
    const renderer = new FogRenderer(context, loader as never, 96, 48);

    renderer.render({
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      map: {
        width: 2,
        height: 2,
        tiles: {
          '0,0': { x: 0, y: 0, terrain: 'plains', known: true, visible: false },
          '1,0': { x: 1, y: 0, terrain: 'plains', known: true, visible: false },
          '0,1': { x: 0, y: 1, terrain: 'plains', known: true, visible: false },
          '1,1': { x: 1, y: 1, terrain: 'plains', known: true, visible: false },
        },
      },
      units: {},
      cities: {},
      players: {},
    });

    expect(sprites.has('t.fog_f_f_f_f')).toBe(true);
    expect(sprites.has('t.fog_u_u_u_u')).toBe(false);
  });

  it('culls against the backing canvas and keeps fog anchored while panning', () => {
    const context = {
      canvas: { width: 1200, height: 700 },
      drawImage: vi.fn(),
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const renderer = new FogRenderer(context, { getSprite: () => null } as never, 96, 48);
    const state: RenderState = {
      viewport: { x: 0, y: 0, width: 300, height: 200 },
      map: { width: 40, height: 40, tiles: {} },
      units: {},
      cities: {},
      players: {},
    };

    const bounds = (
      renderer as unknown as {
        getCornerBounds: (renderState: typeof state) => { maxX: number; maxY: number };
      }
    ).getCornerBounds(state);
    expect(bounds.maxX).toBeGreaterThan(20);
    expect(bounds.maxY).toBeGreaterThan(15);

    const anchor = (
      renderer as unknown as {
        mapCornerToScreen: (
          x: number,
          y: number,
          renderState: typeof state
        ) => { x: number; y: number };
      }
    ).mapCornerToScreen(8, 9, state);
    const pannedAnchor = (
      renderer as unknown as {
        mapCornerToScreen: (
          x: number,
          y: number,
          renderState: typeof state
        ) => { x: number; y: number };
      }
    ).mapCornerToScreen(8, 9, {
      ...state,
      viewport: { ...state.viewport, x: 37, y: 19 },
    });

    expect(pannedAnchor).toEqual({ x: anchor.x - 37, y: anchor.y - 19 });
  });
});
