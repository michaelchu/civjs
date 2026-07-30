import { describe, expect, it, vi } from 'vitest';
import { PathRenderer } from '../renderers/PathRenderer';

describe('PathRenderer', () => {
  it('marks the destination of an active goto path', () => {
    const context = {
      canvas: { width: 800, height: 600 },
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const renderer = new PathRenderer(context, {} as never, 96, 48);

    renderer.renderPaths({
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      gotoPath: {
        unitId: 'unit-1',
        tiles: [
          { x: 0, y: 0, moveCost: 0 },
          { x: 1, y: 0, moveCost: 1 },
        ],
        totalCost: 1,
        estimatedTurns: 1,
        valid: true,
      },
    } as never);

    expect(context.arc).toHaveBeenCalledWith(96, 48, 8, 0, 2 * Math.PI);
    expect(context.fill).toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalled();
  });

  it('renders reachable movement tiles as translucent diamonds', () => {
    const context = {
      canvas: { width: 800, height: 600 },
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const renderer = new PathRenderer(context, {} as never, 96, 48);

    renderer.renderPaths({
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      movementRange: [
        { x: 0, y: 0, remainingMovement: 3 },
        { x: 1, y: 0, remainingMovement: 2 },
      ],
    } as never);

    expect(context.fill).toHaveBeenCalledTimes(2);
    expect(context.stroke).toHaveBeenCalledTimes(2);
    expect(context.moveTo).toHaveBeenCalledWith(48, 0);
  });
});
