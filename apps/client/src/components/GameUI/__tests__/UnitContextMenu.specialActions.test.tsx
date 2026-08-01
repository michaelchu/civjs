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

  it('presents the legacy auto-settler wire action as Auto Worker', () => {
    const onActionSelect = vi.fn();
    render(
      <UnitContextMenu
        unit={{
          ...unit,
          capabilities: {
            ...unit.capabilities!,
            canBuildImprovements: true,
            unitActions: [ActionType.AUTO_SETTLER],
          },
        }}
        position={{ x: 10, y: 10 }}
        onClose={vi.fn()}
        onActionSelect={onActionSelect}
      />
    );

    expect(screen.queryByText('Auto Settler')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Auto Worker'));
    expect(onActionSelect).toHaveBeenCalledWith(ActionType.AUTO_SETTLER);
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

  it('renders Milestone 14 actions only when advertised by the server', () => {
    const onActionSelect = vi.fn();
    render(
      <UnitContextMenu
        unit={{
          ...unit,
          capabilities: {
            ...unit.capabilities!,
            unitActions: [
              ActionType.MARKETPLACE,
              ActionType.HELP_WONDER,
              ActionType.CHANGE_HOME_CITY,
              ActionType.UPGRADE_UNIT,
              ActionType.DISBAND_UNIT_RECOVER,
            ],
          },
        }}
        position={{ x: 10, y: 10 }}
        onClose={vi.fn()}
        onActionSelect={onActionSelect}
      />
    );

    expect(screen.getByText('Sell Goods')).toBeInTheDocument();
    expect(screen.getByText('Help Wonder')).toBeInTheDocument();
    expect(screen.getByText('Change Home City')).toBeInTheDocument();
    expect(screen.getByText('Upgrade Unit')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Disband and Recover Shields'));
    expect(onActionSelect).toHaveBeenCalledWith(ActionType.DISBAND_UNIT_RECOVER);
  });

  it('renders Milestone 15 combat consequences only when advertised', () => {
    const onActionSelect = vi.fn();
    render(
      <UnitContextMenu
        unit={{
          ...unit,
          capabilities: {
            ...unit.capabilities!,
            unitActions: [
              ActionType.NUCLEAR_EXPLOSION,
              ActionType.COLLECT_RANSOM,
              ActionType.SUICIDE_ATTACK,
            ],
          },
        }}
        position={{ x: 10, y: 10 }}
        onClose={vi.fn()}
        onActionSelect={onActionSelect}
      />
    );

    expect(screen.getByText('Detonate Nuclear')).toBeInTheDocument();
    expect(screen.getByText('Collect Ransom')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Suicide Attack'));
    expect(onActionSelect).toHaveBeenCalledWith(ActionType.SUICIDE_ATTACK);
  });

  it('uses the authoritative worker availability projection for the build menu', () => {
    render(
      <UnitContextMenu
        unit={{
          ...unit,
          capabilities: {
            ...unit.capabilities!,
            canBuildImprovements: true,
            availableWorkerActions: [ActionType.BUILD_ROAD],
          },
        }}
        position={{ x: 10, y: 10 }}
        onClose={vi.fn()}
        onActionSelect={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Build'));
    expect(screen.getByText('Build Road')).toBeInTheDocument();
    expect(screen.queryByText('Build Railroad')).not.toBeInTheDocument();
    expect(screen.queryByText('Build Irrigation')).not.toBeInTheDocument();
  });
});
