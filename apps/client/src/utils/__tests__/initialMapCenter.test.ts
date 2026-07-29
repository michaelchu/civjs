import { describe, expect, it } from 'vitest';
import type { City, Tile, Unit } from '../../types';
import { findInitialMapCenter } from '../initialMapCenter';

const visibleTile: Tile = {
  x: 2,
  y: 3,
  terrain: 'grassland',
  visible: true,
  known: true,
  units: [],
};

const playerUnit: Unit = {
  id: 'unit-1',
  playerId: 'player-1',
  unitTypeId: 'settlers',
  x: 15,
  y: 20,
  hp: 100,
  movesLeft: 1,
  veteranLevel: 0,
};

const baseOptions = {
  currentPlayerId: 'player-1',
  units: {},
  cities: {},
  tiles: { '2,3': visibleTile },
  hasReceivedUnitSnapshot: false,
};

describe('findInitialMapCenter', () => {
  it('waits for a player unit snapshot instead of locking onto an earlier tile batch', () => {
    expect(findInitialMapCenter(baseOptions)).toBeNull();

    expect(
      findInitialMapCenter({
        ...baseOptions,
        units: { [playerUnit.id]: playerUnit },
      })
    ).toEqual({ x: 15, y: 20 });
  });

  it('falls back to a visible tile after a full snapshot confirms the player has no units', () => {
    expect(
      findInitialMapCenter({
        ...baseOptions,
        hasReceivedUnitSnapshot: true,
      })
    ).toEqual({ x: 2, y: 3 });
  });

  it('uses an owned city before waiting for units', () => {
    const city = {
      id: 'city-1',
      playerId: 'player-1',
      x: 8,
      y: 9,
    } as City;

    expect(
      findInitialMapCenter({
        ...baseOptions,
        cities: { [city.id]: city },
      })
    ).toEqual({ x: 8, y: 9 });
  });

  it('lets observers center on a visible tile immediately', () => {
    expect(
      findInitialMapCenter({
        ...baseOptions,
        currentPlayerId: '',
      })
    ).toEqual({ x: 2, y: 3 });
  });
});
