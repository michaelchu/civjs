import { describe, expect, it, vi } from 'vitest';
import { BorderRenderer } from '../renderers/BorderRenderer';
import type { RenderState } from '../renderers/BaseRenderer';

describe('BorderRenderer player colors', () => {
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
});
