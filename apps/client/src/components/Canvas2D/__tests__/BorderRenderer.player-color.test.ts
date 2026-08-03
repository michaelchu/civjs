import { describe, expect, it, vi } from 'vitest';
import { BorderRenderer } from '../renderers/BorderRenderer';
import type { RenderState } from '../renderers/BaseRenderer';

describe('BorderRenderer player colors', () => {
  it('reports whether the reference moving-border loop should remain active', () => {
    const context = {
      canvas: { width: 800, height: 600 },
    } as unknown as CanvasRenderingContext2D;
    const renderer = new BorderRenderer(context, {} as never, 96, 48, {
      drawMovingBorders: true,
    });

    expect(renderer.hasActiveAnimation()).toBe(true);
    expect(renderer.hasActiveAnimation(true)).toBe(false);
  });

  it('uses the assigned color for an AI-owned border', () => {
    const strokeColors: string[] = [];
    const context = {
      canvas: { width: 800, height: 600 },
      strokeStyle: '',
      save: vi.fn(),
      restore: vi.fn(),
      setLineDash: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(function (this: { strokeStyle: string }) {
        strokeColors.push(this.strokeStyle);
      }),
    } as unknown as CanvasRenderingContext2D;
    const renderer = new BorderRenderer(context, {} as never, 96, 48);
    const aiPlayerId = 'ai-player-uuid';
    const state: RenderState = {
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      map: {
        width: 1,
        height: 1,
        tiles: {
          '0,0': {
            x: 0,
            y: 0,
            terrain: 'grassland',
            known: true,
            visible: true,
            owner: aiPlayerId,
          },
        },
      },
      units: {},
      cities: {},
      players: {
        [aiPlayerId]: {
          name: 'AI Leader',
          nation: 'greeks',
          color: '#00aa33',
        },
      },
    };

    renderer.render(state);

    expect(strokeColors).toContain('#00aa33');
    expect(strokeColors).not.toContain('#808080');
  });

  it('does not reveal borders on completely unknown tiles', () => {
    const context = {
      canvas: { width: 800, height: 600 },
      save: vi.fn(),
      restore: vi.fn(),
      setLineDash: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const renderer = new BorderRenderer(context, {} as never, 96, 48);
    const state: RenderState = {
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      map: {
        width: 1,
        height: 1,
        tiles: {
          '0,0': {
            x: 0,
            y: 0,
            terrain: 'unknown',
            known: false,
            visible: false,
            owner: 'ai-player-uuid',
          },
        },
      },
      units: {},
      cities: {},
      players: {
        'ai-player-uuid': {
          name: 'AI Leader',
          nation: 'greeks',
          color: '#00aa33',
        },
      },
    };

    renderer.render(state);

    expect(context.stroke).not.toHaveBeenCalled();
  });

  it('samples cardinal borders from native ISO tile storage', () => {
    const renderer = new BorderRenderer({} as CanvasRenderingContext2D, {} as never, 96, 48);
    const owner = 'player-1';
    const center = {
      x: 10,
      y: 10,
      terrain: 'grassland',
      known: true,
      visible: true,
      owner,
    };
    const neighbors = [
      { x: 10, y: 9 },
      { x: 10, y: 11 },
      { x: 9, y: 11 },
      { x: 9, y: 9 },
    ].map(tile => ({ ...tile, terrain: 'grassland', known: true, visible: true, owner }));
    const map = {
      width: 32,
      height: 64,
      xsize: 32,
      ysize: 64,
      topology_id: 12,
      wrap_id: 3,
      tiles: Object.fromEntries([center, ...neighbors].map(tile => [`${tile.x},${tile.y}`, tile])),
    };

    const sprites = (
      renderer as unknown as {
        getBorderLineSprites(tile: typeof center, candidate: typeof map): unknown[];
      }
    ).getBorderLineSprites(center, map);

    expect(sprites).toEqual([]);
  });
});
