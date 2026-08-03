import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '../../../types';
import { gameClient } from '../../../services/GameClient';
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
    spaceshipState: {
      status: 'started',
      structurals: 8,
      components: 2,
      modules: 3,
      placedStructurals: [0, 1, 2, 3, 4, 5, 6, 7],
      fuel: 1,
      propulsion: 1,
      habitation: 1,
      lifeSupport: 1,
      solarPanels: 1,
      successRate: 100,
      travelTime: 25.4545,
    },
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
      status: 'launched',
      structurals: 4,
      components: 2,
      modules: 1,
      launchYear: 2000,
      arrivalYear: 2025,
    },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SpaceRaceReport', () => {
  it('renders source-aligned readiness and public race standings', () => {
    render(
      <SpaceRaceReport
        open
        onOpenChange={vi.fn()}
        players={players}
        currentPlayerId="player-1"
        currentYear={2010}
      />
    );

    expect(screen.getByRole('heading', { name: 'Space race' })).toBeInTheDocument();
    expect(screen.getAllByText('Ready to launch').length).toBeGreaterThan(0);
    expect(screen.getByText('Authoritative assembly')).toBeInTheDocument();
    expect(screen.getByText('Romans (You)')).toBeInTheDocument();
    expect(screen.getByText('In flight')).toBeInTheDocument();
    expect(screen.getByText('2025')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Launch spaceship' })).toBeEnabled();
  });

  it('shows arrival state once the current calendar year reaches the arrival year', () => {
    const arrivedPlayers = {
      ...players,
      'player-1': {
        ...players['player-1'],
        spaceshipState: {
          ...players['player-1'].spaceshipState,
          status: 'launched',
          launchYear: 2000,
          arrivalYear: 2020,
        },
      },
    };

    render(
      <SpaceRaceReport
        open
        onOpenChange={vi.fn()}
        players={arrivedPlayers}
        currentPlayerId="player-1"
        currentYear={2020}
      />
    );

    expect(screen.getAllByText('Arrived').length).toBeGreaterThan(0);
    expect(screen.getByText('Arrival year 2020')).toBeInTheDocument();
  });

  it('routes an eligible launch request through the authoritative client protocol', async () => {
    const launch = vi.spyOn(gameClient, 'launchSpaceship').mockResolvedValue({
      status: 'launched',
      structurals: 8,
      components: 2,
      modules: 3,
    });

    render(
      <SpaceRaceReport
        open
        onOpenChange={vi.fn()}
        players={players}
        currentPlayerId="player-1"
        currentYear={2010}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Launch spaceship' }));

    await waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
  });
});
