import { describe, expect, it, vi } from 'vitest';
import { PathRenderer } from '../renderers/PathRenderer';

describe('PathRenderer', () => {
  it('draws only the reference directional segments for an active goto path', () => {
    const strokeStyles: string[] = [];
    const context = {
      canvas: { width: 800, height: 600 },
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    Object.defineProperty(context, 'strokeStyle', {
      configurable: true,
      get: () => strokeStyles[strokeStyles.length - 1],
      set: (value: string) => strokeStyles.push(value),
    });
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

    expect(context.moveTo).toHaveBeenCalledWith(48, 24);
    expect(context.lineTo).toHaveBeenCalledWith(96, 48);
    expect(context.ellipse).not.toHaveBeenCalled();
    expect(context.fill).not.toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalled();
    expect(strokeStyles).toContain('rgba(0,168,255,0.9)');
    expect(context.lineWidth).toBe(10);
  });

  it('does not render reachable movement tiles or their turn labels', () => {
    const context = {
      canvas: { width: 800, height: 600 },
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const renderer = new PathRenderer(context, {} as never, 96, 48);

    renderer.renderPaths({
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      movementRange: [
        { x: 0, y: 0, remainingMovement: 3 },
        { x: 1, y: 0, remainingMovement: 2 },
      ],
      movementRangeOrigin: { x: 0, y: 0 },
    } as never);

    expect(context.fill).not.toHaveBeenCalled();
    expect(context.stroke).not.toHaveBeenCalled();
    expect(context.fillText).not.toHaveBeenCalled();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview.js:382-397
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:341-369
   * @assertion A square-ISO GOTO step crossing a wrapped map edge is drawn to
   * the nearest periodic copy, preserving the same one-tile diagonal GUI
   * vector as an ordinary eastward step.
   */
  it('draws a square-ISO goto segment across the horizontal seam', () => {
    const context = {
      canvas: { width: 800, height: 600 },
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const renderer = new PathRenderer(context, {} as never, 96, 48);
    renderer.setMapGeometry({
      width: 4,
      height: 3,
      xsize: 4,
      ysize: 3,
      topology_id: 1,
      wrap_id: 1,
      tiles: {},
    });

    renderer.renderPaths({
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      map: {
        width: 4,
        height: 3,
        xsize: 4,
        ysize: 3,
        topology_id: 1,
        wrap_id: 1,
        tiles: {},
      },
      units: {},
      cities: {},
      players: {},
      gotoPath: {
        unitId: 'unit-1',
        tiles: [
          { x: 3, y: 1, moveCost: 0 },
          { x: 0, y: 1, moveCost: 1 },
        ],
        totalCost: 1,
        estimatedTurns: 1,
        valid: true,
      },
    });

    expect(context.moveTo).toHaveBeenCalledWith(144, 120);
    expect(context.lineTo).toHaveBeenCalledWith(192, 144);
    expect(context.stroke).toHaveBeenCalledTimes(1);
  });
});
