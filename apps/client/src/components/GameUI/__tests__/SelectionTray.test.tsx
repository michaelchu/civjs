import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../../store/gameStore';
import type { City, Unit } from '../../../types';
import { SelectionTray } from '../SelectionTray';
import { gameClient } from '../../../services/GameClient';
import { ActionType } from '../../../types/shared/actions';

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
      players: {
        'player-1': {
          id: 'player-1',
          name: 'Player One',
          nation: 'roman',
          color: '#22d3ee',
          gold: 100,
          science: 10,
          history: 0,
          government: 'despotism',
          isHuman: true,
          isActive: true,
        },
      },
      selectedUnitId: null,
      selectedCityId: null,
      focusedUnits: [],
      urgentFocusQueue: [],
      units: { 'unit-1': unit },
      cities: {},
    });
  });

  it('renders nothing when no unit or city is selected', () => {
    render(<SelectionTray />);

    expect(screen.queryByText('1 pending')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Focus next unit' })).not.toBeInTheDocument();
  });

  it('shows unit context without cargo text for non-transport units', () => {
    useGameStore.setState({ selectedUnitId: 'unit-1', focusedUnits: ['unit-1'] });
    render(<SelectionTray />);

    expect(screen.getByText('Warriors')).toBeInTheDocument();
    expect(screen.queryByText('HP')).not.toBeInTheDocument();
    expect(screen.queryByText('Move')).not.toBeInTheDocument();
    expect(screen.queryByText('Rank')).not.toBeInTheDocument();
    expect(screen.getByTitle('Roman')).toBeInTheDocument();
    expect(screen.queryByText('No cargo')).not.toBeInTheDocument();
  });

  it('shows transport state for cargo units', () => {
    useGameStore.setState({
      selectedUnitId: 'unit-1',
      focusedUnits: ['unit-1'],
      units: { 'unit-1': { ...unit, cargoUnits: ['unit-2', 'unit-3'] } },
    });
    render(<SelectionTray />);

    expect(screen.getByTitle('Roman · Cargo: 2 cargo')).toBeInTheDocument();
  });

  it('disables unit actions when they are unavailable without showing a status label', () => {
    useGameStore.setState({
      selectedUnitId: 'unit-1',
      focusedUnits: ['unit-1'],
      phase: 'research',
    });
    render(<SelectionTray />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to' })).toBeDisabled();
  });

  it('keeps foreign-unit action dialogs read-only', () => {
    const foreignUnit = { ...unit, playerId: 'player-2' };
    useGameStore.setState({
      selectedUnitId: 'unit-1',
      focusedUnits: ['unit-1'],
      units: { 'unit-1': foreignUnit },
    });
    render(<SelectionTray />);

    expect(screen.getByRole('button', { name: 'More unit actions' })).toBeDisabled();
  });

  it('shows queued order controls when the unit has a command queue', () => {
    useGameStore.setState({
      selectedUnitId: 'unit-1',
      focusedUnits: ['unit-1'],
      units: { 'unit-1': { ...unit, orders: [{ type: 'goto', targetX: 6, targetY: 7 }] } },
    });
    render(<SelectionTray />);

    expect(screen.getByText('1 queued')).toBeInTheDocument();
    expect(screen.getByTitle('Queued orders')).toBeInTheDocument();
  });

  it('cancels queued orders through the authoritative unit action', async () => {
    const requestUnitAction = vi.spyOn(gameClient, 'requestUnitAction').mockResolvedValue(true);
    useGameStore.setState({
      selectedUnitId: 'unit-1',
      focusedUnits: ['unit-1'],
      units: { 'unit-1': { ...unit, orders: [{ type: 'goto', targetX: 6, targetY: 7 }] } },
    });
    render(<SelectionTray />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel orders' }));
    expect(requestUnitAction).toHaveBeenCalledWith('unit-1', ActionType.CANCEL_ORDERS);
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
