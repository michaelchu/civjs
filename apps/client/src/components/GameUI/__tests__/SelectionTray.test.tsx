import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../../store/gameStore';
import type { City, Unit } from '../../../types';
import { SelectionTray } from '../SelectionTray';

const unit = {
  id: 'unit-1',
  playerId: 'player-1',
  unitTypeId: 'warriors',
  x: 2,
  y: 3,
  hp: 80,
  movesLeft: 2,
  maxMoves: 3,
  veteranLevel: 1,
  fortified: false,
  capabilities: {
    canFortify: true,
    canFoundCity: false,
    canBuildImprovements: false,
    canPillage: false,
    canTrade: false,
  },
} as Unit;

const city = {
  id: 'city-1',
  name: 'Rome',
  playerId: 'player-1',
  x: 2,
  y: 3,
  size: 4,
  history: 0,
  food: 2,
  shields: 3,
  trade: 4,
  prod: { food: 2, shields: 3, trade: 4, gold: 1, luxury: 0, science: 2 },
  surplus: { food: 1, shields: 3, trade: 4, gold: 1, luxury: 0, science: 2 },
  waste: { shields: 0, trade: 0 },
  foodStock: 5,
  granarySize: 20,
  granaryTurns: 3,
  citizens: { happy: 1, content: 2, unhappy: 1, angry: 0, specialists: {} },
  buildings: [],
  presentUnits: [],
  supportedUnits: [],
  workableTiles: [],
  worklist: [],
  tradeRoutes: [],
  celebrating: false,
  disorder: false,
  pollution: 0,
} as City;

describe('SelectionTray', () => {
  beforeEach(() => {
    useGameStore.setState({
      currentPlayerId: 'player-1',
      clientState: 'running',
      phase: 'movement',
      selectedUnitId: null,
      selectedCityId: null,
      focusedUnits: [],
      urgentFocusQueue: [],
      units: { 'unit-1': unit },
      cities: {},
    });
  });

  it('shows pending-unit guidance when nothing is selected', () => {
    render(<SelectionTray />);

    expect(screen.getByText('Select a unit or city')).toBeInTheDocument();
    expect(screen.getByText('1 pending')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Focus next unit' })).toBeInTheDocument();
  });

  it('shows unit context and clears the selection', () => {
    useGameStore.setState({ selectedUnitId: 'unit-1', focusedUnits: ['unit-1'] });
    render(<SelectionTray />);

    expect(screen.getByText('Warriors')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear unit selection' }));
    expect(useGameStore.getState().selectedUnitId).toBeNull();
  });

  it('shows queued order state when the unit has a command queue', () => {
    useGameStore.setState({
      selectedUnitId: 'unit-1',
      focusedUnits: ['unit-1'],
      units: { 'unit-1': { ...unit, orders: [{ type: 'goto', targetX: 6, targetY: 7 }] } },
    });
    render(<SelectionTray />);

    expect(screen.getByText('2, 3 · 1 queued · Goto')).toBeInTheDocument();
    expect(screen.getByText('1 queued')).toBeInTheDocument();
    expect(screen.getByTitle(/queued orders/)).toBeInTheDocument();
  });

  it('shows city production context and dispatches the city-details request', () => {
    useGameStore.setState({ selectedCityId: 'city-1', cities: { 'city-1': city } });
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    render(<SelectionTray />);

    expect(screen.getByText('Rome')).toBeInTheDocument();
    expect(screen.getByText('Building')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open city' }));
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'show-city-info' }));
  });
});
