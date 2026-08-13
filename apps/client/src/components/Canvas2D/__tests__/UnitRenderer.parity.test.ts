import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Unit } from '../../../types';
import type { RenderState } from '../renderers/BaseRenderer';
import { UnitRenderer } from '../renderers/UnitRenderer';
import type { TilesetProvider } from '../tilesets/TilesetProvider';

type Sprite = HTMLCanvasElement & { tag: string };

const createContext = () =>
  ({
    canvas: { width: 800, height: 600 },
    drawImage: vi.fn(),
  }) as unknown as CanvasRenderingContext2D;

const createProvider = (tags: string[]) => {
  const sprites = new Map<string, Sprite>();
  for (const tag of tags) {
    sprites.set(tag, { tag, width: 16, height: 16 } as unknown as Sprite);
  }

  return {
    metadata: {
      id: 'unit-test',
      name: 'Unit test tileset',
      format: 'synthetic',
      projection: 'isometric',
      topologyId: 1,
    },
    load: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    getSprite: vi.fn((tag: string) => sprites.get(tag) ?? null),
    hasSprite: vi.fn((tag: string) => sprites.has(tag)),
    hasTerrainDefinition: vi.fn(),
    getTileSize: vi.fn(() => ({ width: 96, height: 48 })),
    getGeometry: vi.fn(() => ({
      tileWidth: 96,
      tileHeight: 48,
      fullTileWidth: 96,
      fullTileHeight: 48,
      hexWidth: 0,
      hexHeight: 0,
    })),
    getTopologyCompatibility: vi.fn(() => 'exact'),
    getTerrainComposition: vi.fn(() => null),
    getPresentationOffsets: vi.fn(() => ({
      unitFlagX: 0,
      unitFlagY: 0,
      cityFlagX: 0,
      cityFlagY: 0,
      unitX: 0,
      unitY: 0,
      activityX: 0,
      activityY: 0,
      selectX: 0,
      selectY: 0,
      stackX: 0,
      stackY: 0,
      cityX: 0,
      cityY: 0,
      citybarX: 0,
      citybarY: 0,
      tileLabelX: 0,
      tileLabelY: 0,
    })),
  } as unknown as TilesetProvider;
};

const createState = (units: Record<string, Unit>): RenderState => ({
  viewport: { x: 0, y: 0, width: 800, height: 600 },
  map: {
    width: 2,
    height: 2,
    xsize: 2,
    ysize: 2,
    tiles: {
      '0,0': { x: 0, y: 0, terrain: 'plains', known: true, visible: true },
    },
  },
  units,
  cities: {},
  players: {
    'player-1': { color: '#dc2626', name: 'Rome', nation: 'romans', nationGraphic: 'rome' },
  },
  currentPlayerId: 'observer',
});

const createUnit = (overrides: Partial<Unit> = {}): Unit => ({
  id: 'unit-1',
  playerId: 'player-1',
  unitTypeId: 'warriors',
  x: 0,
  y: 0,
  hp: 50,
  maxHp: 100,
  movesLeft: 1,
  veteranLevel: 2,
  ...overrides,
});

const drawnTags = (context: CanvasRenderingContext2D): string[] =>
  (context.drawImage as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
    ([sprite]) => (sprite as Sprite).tag
  );

describe('UnitRenderer parity contracts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:895-965,970-1065
   * @assertion A visible unit composes the nation flag, unit graphic, activity
   * indicator, health/stack overlays, and veteran badge
   * in the reference sprite-array order.
   */
  it('composes activity, identity, health, veteran, and stack sprites', () => {
    const context = createContext();
    const renderer = new UnitRenderer(
      context,
      createProvider([
        'f.shield.rome',
        'u.warriors',
        'unit.road',
        'unit.vet_2',
        'unit.hp_50',
        'unit.stack',
      ]),
      96,
      48
    );
    renderer.setUnitGraphics({ warriors: { graphic: 'u.warriors' } });
    const primary = createUnit({ activity: 'road', orders: [{ direction: 'e' }] });
    const stacked = createUnit({ id: 'unit-2', unitTypeId: 'settlers' });
    const state = createState({ [primary.id]: primary, [stacked.id]: stacked });
    renderer.setMapGeometry(state.map);
    renderer.renderUnits(state);

    expect(drawnTags(context)).toEqual([
      'f.shield.rome',
      'u.warriors',
      'unit.road',
      'unit.hp_50',
      'unit.stack',
      'unit.vet_2',
    ]);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:988-1005,1047-1055
   * @assertion Worker activity targets select the ruleset-provided activity
   * graphic instead of always falling back to the generic activity icon.
   */
  it('uses a ruleset activity target graphic for irrigation work', () => {
    const context = createContext();
    const renderer = new UnitRenderer(
      context,
      createProvider(['f.shield.rome', 'u.warriors', 'unit.irrigate', 'unit.hp_100']),
      96,
      48
    );
    renderer.setUnitGraphics({ warriors: { graphic: 'u.warriors' } });
    renderer.setActivityGraphics({
      extra_irrigation: { activity_gfx: 'unit.irrigate' },
    });
    const unit = createUnit({
      hp: 100,
      veteranLevel: 0,
      activity: 'irrigation',
      activityTarget: 'extra_irrigation',
    });
    const state = createState({ [unit.id]: unit });
    renderer.setMapGeometry(state.map);
    renderer.renderUnits(state);

    expect(drawnTags(context)).toContain('unit.irrigate');
    expect(drawnTags(context)).not.toContain('unit.plant');
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:895-913
   * @assertion A playing client hides a foreign Flagless unit's nation shield,
   * while an observer with no playing player still sees the shield.
   */
  it('applies the Flagless nation-shield rule using the playing player', () => {
    const tags = ['f.shield.rome', 'u.storm', 'unit.hp_50'];
    const foreignContext = createContext();
    const foreignRenderer = new UnitRenderer(foreignContext, createProvider(tags), 96, 48);
    foreignRenderer.setUnitGraphics({ storm: { graphic: 'u.storm', flagless: true } });
    const unit = createUnit({ unitTypeId: 'storm', veteranLevel: 0 });
    const foreignState = { ...createState({ [unit.id]: unit }), currentPlayerId: 'player-2' };
    foreignRenderer.setMapGeometry(foreignState.map);

    foreignRenderer.renderUnits(foreignState);

    expect(drawnTags(foreignContext)).toEqual(['u.storm', 'unit.hp_50']);

    const observerContext = createContext();
    const observerRenderer = new UnitRenderer(observerContext, createProvider(tags), 96, 48);
    observerRenderer.setUnitGraphics({ storm: { graphic: 'u.storm', flagless: true } });
    const observerState = { ...createState({ [unit.id]: unit }), currentPlayerId: '' };
    observerRenderer.setMapGeometry(observerState.map);

    observerRenderer.renderUnits(observerState);

    expect(drawnTags(observerContext)).toEqual(['f.shield.rome', 'u.storm', 'unit.hp_50']);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:674-705,970-976,1070-1085
   * @assertion Server-side-agent sprites follow activity sprites, workers use
   * the origin-aligned agent marker, and auto-explore suppresses activity.
   */
  it('composes automation as the reference server-side-agent layer', () => {
    const workerContext = createContext();
    const workerRenderer = new UnitRenderer(
      workerContext,
      createProvider([
        'f.shield.rome',
        'u.warriors',
        'unit.road',
        'unit.auto_worker',
        'unit.hp_50',
      ]),
      96,
      48
    );
    workerRenderer.setUnitGraphics({ warriors: { graphic: 'u.warriors' } });
    const worker = createUnit({ activity: 'road', automation: 'worker', veteranLevel: 0 });
    const workerState = createState({ [worker.id]: worker });
    workerRenderer.setMapGeometry(workerState.map);

    workerRenderer.renderUnits(workerState);

    expect(drawnTags(workerContext)).toEqual([
      'f.shield.rome',
      'u.warriors',
      'unit.road',
      'unit.auto_worker',
      'unit.hp_50',
    ]);
    const workerAgentCall = (
      workerContext.drawImage as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.find(([sprite]) => (sprite as Sprite).tag === 'unit.auto_worker');
    expect(workerAgentCall?.slice(1)).toEqual([0, 0]);

    const exploreContext = createContext();
    const exploreRenderer = new UnitRenderer(
      exploreContext,
      createProvider([
        'f.shield.rome',
        'u.warriors',
        'unit.road',
        'unit.auto_explore',
        'unit.hp_50',
      ]),
      96,
      48
    );
    exploreRenderer.setUnitGraphics({ warriors: { graphic: 'u.warriors' } });
    const explorer = createUnit({ activity: 'road', automation: 'explore', veteranLevel: 0 });
    const exploreState = createState({ [explorer.id]: explorer });
    exploreRenderer.setMapGeometry(exploreState.map);

    exploreRenderer.renderUnits(exploreState);

    expect(drawnTags(exploreContext)).toEqual([
      'f.shield.rome',
      'u.warriors',
      'unit.auto_explore',
      'unit.hp_50',
    ]);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:1164-1168
   * @assertion Reduced-motion selection uses the first atlas selection frame
   * while preserving the selected unit's map position.
   */
  it('renders the atlas selection frame for reduced-motion selection', () => {
    const context = createContext();
    const renderer = new UnitRenderer(context, createProvider(['unit.select0']), 96, 48);
    const unit = createUnit({ veteranLevel: 0 });
    const state = {
      ...createState({ [unit.id]: unit }),
      selectedUnitId: unit.id,
      focusedUnits: [unit.id],
      reducedMotion: true,
    };
    renderer.setMapGeometry(state.map);
    renderer.renderUnitSelection(state);

    expect(drawnTags(context)).toEqual(['unit.select0']);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:1164-1168
   * @assertion Animated selection chooses its atlas frame from absolute wall
   * clock time at Freeciv-web's six-frames-per-second cadence.
   */
  it('uses the reference six-frame selection cadence', () => {
    vi.useFakeTimers();
    vi.setSystemTime(500);
    const context = createContext();
    const renderer = new UnitRenderer(
      context,
      createProvider(['unit.select0', 'unit.select1', 'unit.select2', 'unit.select3']),
      96,
      48
    );
    const unit = createUnit({ veteranLevel: 0 });
    const state = {
      ...createState({ [unit.id]: unit }),
      selectedUnitId: unit.id,
      focusedUnits: [unit.id],
    };
    renderer.setMapGeometry(state.map);

    renderer.renderUnitSelection(state);

    expect(drawnTags(context)).toEqual(['unit.select3']);
    vi.useRealTimers();
  });
});
