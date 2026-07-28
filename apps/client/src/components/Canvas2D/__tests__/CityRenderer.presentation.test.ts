import { describe, expect, it, vi } from 'vitest';
import type { City } from '../../../types';
import { CityRenderer } from '../renderers/CityRenderer';
import type { RenderState } from '../renderers/BaseRenderer';

describe('CityRenderer presentation state', () => {
  it('uses server-resolved style, wall, overlay, and status sprites', () => {
    const renderer = new CityRenderer(
      {} as CanvasRenderingContext2D,
      { getSprite: () => ({}) } as never,
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

    expect(sprites.map(sprite => sprite.key)).toEqual([
      'city.coastal_underlay',
      'city.industrial_wall_2',
      'city.coastal_overlay',
      'city.starve',
      'city.disorder',
    ]);
  });

  it('does not render a leaked city on an unknown tile', () => {
    const renderer = new CityRenderer(
      { canvas: { width: 800, height: 600 } } as CanvasRenderingContext2D,
      { getSprite: () => undefined } as never,
      96,
      48
    );
    const renderCity = vi.spyOn(renderer as never, 'renderCity').mockImplementation(() => {});
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
      { getSprite: () => undefined } as never,
      96,
      48
    );
    const renderCity = vi.spyOn(renderer as never, 'renderCity').mockImplementation(() => {});
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
});
