import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UnitContextMenu } from '../UnitContextMenu';
import { ActionType } from '../../../types/shared/actions';
import type { Unit } from '../../../types';

describe('UnitContextMenu classic special actions', () => {
  const unit: Unit = {
    id: 'unit-1',
    playerId: 'player-1',
    unitTypeId: 'paratroopers',
    x: 4,
    y: 5,
    hp: 100,
    movesLeft: 3,
    veteranLevel: 0,
    capabilities: {
      canFortify: true,
      canFoundCity: false,
      canBuildImprovements: false,
      canPillage: true,
      canTrade: false,
      unitActions: ['paradrop', 'airlift', 'auto_explore'],
    },
  };

  it('renders and selects server-advertised target and automation actions', () => {
    const onActionSelect = vi.fn();
    render(
      <UnitContextMenu
        unit={unit}
        position={{ x: 10, y: 10 }}
        onClose={vi.fn()}
        onActionSelect={onActionSelect}
      />
    );

    expect(screen.getByText('Paradrop')).toBeInTheDocument();
    expect(screen.getByText('Airlift')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Auto Explore'));
    expect(onActionSelect).toHaveBeenCalledWith(ActionType.AUTO_EXPLORE);
  });

  it('does not render capabilities the server did not advertise', () => {
    render(
      <UnitContextMenu
        unit={{ ...unit, capabilities: { ...unit.capabilities!, unitActions: [] } }}
        position={{ x: 10, y: 10 }}
        onClose={vi.fn()}
        onActionSelect={vi.fn()}
      />
    );

    expect(screen.queryByText('Paradrop')).not.toBeInTheDocument();
    expect(screen.queryByText('Airlift')).not.toBeInTheDocument();
    expect(screen.queryByText('Auto Explore')).not.toBeInTheDocument();
  });
});
