import { afterEach, describe, expect, it, vi } from 'vitest';
import { PresentationEffectRenderer } from '../renderers/PresentationEffectRenderer';
import type { RenderState } from '../renderers/BaseRenderer';
import type { TilesetProvider } from '../tilesets/TilesetProvider';

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
    map: {
      width: 10,
      height: 10,
      xsize: 10,
      ysize: 10,
      topology_id: 1,
      wrap_id: 0,
      tiles: {},
    },
    units: {},
    cities: {},
    players: {},
    presentationEffects: [effect],
  };
}

const offsets = {
  unitFlagX: 25,
  unitFlagY: -16,
  cityFlagX: 2,
  cityFlagY: -9,
  unitX: 19,
  unitY: -14,
  activityX: 55,
  activityY: -25,
  selectX: 0,
  selectY: 0,
  stackX: 0,
  stackY: -31,
  cityX: 0,
  cityY: -14,
  citybarX: 45,
  citybarY: 55,
  tileLabelX: 0,
  tileLabelY: 15,
};

const createProvider = (
  projection: 'isometric' | 'hex',
  getSprite: (key: string) => HTMLImageElement | null
): TilesetProvider =>
  ({
    metadata: {
      id: projection,
      name: projection,
      format: 'synthetic',
      projection,
      topologyId: projection === 'isometric' ? 1 : 3,
    },
    getSprite,
    getGeometry: () => ({
      tileWidth: 96,
      tileHeight: 48,
      fullTileWidth: 96,
      fullTileHeight: 48,
      hexWidth: projection === 'hex' ? 16 : 0,
      hexHeight: 0,
    }),
    getPresentationOffsets: () => offsets,
  }) as TilesetProvider;

const createRenderer = (
  context: CanvasRenderingContext2D,
  projection: 'isometric' | 'hex',
  getSprite: (key: string) => HTMLImageElement | null
) => new PresentationEffectRenderer(context, createProvider(projection, getSprite), 96, 48);

describe('PresentationEffectRenderer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/packhand.js:1001-1018
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:397-423
   * @assertion A lethal square combat effect ignores the native style hint and
   * paints five Amplio2 explosion frames for exactly five tile paints each,
   * then requests the cleanup paint that removes the final sprite.
   */
  it('uses five square-isometric explosion frames for five tile paints each', () => {
    const context = createContext();
    const frames = Array.from({ length: 5 }, () => ({}) as HTMLImageElement);
    const renderer = createRenderer(context, 'isometric', key => {
      const match = /^explode\.unit_(\d)$/.exec(key);
      return match ? frames[Number(match[1])] : null;
    });
    const state = createState({
      id: 'combat-lethal',
      type: 'combat',
      style: 'swords',
      x: 1,
      y: 1,
      startedAt: 0,
      combatants: [
        {
          id: 'defender',
          role: 'defender',
          playerId: 'player-2',
          unitTypeId: 'warriors',
          x: 1,
          y: 1,
          hpBefore: 10,
          hpAfter: 0,
          destroyed: true,
        },
      ],
    });

    for (let redraw = 0; redraw < 6; redraw += 1) {
      renderer.beginFrame(state);
      expect(renderer.render(state)).toBe(true);
    }

    expect(context.drawImage).toHaveBeenCalledTimes(6);
    expect(context.drawImage).toHaveBeenNthCalledWith(1, frames[0], 19, 62);
    expect(context.drawImage).toHaveBeenNthCalledWith(5, frames[0], 19, 62);
    expect(context.drawImage).toHaveBeenNthCalledWith(6, frames[1], 19, 62);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:397-423
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:504-519
   * @assertion Consuming the last positive explosion step still paints frame
   * four, so the active renderer must request one subsequent cleanup pass that
   * paints no explosion and then stops.
   */
  it('requests one cleanup paint after the final square explosion sprite', () => {
    const context = createContext();
    const finalFrame = {} as HTMLImageElement;
    const renderer = createRenderer(context, 'isometric', key =>
      key === 'explode.unit_4' ? finalFrame : null
    );
    const state = createState({
      id: 'combat-completion',
      type: 'combat',
      x: 1,
      y: 1,
      startedAt: 0,
    });

    for (let paint = 0; paint < 24; paint += 1) renderer.render(state);
    expect(renderer.render(state)).toBe(true);
    expect(context.drawImage).toHaveBeenLastCalledWith(finalFrame, 19, 62);

    const drawsAfterFinalSprite = (context.drawImage as unknown as ReturnType<typeof vi.fn>).mock
      .calls.length;
    expect(renderer.render(state)).toBe(false);
    expect(context.drawImage).toHaveBeenCalledTimes(drawsAfterFinalSprite);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:397-423
   * @assertion Repainting one canonical tile through wrapped GUI copies invokes
   * fill_sprite_array() repeatedly and advances its mutable explosion counter
   * once for every painted copy, even within one complete map redraw.
   */
  it('advances a square explosion once for every wrapped map copy', () => {
    const context = createContext();
    const frames = Array.from({ length: 2 }, () => ({}) as HTMLImageElement);
    const renderer = createRenderer(context, 'isometric', key => {
      const match = /^explode\.unit_(\d)$/.exec(key);
      return match ? (frames[Number(match[1])] ?? null) : null;
    });
    const state = createState({
      id: 'combat-wrapped',
      type: 'combat',
      x: 1,
      y: 1,
      startedAt: 0,
    });

    renderer.beginFrame(state);
    for (let copy = 0; copy < 6; copy += 1) {
      expect(renderer.renderUnitEffectsForTile(state, { x: 1, y: 1 })).toBe(true);
    }

    expect(context.drawImage).toHaveBeenCalledTimes(6);
    expect(context.drawImage).toHaveBeenNthCalledWith(5, frames[0], 19, 62);
    expect(context.drawImage).toHaveBeenNthCalledWith(6, frames[1], 19, 62);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/packhand.js:1001-1018
   * @assertion The reference stores one explosion counter per tile, so a newer
   * lethal packet on an already-animating tile replaces the sprite and resets
   * that tile's counter instead of compositing two independent effects.
   */
  it('keeps one resettable square explosion counter per logical tile', () => {
    const context = createContext();
    const frames = Array.from({ length: 2 }, () => ({}) as HTMLImageElement);
    const renderer = createRenderer(context, 'isometric', key => {
      const match = /^explode\.unit_(\d)$/.exec(key);
      return match ? (frames[Number(match[1])] ?? null) : null;
    });
    const first = {
      id: 'combat-first',
      type: 'combat' as const,
      x: 1,
      y: 1,
      startedAt: 0,
    };
    const firstState = createState(first);
    renderer.beginFrame(firstState);
    for (let redraw = 0; redraw < 6; redraw += 1) renderer.render(firstState);
    expect(context.drawImage).toHaveBeenLastCalledWith(frames[1], 19, 62);

    const second = { ...first, id: 'combat-second', startedAt: 1 };
    const replacedState = { ...firstState, presentationEffects: [first, second] };
    (context.drawImage as unknown as ReturnType<typeof vi.fn>).mockClear();
    renderer.beginFrame(replacedState);
    expect(renderer.render(replacedState)).toBe(true);

    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(context.drawImage).toHaveBeenCalledWith(frames[0], 19, 62);
  });

  it('indexes retained effects once instead of rescanning them for every visible tile', () => {
    const renderer = createRenderer(createContext(), 'isometric', () => null);
    const effects = Array.from({ length: 16 }, (_, index) => ({
      id: `retained-${index}`,
      type: 'combat' as const,
      x: index,
      y: 20,
      startedAt: 0,
    }));
    const state = {
      ...createState(effects[0]),
      presentationEffects: effects,
    };
    const getDestroyedCombatantTiles = vi.spyOn(
      renderer as unknown as {
        getDestroyedCombatantTiles: (effect: (typeof effects)[number]) => Array<{
          x: number;
          y: number;
        }>;
      },
      'getDestroyedCombatantTiles'
    );

    renderer.beginFrame(state);
    for (let tile = 0; tile < 100; tile += 1) {
      renderer.renderUnitEffectsForTile(state, { x: tile, y: 0 });
    }

    expect(getDestroyedCombatantTiles).toHaveBeenCalledTimes(effects.length);
  });

  it('does not paint a square-isometric combat effect when no unit died', () => {
    const context = createContext();
    const renderer = createRenderer(context, 'isometric', () => ({}) as HTMLImageElement);
    const state = createState({
      id: 'combat-survived',
      type: 'combat',
      x: 1,
      y: 1,
      startedAt: 0,
      combatants: [
        {
          id: 'defender',
          role: 'defender',
          playerId: 'player-2',
          unitTypeId: 'warriors',
          x: 1,
          y: 1,
          hpBefore: 10,
          hpAfter: 5,
          destroyed: false,
        },
      ],
    });

    renderer.beginFrame(state);
    expect(renderer.render(state)).toBe(false);
    expect(context.drawImage).not.toHaveBeenCalled();
  });

  it('renders one square-isometric nuclear sprite at the packet anchor for 60 tile paints', () => {
    const context = createContext();
    const nukeSprite = {} as HTMLImageElement;
    const renderer = createRenderer(context, 'isometric', key =>
      key === 'explode.nuke' ? nukeSprite : null
    );
    const state = createState({
      id: 'nuke-square',
      type: 'nuclear',
      x: 1,
      y: 0,
      startedAt: 0,
      tiles: [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
    });

    renderer.beginFrame(state);
    expect(renderer.renderGotoLayer(state)).toBe(true);
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(context.drawImage).toHaveBeenCalledWith(nukeSprite, 3, -21);
  });

  it('renders a reduced-motion square effect once without scheduling continuation', () => {
    const context = createContext();
    const firstFrame = {} as HTMLImageElement;
    const renderer = createRenderer(context, 'isometric', key =>
      key === 'explode.unit_0' ? firstFrame : null
    );
    const state = {
      ...createState({ id: 'reduced-1', type: 'combat', x: 0, y: 0, startedAt: 0 }),
      reducedMotion: true,
    };

    renderer.beginFrame(state);
    expect(renderer.render(state)).toBe(false);
    renderer.beginFrame(state);
    expect(renderer.render(state)).toBe(false);
    expect(context.drawImage).toHaveBeenCalledTimes(2);
    expect(context.drawImage).toHaveBeenCalledWith(firstFrame, 19, 14);
  });

  it('does not interpolate virtual combatants in the square browser path', () => {
    const renderer = createRenderer(createContext(), 'isometric', () => null);
    const state = createState({
      id: 'combat-health-square',
      type: 'combat',
      x: 0,
      y: 0,
      startedAt: 0,
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
    });

    expect(renderer.getUnitOverrides(state, 180)).toEqual({});
  });

  it('retains elapsed-time swords effects for the native Hexemplio path', () => {
    vi.spyOn(performance, 'now').mockReturnValue(240);
    const context = createContext();
    const swordsFrame = {} as HTMLImageElement;
    const renderer = createRenderer(context, 'hex', key =>
      key === 'swords.unit_4' ? swordsFrame : null
    );

    expect(
      renderer.render(
        createState({
          id: 'combat-native',
          type: 'combat',
          style: 'swords',
          x: 1,
          y: 1,
          startedAt: 0,
        })
      )
    ).toBe(true);
    expect(context.drawImage).toHaveBeenCalledWith(swordsFrame, 57, 6);
  });

  it('reports native effect completion after its elapsed duration', () => {
    vi.spyOn(performance, 'now').mockReturnValue(500);
    const context = createContext();
    const renderer = createRenderer(context, 'hex', () => null);

    expect(
      renderer.render(
        createState({
          id: 'combat-native-expired',
          type: 'combat',
          x: 0,
          y: 0,
          startedAt: 0,
          durationMs: 360,
        })
      )
    ).toBe(false);
    expect(context.drawImage).not.toHaveBeenCalled();
  });

  it('keeps native multi-tile nuclear presentation and tile-local GOTO painting', () => {
    vi.spyOn(performance, 'now').mockReturnValue(360);
    const context = createContext();
    const nukeSprite = {} as HTMLImageElement;
    const renderer = createRenderer(context, 'hex', key =>
      key === 'explode.nuke' ? nukeSprite : null
    );
    const state = createState({
      id: 'nuke-native',
      type: 'nuclear',
      x: 1,
      y: 0,
      startedAt: 0,
      tiles: [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
    });

    expect(renderer.renderGotoEffectsForTile(state, { x: 2, y: 0 })).toBe(true);
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(context.drawImage).toHaveBeenCalledWith(nukeSprite, 51, 3);
  });

  it('keeps a native fallback burst when an effect sprite is unavailable', () => {
    vi.spyOn(performance, 'now').mockReturnValue(100);
    const context = createContext();
    const renderer = createRenderer(context, 'hex', () => null);

    expect(
      renderer.render(
        createState({ id: 'combat-fallback', type: 'combat', x: 0, y: 0, startedAt: 0 })
      )
    ).toBe(true);
    expect(context.arc).toHaveBeenCalled();
    expect(context.fill).toHaveBeenCalled();
  });

  it('provides interpolated virtual combatants for native presentation', () => {
    const renderer = createRenderer(createContext(), 'hex', () => null);
    const overrides = renderer.getUnitOverrides(
      createState({
        id: 'combat-health-native',
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
      }),
      180
    );

    expect(overrides['defender-1']).toEqual(
      expect.objectContaining({ id: 'defender-1', hp: 50, playerId: 'player-2' })
    );
  });

  it('retains the native user marker feedback', () => {
    vi.spyOn(performance, 'now').mockReturnValue(450);
    const context = createContext();
    const markerSprite = {} as HTMLImageElement;
    const renderer = createRenderer(context, 'hex', key =>
      key === 'grid.usermark' ? markerSprite : null
    );

    expect(
      renderer.render(createState({ id: 'marker-1', type: 'marker', x: 1, y: 1, startedAt: 0 }))
    ).toBe(true);
    expect(context.drawImage).toHaveBeenCalledWith(markerSprite, 0, 48);
  });
});
