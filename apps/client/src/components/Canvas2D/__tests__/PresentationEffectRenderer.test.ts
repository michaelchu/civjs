import { afterEach, describe, expect, it, vi } from 'vitest';
import { PresentationEffectRenderer } from '../renderers/PresentationEffectRenderer';
import type { RenderState } from '../renderers/BaseRenderer';

function createContext() {
  return {
    canvas: { width: 800, height: 600 },
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

function createState(effect: NonNullable<RenderState['presentationEffects']>[number]): RenderState {
  return {
    viewport: { x: 0, y: 0, width: 800, height: 600 },
    map: { width: 10, height: 10, xsize: 10, ysize: 10, wrap_id: 0, tiles: {} },
    units: {},
    cities: {},
    players: {},
    presentationEffects: [effect],
  };
}

describe('PresentationEffectRenderer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('selects the expected combat frame and keeps the effect active', () => {
    vi.spyOn(performance, 'now').mockReturnValue(240);
    const context = createContext();
    const swordsFrame = {} as HTMLImageElement;
    const renderer = new PresentationEffectRenderer(
      context,
      { getSprite: (key: string) => (key === 'swords.unit_4' ? swordsFrame : null) } as never,
      96,
      48
    );

    const active = renderer.render(
      createState({
        id: 'combat-1',
        type: 'combat',
        style: 'swords',
        x: 1,
        y: 1,
        startedAt: 0,
      })
    );

    expect(active).toBe(true);
    expect(context.drawImage).toHaveBeenCalledWith(swordsFrame, 57, 6);
  });

  it('reports completion after a timed effect expires', () => {
    vi.spyOn(performance, 'now').mockReturnValue(500);
    const context = createContext();
    const renderer = new PresentationEffectRenderer(
      context,
      { getSprite: () => null } as never,
      96,
      48
    );

    const active = renderer.render(
      createState({
        id: 'combat-2',
        type: 'combat',
        style: 'explosion',
        x: 0,
        y: 0,
        startedAt: 0,
        durationMs: 360,
      })
    );

    expect(active).toBe(false);
    expect(context.drawImage).not.toHaveBeenCalled();
  });

  it('renders a scaled nuclear sprite during the effect window', () => {
    vi.spyOn(performance, 'now').mockReturnValue(360);
    const context = createContext();
    const nukeSprite = { width: 64, height: 32 } as HTMLImageElement;
    const renderer = new PresentationEffectRenderer(
      context,
      { getSprite: (key: string) => (key === 'explode.nuke' ? nukeSprite : null) } as never,
      96,
      48
    );

    const active = renderer.render(
      createState({
        id: 'nuke-1',
        type: 'nuclear',
        x: 1,
        y: 0,
        startedAt: 0,
      })
    );

    expect(active).toBe(true);
    expect(context.drawImage).toHaveBeenCalledWith(nukeSprite, 70.4, 35.2, 51.2, 25.6);
  });

  it('renders the nuclear sprite once for each server-authorized affected tile', () => {
    vi.spyOn(performance, 'now').mockReturnValue(360);
    const context = createContext();
    const nukeSprite = { width: 64, height: 32 } as HTMLImageElement;
    const renderer = new PresentationEffectRenderer(
      context,
      { getSprite: (key: string) => (key === 'explode.nuke' ? nukeSprite : null) } as never,
      96,
      48
    );

    renderer.render(
      createState({
        id: 'nuke-multi-tile',
        type: 'nuclear',
        x: 1,
        y: 0,
        startedAt: 0,
        tiles: [
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
      })
    );

    expect(context.drawImage).toHaveBeenCalledTimes(2);
    expect(context.drawImage).toHaveBeenNthCalledWith(1, nukeSprite, 70.4, 35.2, 51.2, 25.6);
    expect(context.drawImage).toHaveBeenNthCalledWith(2, nukeSprite, 118.4, 59.2, 51.2, 25.6);
  });

  it('keeps a visible fallback when an effect sprite is unavailable', () => {
    vi.spyOn(performance, 'now').mockReturnValue(100);
    const context = createContext();
    const renderer = new PresentationEffectRenderer(
      context,
      { getSprite: () => null } as never,
      96,
      48
    );

    expect(
      renderer.render(createState({ id: 'combat-3', type: 'combat', x: 0, y: 0, startedAt: 0 }))
    ).toBe(true);
    expect(context.arc).toHaveBeenCalled();
    expect(context.fill).toHaveBeenCalled();
  });

  it('renders one low-motion frame without scheduling continuation', () => {
    vi.spyOn(performance, 'now').mockReturnValue(100);
    const context = createContext();
    const firstFrame = {} as HTMLImageElement;
    const renderer = new PresentationEffectRenderer(
      context,
      { getSprite: (key: string) => (key === 'explode.unit_0' ? firstFrame : null) } as never,
      96,
      48
    );

    const active = renderer.render({
      ...createState({ id: 'reduced-1', type: 'combat', x: 0, y: 0, startedAt: 0 }),
      reducedMotion: true,
    });

    expect(active).toBe(false);
    expect(context.drawImage).toHaveBeenCalledWith(firstFrame, 25, 18);
  });

  it('provides interpolated virtual combatants while authoritative state settles', () => {
    vi.spyOn(performance, 'now').mockReturnValue(180);
    const renderer = new PresentationEffectRenderer(
      createContext(),
      { getSprite: () => null } as never,
      96,
      48
    );

    const overrides = renderer.getUnitOverrides(
      createState({
        id: 'combat-health',
        type: 'combat',
        x: 0,
        y: 0,
        startedAt: 0,
        durationMs: 360,
        combatants: [
          {
            id: 'defender-1',
            role: 'defender',
            playerId: 'player-2',
            unitTypeId: 'warriors',
            x: 0,
            y: 0,
            hpBefore: 100,
            hpAfter: 0,
            destroyed: true,
          },
        ],
      })
    );

    expect(overrides['defender-1']).toEqual(
      expect.objectContaining({ id: 'defender-1', hp: 50, playerId: 'player-2' })
    );
  });

  it('renders the reference user marker for a recentered empty tile', () => {
    vi.spyOn(performance, 'now').mockReturnValue(450);
    const context = createContext();
    const markerSprite = {} as HTMLImageElement;
    const renderer = new PresentationEffectRenderer(
      context,
      { getSprite: (key: string) => (key === 'grid.usermark' ? markerSprite : null) } as never,
      96,
      48
    );

    expect(
      renderer.render(createState({ id: 'marker-1', type: 'marker', x: 1, y: 1, startedAt: 0 }))
    ).toBe(true);
    expect(context.drawImage).toHaveBeenCalledWith(markerSprite, 0, 48);
  });
});
