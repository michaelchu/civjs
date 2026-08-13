import { describe, expect, it, vi } from 'vitest';
import type { City } from '../../../types';
import { CityRenderer } from '../renderers/CityRenderer';
import type { RenderState } from '../renderers/BaseRenderer';

const createLegacyTileset = (getSprite: (key: string) => unknown = () => undefined) => ({
  getSprite,
  getGeometry: () => ({
    tileWidth: 96,
    tileHeight: 48,
    fullTileWidth: 96,
    fullTileHeight: 48,
    hexWidth: 0,
    hexHeight: 0,
  }),
  getPresentationOffsets: () => ({
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
  }),
});

describe('CityRenderer presentation state', () => {
  it('matches the pinned square-isometric city and disorder composition', () => {
    const renderer = new CityRenderer(
      {} as CanvasRenderingContext2D,
      createLegacyTileset(() => ({})) as never,
      96,
      48
    );
    const city = {
      id: 'city',
      name: 'City',
      playerId: 'other',
      x: 0,
      y: 0,
      size: 8,
      buildings: [],
      granaryTurns: -1,
      disorder: true,
      presentation: {
        graphic: 'city.industrial',
        hasWalls: true,
        overlays: ['city.coastal_underlay', 'city.coastal_overlay'],
      },
    } as unknown as City;
    const state = {
      players: {},
      currentPlayerId: 'self',
    } as unknown as RenderState;

    const sprites = (
      renderer as unknown as {
        getCitySprites: (city: City, state: RenderState) => Array<{ key: string }>;
      }
    ).getCitySprites(city, state);

    expect(sprites.map(sprite => sprite.key)).toEqual(['city.industrial_wall_2', 'city.disorder']);
  });

  it('does not render a leaked city on an unknown tile', () => {
    const renderer = new CityRenderer(
      { canvas: { width: 800, height: 600 } } as CanvasRenderingContext2D,
      createLegacyTileset() as never,
      96,
      48
    );
    const renderCity = vi.spyOn(renderer as never, 'renderCitySprite').mockImplementation(() => {});
    const city = { id: 'hidden', x: 2, y: 2 } as City;
    const state = {
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      map: {
        tiles: {
          '2,2': { x: 2, y: 2, terrain: 'unknown', known: false, visible: false },
        },
      },
      cities: { hidden: city },
    } as unknown as RenderState;

    renderer.renderCities(state);

    expect(renderCity).not.toHaveBeenCalled();
  });

  it('renders a city once its tile is known', () => {
    const renderer = new CityRenderer(
      { canvas: { width: 800, height: 600 } } as CanvasRenderingContext2D,
      createLegacyTileset() as never,
      96,
      48
    );
    const renderCity = vi.spyOn(renderer as never, 'renderCitySprite').mockImplementation(() => {});
    const city = { id: 'known', x: 2, y: 2 } as City;
    const state = {
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      map: {
        tiles: {
          '2,2': { x: 2, y: 2, terrain: 'plains', known: true, visible: false },
        },
      },
      cities: { known: city },
    } as unknown as RenderState;

    renderer.renderCities(state);

    expect(renderCity).toHaveBeenCalledWith(city, state.viewport, state);
  });

  it('matches the reference city-bar drawing commands', () => {
    const context = {
      canvas: { width: 800, height: 600 },
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 32 }),
    } as unknown as CanvasRenderingContext2D;
    const granarySprite = {} as HTMLCanvasElement;
    const renderer = new CityRenderer(
      context,
      createLegacyTileset(key => (key === 'b.granary' ? granarySprite : undefined)) as never,
      96,
      48
    );
    renderer.setProductionGraphics({}, { granary: { graphic: 'b.granary' } });
    const city = {
      id: 'known',
      name: 'Alpha',
      playerId: 'self',
      x: 0,
      y: 0,
      size: 3,
      actualPopulation: 70000,
      buildings: [],
      granaryTurns: 4,
      disorder: false,
      production: {
        target: 'granary',
        name: 'Granary',
        type: 'building',
        progress: 7,
        cost: 30,
        turnsToComplete: 3,
      },
    } as unknown as City;

    renderer.renderCityOverlays({
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      map: { tiles: { '0,0': { x: 0, y: 0, terrain: 'plains', known: true, visible: true } } },
      cities: { known: city },
      players: { self: { color: '#22d3ee' } },
    } as unknown as RenderState);

    expect(context.font).toBe('16px Georgia, serif');
    expect(context.fillRect).toHaveBeenNthCalledWith(1, 15, 38, 52, 20);
    expect(context.fillRect).toHaveBeenNthCalledWith(2, 66, 36, 67, 24);
    expect(context.strokeStyle).toBe('#22d3ee');
    expect(context.lineWidth).toBe(1.5);
    expect(context.moveTo).toHaveBeenNthCalledWith(1, -17, 37);
    expect(context.lineTo).toHaveBeenNthCalledWith(1, 106, 37);
    expect(context.moveTo).toHaveBeenNthCalledWith(2, 106, 59);
    expect(context.lineTo).toHaveBeenNthCalledWith(2, -17, 59);
    expect(context.lineTo).toHaveBeenNthCalledWith(3, -17, 37);
    expect(context.moveTo).toHaveBeenNthCalledWith(3, 14, 38);
    expect(context.lineTo).toHaveBeenNthCalledWith(4, 14, 58);
    expect(context.stroke).toHaveBeenCalledTimes(1);
    expect(context.globalAlpha).toBe(1);
    expect(context.drawImage).toHaveBeenCalledWith(granarySprite, 106, 36, 28, 24);
    expect(context.fillText).toHaveBeenNthCalledWith(1, '3', 71, 56);
    expect(context.fillText).toHaveBeenNthCalledWith(2, 'ALPHA', 27, 54);
    expect(context.fillText).toHaveBeenNthCalledWith(3, '3', 69, 54);
  });

  it('keeps conversion production text out of the reference city bar', () => {
    const context = {
      canvas: { width: 800, height: 600 },
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 32 }),
    } as unknown as CanvasRenderingContext2D;
    const renderer = new CityRenderer(context, createLegacyTileset() as never, 96, 48);
    const city = {
      id: 'known',
      name: 'Alpha',
      playerId: 'self',
      x: 0,
      y: 0,
      size: 3,
      buildings: [],
      granaryTurns: 4,
      disorder: false,
      production: {
        target: 'capitalization',
        type: 'building',
        progress: 0,
        cost: 999,
        turnsToComplete: 999,
      },
    } as unknown as City;

    renderer.renderCityOverlays({
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      map: { tiles: { '0,0': { x: 0, y: 0, terrain: 'plains', known: true, visible: true } } },
      cities: { known: city },
      players: { self: { color: '#22d3ee' } },
    } as unknown as RenderState);

    expect(context.fillText).toHaveBeenCalledWith('ALPHA', expect.any(Number), expect.any(Number));
    expect(context.fillText).not.toHaveBeenCalledWith(
      'Wealth',
      expect.any(Number),
      expect.any(Number)
    );
    expect(context.fillText).not.toHaveBeenCalledWith(
      'Wealth · 999',
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('renders selected-city output sprites without custom tile diamonds', () => {
    const context = {
      canvas: { width: 800, height: 600 },
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 32 }),
    } as unknown as CanvasRenderingContext2D;
    const outputSprite = {} as HTMLCanvasElement;
    const renderer = new CityRenderer(
      context,
      createLegacyTileset(key =>
        key.startsWith('city.t_') || key === 'grid.unavailable' ? outputSprite : undefined
      ) as never,
      96,
      48
    );
    const city = {
      id: 'known',
      name: 'Alpha',
      playerId: 'self',
      x: 0,
      y: 0,
      size: 3,
      buildings: [],
      granaryTurns: 4,
      disorder: false,
      workableTiles: [
        { x: 0, y: 0, isWorked: true, isCenter: true, outputs: { food: 2, shields: 1, trade: 1 } },
        { x: 1, y: 0, isWorked: false, outputs: { food: 1, shields: 1, trade: 0 } },
      ],
    } as unknown as City;

    renderer.renderCityOverlays({
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      map: {
        tiles: {
          '0,0': { x: 0, y: 0, terrain: 'plains', known: true, visible: true },
          '1,0': { x: 1, y: 0, terrain: 'plains', known: true, visible: true },
        },
      },
      cities: { known: city },
      players: { self: { color: '#22d3ee' } },
      selectedCityId: 'known',
    } as unknown as RenderState);

    expect(context.drawImage).toHaveBeenCalledTimes(3);
    expect(context.fill).not.toHaveBeenCalled();
    expect(context.closePath).not.toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalledTimes(1);
  });

  it('uses decimal square-ISO output tags instead of base-36 aliases', () => {
    const requested: string[] = [];
    const context = {
      canvas: { width: 800, height: 600 },
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const renderer = new CityRenderer(
      context,
      createLegacyTileset(key => {
        requested.push(key);
        return {};
      }) as never,
      96,
      48
    );
    const city = {
      id: 'known',
      x: 0,
      y: 0,
      workableTiles: [
        {
          x: 0,
          y: 0,
          isWorked: true,
          outputs: { food: 10, shields: 11, trade: 12 },
        },
      ],
    } as unknown as City;

    renderer.renderWorkedTileOverlayEntries([
      {
        state: {
          viewport: { x: 0, y: 0, width: 800, height: 600 },
          map: {
            tiles: {
              '0,0': { x: 0, y: 0, terrain: 'plains', known: true, visible: true },
            },
          },
          cities: { known: city },
          units: {},
          players: {},
          selectedCityId: 'known',
        } as unknown as RenderState,
        tile: { x: 0, y: 0, terrain: 'plains', known: true, visible: true },
      },
    ]);

    expect(requested).toEqual(['city.t_food_10', 'city.t_shields_11', 'city.t_trade_12']);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:449-472
   * @assertion A square-ISO CITYBAR tile draws city text before its worked
   * food, shield, and trade sprites, matching fill_sprite_array order.
   */
  it('draws a square-isometric city bar before that tile work outputs', () => {
    const calls: string[] = [];
    let drawingCityBar = false;
    const context = {
      canvas: { width: 800, height: 600 },
      fillRect: vi.fn(() => {
        if (!drawingCityBar) {
          calls.push('citybar');
          drawingCityBar = true;
        }
      }),
      drawImage: vi.fn(() => calls.push('output')),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 32 }),
    } as unknown as CanvasRenderingContext2D;
    const renderer = new CityRenderer(
      context,
      createLegacyTileset(key =>
        key.startsWith('city.t_') ? ({} as HTMLCanvasElement) : null
      ) as never,
      96,
      48
    );
    const city = {
      id: 'known',
      name: 'Alpha',
      playerId: 'self',
      x: 0,
      y: 0,
      size: 3,
      buildings: [],
      workableTiles: [
        { x: 0, y: 0, isWorked: true, isCenter: true, outputs: { food: 2, shields: 1, trade: 1 } },
      ],
    } as unknown as City;
    const state = {
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      map: {
        topology_id: 1,
        tiles: { '0,0': { x: 0, y: 0, terrain: 'plains', known: true, visible: true } },
      },
      cities: { known: city },
      units: {},
      players: { self: { color: '#22d3ee' } },
      selectedCityId: 'known',
    } as unknown as RenderState;

    renderer.renderCityOverlays(state);

    expect(calls).toEqual(['citybar', 'output', 'output', 'output']);
  });

  it('uses the coarse occupied sprite for a foreign city without leaking units', () => {
    const context = {
      canvas: { width: 800, height: 600 },
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 32 }),
    } as unknown as CanvasRenderingContext2D;
    const occupiedSprite = {} as HTMLCanvasElement;
    const renderer = new CityRenderer(
      context,
      createLegacyTileset(key =>
        key === 'citybar.occupied' ? occupiedSprite : undefined
      ) as never,
      96,
      48
    );
    const city = {
      id: 'foreign',
      name: 'Beta',
      playerId: 'other',
      x: 0,
      y: 0,
      size: 2,
      occupied: true,
      buildings: [],
    } as unknown as City;

    renderer.renderCityOverlays({
      viewport: { x: 0, y: 0, width: 800, height: 600 },
      map: { tiles: { '0,0': { x: 0, y: 0, terrain: 'plains', known: true, visible: true } } },
      cities: { foreign: city },
      units: {},
      players: { other: { color: '#f00', name: 'Other', nation: 'other' } },
      currentPlayerId: 'self',
    } as unknown as RenderState);

    expect(context.drawImage).toHaveBeenCalledWith(
      occupiedSprite,
      expect.any(Number),
      expect.any(Number)
    );
  });
});
