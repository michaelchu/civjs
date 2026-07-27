import { describe, expect, it, vi } from 'vitest';
import { FogRenderer } from '../renderers/FogRenderer';

describe('FogRenderer', () => {
  it('draws the reference four-corner masks and treats map padding as unknown', () => {
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
    expect(sprites.has('t.fog_u_u_u_u')).toBe(true);
    expect(sprites.has('t.fog_k_k_k_k')).toBe(false);
  });
});
