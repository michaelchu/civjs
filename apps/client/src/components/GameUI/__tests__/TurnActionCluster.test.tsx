import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../../store/gameStore';
import { TurnActionCluster } from '../TurnActionCluster';

describe('TurnActionCluster', () => {
  beforeEach(() => {
    useGameStore.setState({
      activeTab: 'map',
      clientState: 'running',
      currentPlayerId: 'player-1',
      phase: 'movement',
      players: {
        'player-1': {
          id: 'player-1',
          name: 'Player',
          nation: 'Romans',
          color: '#4ade80',
          gold: 10,
          science: 5,
          history: 0,
          government: 'despotism',
          isHuman: true,
          isActive: true,
        },
      },
      units: {
        'unit-1': {
          id: 'unit-1',
          playerId: 'player-1',
          unitTypeId: 'warrior',
          x: 4,
          y: 5,
          hp: 100,
          movesLeft: 1,
          veteranLevel: 0,
        },
      },
      urgentFocusQueue: ['unit-1'],
      turnProcessingState: 'idle',
    });
  });

  it('reviews and acknowledges urgent units', () => {
    render(
      <MemoryRouter>
        <TurnActionCluster />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /review 1 urgent action/i }));
    expect(useGameStore.getState().selectedUnitId).toBe('unit-1');
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(useGameStore.getState().urgentFocusQueue).toEqual([]);
  });

  it('exposes available reports and keyboard help without leaving the map by default', () => {
    render(
      <MemoryRouter>
        <TurnActionCluster />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    expect(screen.getByText('Reports and management')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /research/i }));
    expect(useGameStore.getState().activeTab).toBe('research');

    useGameStore.getState().setActiveTab('map');
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByText('Command help')).toBeInTheDocument();
    expect(useGameStore.getState().activeTab).toBe('map');
  });

  it('opens the unit report from the reports menu', () => {
    const onOpenUnitReport = vi.fn();

    render(
      <MemoryRouter>
        <TurnActionCluster onOpenUnitReport={onOpenUnitReport} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    fireEvent.click(screen.getByRole('button', { name: 'Units' }));

    expect(onOpenUnitReport).toHaveBeenCalledOnce();
  });

  it('opens the intelligence report from the reports menu', () => {
    const onOpenIntelligence = vi.fn();

    render(
      <MemoryRouter>
        <TurnActionCluster onOpenIntelligence={onOpenIntelligence} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    fireEvent.click(screen.getByRole('button', { name: 'Intelligence' }));

    expect(onOpenIntelligence).toHaveBeenCalledOnce();
  });

  it('opens the space-race report from the reports menu', () => {
    const onOpenSpaceRace = vi.fn();

    render(
      <MemoryRouter>
        <TurnActionCluster onOpenSpaceRace={onOpenSpaceRace} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    fireEvent.click(screen.getByRole('button', { name: 'Space race' }));

    expect(onOpenSpaceRace).toHaveBeenCalledOnce();
  });

  it('opens the war calculator from the reports menu', () => {
    const onOpenWarCalculator = vi.fn();

    render(
      <MemoryRouter>
        <TurnActionCluster onOpenWarCalculator={onOpenWarCalculator} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    fireEvent.click(screen.getByRole('button', { name: 'War calculator' }));

    expect(onOpenWarCalculator).toHaveBeenCalledOnce();
  });
});
