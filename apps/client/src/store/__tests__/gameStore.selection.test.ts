import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../gameStore';
import type { Unit } from '../../types';

const units: Record<string, Unit> = {
  one: {
    id: 'one',
    playerId: 'player-1',
    unitTypeId: 'warriors',
    x: 1,
    y: 1,
    hp: 100,
    movesLeft: 2,
    veteranLevel: 0,
  },
  two: {
    id: 'two',
    playerId: 'player-1',
    unitTypeId: 'settlers',
    x: 1,
    y: 1,
    hp: 100,
    movesLeft: 2,
    veteranLevel: 0,
  },
  foreign: {
    id: 'foreign',
    playerId: 'player-2',
    unitTypeId: 'warriors',
    x: 1,
    y: 1,
    hp: 100,
    movesLeft: 2,
    veteranLevel: 0,
  },
};

describe('game store map selection actions', () => {
  beforeEach(() => {
    useGameStore.setState({
      currentPlayerId: 'player-1',
      units,
      selectedUnitId: null,
      selectedCityId: 'city-1',
      focusedUnits: [],
    });
  });

  it('selects only owned units for area and context-menu selection', () => {
    useGameStore.getState().selectUnits(['foreign', 'two', 'one']);

    expect(useGameStore.getState().focusedUnits).toEqual(['two', 'one']);
    expect(useGameStore.getState().selectedUnitId).toBe('two');
    expect(useGameStore.getState().selectedCityId).toBeNull();
  });

  it('toggles a complete stack as one shift-selection operation', () => {
    useGameStore.getState().toggleUnits(['one', 'two']);
    expect(useGameStore.getState().focusedUnits).toEqual(['one', 'two']);

    useGameStore.getState().toggleUnits(['one', 'two']);
    expect(useGameStore.getState().focusedUnits).toEqual([]);
    expect(useGameStore.getState().selectedUnitId).toBeNull();
  });
});
