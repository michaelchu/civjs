import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Player } from '../../../types';
import { SpaceRaceReport } from '../SpaceRaceReport';

const players: Record<string, Player> = {
  'player-1': {
    id: 'player-1',
    name: 'Player One',
    nation: 'Romans',
    color: '#67e8f9',
    gold: 20,
    science: 10,
    history: 0,
    government: 'despotism',
    isHuman: true,
    isActive: true,
    spaceshipState: { structurals: 16, components: 8, modules: 3 },
  },
  'player-2': {
    id: 'player-2',
    name: 'Player Two',
    nation: 'Greeks',
    color: '#c4b5fd',
    gold: 8,
    science: 5,
    history: 0,
    government: 'despotism',
    isHuman: false,
    isActive: true,
    spaceshipState: {
      structurals: 4,
      components: 2,
      modules: 1,
      launchedTurn: 18,
      arrivalTurn: 30,
    },
  },
};

describe('SpaceRaceReport', () => {
  it('renders launch readiness and public race standings', () => {
    render(
      <SpaceRaceReport
        open
        onOpenChange={vi.fn()}
        players={players}
        currentPlayerId="player-1"
        currentTurn={20}
      />
    );

    expect(screen.getByRole('heading', { name: 'Space race' })).toBeInTheDocument();
    expect(screen.getAllByText('Ready to launch').length).toBeGreaterThan(0);
    expect(screen.getByText('Construction telemetry is partial')).toBeInTheDocument();
    expect(screen.getByText('Romans (You)')).toBeInTheDocument();
    expect(screen.getByText('In flight')).toBeInTheDocument();
  });

  it('shows arrival state once the current turn reaches the arrival turn', () => {
    const arrivedPlayers = {
      ...players,
      'player-1': {
        ...players['player-1'],
        spaceshipState: {
          structurals: 16,
          components: 8,
          modules: 3,
          launchedTurn: 12,
          arrivalTurn: 20,
        },
      },
    };

    render(
      <SpaceRaceReport
        open
        onOpenChange={vi.fn()}
        players={arrivedPlayers}
        currentPlayerId="player-1"
        currentTurn={20}
      />
    );

    expect(screen.getAllByText('Arrived').length).toBeGreaterThan(0);
    expect(screen.getByText('Arrival turn 20')).toBeInTheDocument();
  });
});
