import { describe, expect, it } from 'vitest';
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
});
