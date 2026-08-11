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
    },
    load: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    getSprite: vi.fn((tag: string) => sprites.get(tag) ?? null),
    hasSprite: vi.fn((tag: string) => sprites.has(tag)),
    hasTerrainDefinition: vi.fn(),
    getTileSize: vi.fn(() => ({ width: 96, height: 48 })),
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
   * indicator, connection marker, veteran badge, health bar, and stack overlays
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
        'unit.connect',
        'unit.vet_2',
        'unit.hp_50',
        'unit.stk_shld_l',
        'unit.stack2',
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
      'unit.connect',
      'unit.vet_2',
      'unit.hp_50',
      'unit.stk_shld_l',
      'unit.stack2',
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
});
