import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../../store/gameStore';
import { ObjectivesJournal } from '../ObjectivesJournal';

describe('ObjectivesJournal', () => {
  beforeEach(() => {
    useGameStore.setState({
      activeTab: 'map',
      currentPlayerId: 'player-1',
      cities: {
        'city-1': {
          id: 'city-1',
          name: 'Alpha',
          playerId: 'player-1',
          x: 3,
          y: 4,
          size: 2,
          food: 2,
          shields: 1,
          trade: 1,
          history: 0,
          prod: { food: 2, shields: 1, trade: 1, gold: 0, luxury: 0, science: 0 },
          surplus: { food: -1, shields: 1, trade: 1, gold: 0, luxury: 0, science: 0 },
          waste: { shields: 0, trade: 0 },
          foodStock: 0,
          granarySize: 10,
          granaryTurns: -1,
          citizens: { happy: 1, content: 1, unhappy: 0, angry: 0, specialists: {} },
          buildings: [],
          presentUnits: [],
          supportedUnits: [],
          worklist: [],
          tradeRoutes: [],
          celebrating: false,
          disorder: false,
          pollution: 0,
        },
      },
      units: {
        'unit-1': {
          id: 'unit-1',
          playerId: 'player-1',
          unitTypeId: 'scout',
          x: 5,
          y: 6,
          hp: 100,
          movesLeft: 1,
          veteranLevel: 0,
        },
      },
      technologies: {
        writing: { id: 'writing', name: 'Writing', cost: 40, requirements: [], discovered: false },
      },
      research: {
        currentTech: 'writing',
        bulbsAccumulated: 12,
        bulbsLastTurn: 4,
        researchedTechs: new Set(),
        availableTechs: new Set(['writing']),
        futureTechs: 0,
      },
      notifications: [{ id: 'event-1', message: 'A border expanded', tone: 'info' }],
      urgentFocusQueue: ['unit-1'],
    });
  });

  it('shows research, city attention, awaiting orders, and recent events', () => {
    render(<ObjectivesJournal />);
    expect(screen.getByText('Writing')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Scout')).toBeInTheDocument();
    expect(screen.getByText('A border expanded')).toBeInTheDocument();
  });

  it('centers and selects a city alert', () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    render(<ObjectivesJournal />);
    fireEvent.click(screen.getByRole('button', { name: /center on alpha/i }));
    expect(useGameStore.getState().selectedCityId).toBe('city-1');
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'center-map-on-tile' })
    );
  });

  it('collapses to an urgent-count affordance', () => {
    render(<ObjectivesJournal />);
    fireEvent.click(screen.getByRole('button', { name: /collapse objectives/i }));
    expect(screen.getByRole('button', { name: /expand objectives/i })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('reopens the full panel when expanded from the collapsed mobile affordance', () => {
    render(<ObjectivesJournal />);

    fireEvent.click(screen.getByRole('button', { name: /collapse objectives/i }));
    fireEvent.click(screen.getByRole('button', { name: /expand objectives/i }));

    expect(screen.getByText('City attention')).toBeInTheDocument();
  });

  it('keeps objectives accessible through a compact mobile entry point', () => {
    render(<ObjectivesJournal />);

    fireEvent.click(screen.getByRole('button', { name: 'Open objectives and journal' }));

    expect(screen.getByText('City attention')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /collapse objectives/i })).toBeInTheDocument();
  });
});
