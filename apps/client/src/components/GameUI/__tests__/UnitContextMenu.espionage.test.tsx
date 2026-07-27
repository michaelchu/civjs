import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UnitContextMenu } from '../UnitContextMenu';
import { ActionType } from '../../../types/shared/actions';
import type { Unit } from '../../../types';

describe('UnitContextMenu classic espionage actions', () => {
  const spy: Unit = {
    id: 'spy-1',
    playerId: 'player-1',
    unitTypeId: 'spy',
    x: 4,
    y: 5,
    hp: 100,
    movesLeft: 9,
    veteranLevel: 0,
    capabilities: {
      canFortify: false,
      canFoundCity: false,
      canBuildImprovements: false,
      canPillage: false,
      canTrade: false,
      diplomatActions: ['bribe_unit', 'incite_city', 'poison_water', 'sabotage_unit'],
    },
  };

  it('renders server-advertised classic actions and selects them', () => {
    const onActionSelect = vi.fn();
    render(
      <UnitContextMenu
        unit={spy}
        position={{ x: 10, y: 10 }}
        onClose={vi.fn()}
        onActionSelect={onActionSelect}
      />
    );

    expect(screen.getByText('Bribe Unit')).toBeInTheDocument();
    expect(screen.getByText('Incite Revolt')).toBeInTheDocument();
    expect(screen.getByText('Poison City')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Sabotage Unit'));
    expect(onActionSelect).toHaveBeenCalledWith(ActionType.SABOTAGE_UNIT);
  });
});
