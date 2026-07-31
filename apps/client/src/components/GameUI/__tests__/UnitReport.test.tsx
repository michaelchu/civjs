import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { City, Unit } from '../../../types';
import { useGameStore } from '../../../store/gameStore';
import { UnitReport } from '../UnitReport';

const units: Record<string, Unit> = {
  'unit-1': {
    id: 'unit-1',
    playerId: 'player-1',
    unitTypeId: 'warrior',
    x: 2,
    y: 3,
    hp: 100,
    movesLeft: 1,
    maxMoves: 1,
    veteranLevel: 1,
    homeCityId: 'city-1',
    upkeep: { food: 1, shields: 0, gold: 2 },
  },
  'unit-2': {
    id: 'unit-2',
    playerId: 'player-2',
    unitTypeId: 'scout',
    x: 6,
    y: 7,
    hp: 90,
    movesLeft: 0,
    veteranLevel: 0,
  },
};

const cities = {
  'city-1': { id: 'city-1', name: 'Rome', playerId: 'player-1' },
} as unknown as Record<string, City>;

describe('UnitReport', () => {
  it('shows own-unit upkeep and excludes foreign units', () => {
    render(
      <UnitReport
        open
        onOpenChange={vi.fn()}
        units={units}
        cities={cities}
        currentPlayerId="player-1"
      />
    );
    expect(screen.getByRole('heading', { name: 'Units and upkeep' })).toBeInTheDocument();
    expect(screen.getByText('Warrior')).toBeInTheDocument();
    expect(screen.queryByText('Scout')).not.toBeInTheDocument();
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
    expect(screen.getByText('Rome')).toBeInTheDocument();
  });

  it('focuses a unit and requests map centering from the roster', () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    render(
      <UnitReport
        open
        onOpenChange={vi.fn()}
        units={units}
        cities={cities}
        currentPlayerId="player-1"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Focus Warrior' }));
    expect(useGameStore.getState().selectedUnitId).toBe('unit-1');
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'center-map-on-tile' })
    );
  });
});
