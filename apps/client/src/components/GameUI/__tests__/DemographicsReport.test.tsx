import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { City, Player, Tile, Unit } from '../../../types';
import { DemographicsReport } from '../DemographicsReport';

const players: Record<string, Player> = {
  'player-1': {
    id: 'player-1', name: 'Player One', nation: 'Romans', color: '#67e8f9', gold: 20, goldPerTurn: 3,
    science: 10, sciencePerTurn: 5, history: 0, government: 'despotism', isHuman: true, isActive: true,
  },
  'player-2': {
    id: 'player-2', name: 'Player Two', nation: 'Greeks', color: '#c4b5fd', gold: 8, goldPerTurn: -1,
    science: 5, sciencePerTurn: 2, history: 0, government: 'despotism', isHuman: false, isActive: true,
  },
};

const cities = {
  rome: { id: 'rome', name: 'Rome', playerId: 'player-1', x: 1, y: 1, size: 4 },
  athens: { id: 'athens', name: 'Athens', playerId: 'player-2', x: 2, y: 2, size: 2 },
} as unknown as Record<string, City>;

const units = {
  warrior: { id: 'warrior', playerId: 'player-1' },
  scout: { id: 'scout', playerId: 'player-2' },
} as unknown as Record<string, Unit>;

const tiles = {
  '1,1': { x: 1, y: 1, owner: 'player-1', known: true, visible: true },
  '2,2': { x: 2, y: 2, owner: 'player-2', known: true, visible: true },
} as unknown as Record<string, Tile>;

describe('DemographicsReport', () => {
  it('renders comparative empire metrics from current state', () => {
    render(
      <DemographicsReport
        open
        onOpenChange={vi.fn()}
        players={players}
        cities={cities}
        units={units}
        tiles={tiles}
        technologies={{ writing: { discovered: true } }}
        currentPlayerId="player-1"
      />
    );

    expect(screen.getByRole('heading', { name: 'Demographics' })).toBeInTheDocument();
    expect(screen.getAllByText('Romans').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Greeks').length).toBeGreaterThan(0);
    expect(screen.getByText('Population comparison')).toBeInTheDocument();
    expect(screen.getByText('+5')).toBeInTheDocument();
  });

  it('switches the comparison metric', () => {
    render(
      <DemographicsReport
        open
        onOpenChange={vi.fn()}
        players={players}
        cities={cities}
        units={units}
        tiles={tiles}
        technologies={{}}
        currentPlayerId="player-1"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Units' }));
    expect(screen.getByText('Units comparison')).toBeInTheDocument();
  });
});
