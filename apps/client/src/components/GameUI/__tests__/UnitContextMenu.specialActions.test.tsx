import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UnitContextMenu } from '../UnitContextMenu';
import { ActionType } from '../../../types/shared/actions';
import type { City, Unit } from '../../../types';

describe('UnitContextMenu special actions', () => {
  const airportCity: Pick<City, 'id' | 'playerId' | 'buildings' | 'airlift'> = {
    id: 'city-1',
    playerId: 'player-1',
    buildings: [{ id: 'airport', name: 'Airport', upkeep: 0, sellable: false }],
    airlift: {
      from: { enabled: true, available: true },
      to: { enabled: true, available: true },
    },
  };

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
        city={airportCity}
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
          homeCityId: 'old-city',
          capabilities: {
            ...unit.capabilities!,
            unitActions: [
              ActionType.MARKETPLACE,
              ActionType.HELP_WONDER,
              ActionType.CHANGE_HOME_CITY,
              ActionType.UPGRADE_UNIT,
              ActionType.DISBAND_UNIT_RECOVER,
            ],
            upgradeTarget: { unitTypeId: 'engineers', name: 'Engineers', cost: 30 },
          },
        }}
        position={{ x: 10, y: 10 }}
        city={airportCity}
        onClose={vi.fn()}
        onActionSelect={onActionSelect}
      />
    );

    expect(screen.getByText('Sell Goods')).toBeInTheDocument();
    expect(screen.getByText('Help Wonder')).toBeInTheDocument();
    expect(screen.getByText('Change Home City')).toBeInTheDocument();
    expect(screen.getByText('Upgrade to Engineers (30 gold)')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Disband and Recover Shields'));
    expect(onActionSelect).toHaveBeenCalledWith(ActionType.DISBAND_UNIT_RECOVER);
  });

  it('applies the reference movement and city gates to special actions', () => {
    render(
      <UnitContextMenu
        unit={{
          ...unit,
          movesLeft: 0,
          homeCityId: 'home-city',
          capabilities: {
            ...unit.capabilities!,
            canFoundCity: true,
            unitActions: [
              ActionType.JOIN_CITY,
              ActionType.CHANGE_HOME_CITY,
              ActionType.UPGRADE_UNIT,
              ActionType.PARADROP,
              ActionType.AIRLIFT,
            ],
          },
        }}
        position={{ x: 10, y: 10 }}
        onClose={vi.fn()}
        onActionSelect={vi.fn()}
      />
    );

    expect(screen.queryByText('Found City')).toBeInTheDocument();
    expect(screen.queryByText('Join City')).not.toBeInTheDocument();
    expect(screen.queryByText('Change Home City')).not.toBeInTheDocument();
    expect(screen.queryByText(/Upgrade to/)).not.toBeInTheDocument();
    expect(screen.queryByText('Paradrop')).not.toBeInTheDocument();
    expect(screen.queryByText('Airlift')).not.toBeInTheDocument();
  });

  it('offers Airlift only from a friendly airport city and disables it without moves', () => {
    render(
      <UnitContextMenu
        unit={{ ...unit, movesLeft: 0 }}
        position={{ x: 10, y: 10 }}
        city={airportCity}
        onClose={vi.fn()}
        onActionSelect={vi.fn()}
      />
    );

    expect(screen.getByRole('menuitem', { name: 'Airlift' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('disables Airlift when the server reports no source capacity this turn', () => {
    render(
      <UnitContextMenu
        unit={unit}
        position={{ x: 10, y: 10 }}
        city={{
          ...airportCity,
          airlift: {
            from: { enabled: true, available: false },
            to: { enabled: true, available: true },
          },
        }}
        onClose={vi.fn()}
        onActionSelect={vi.fn()}
      />
    );

    expect(screen.getByRole('menuitem', { name: 'Airlift' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('uses tile context before exposing Pillage', () => {
    const { rerender } = render(
      <UnitContextMenu
        unit={unit}
        position={{ x: 10, y: 10 }}
        onClose={vi.fn()}
        onActionSelect={vi.fn()}
      />
    );

    expect(screen.queryByText('Pillage Improvement')).not.toBeInTheDocument();

    rerender(
      <UnitContextMenu
        unit={unit}
        position={{ x: 10, y: 10 }}
        tile={{ improvements: ['road'], owner: 'player-2' }}
        onClose={vi.fn()}
        onActionSelect={vi.fn()}
      />
    );

    expect(screen.getByText('Pillage Improvement')).toBeInTheDocument();
  });

  it('does not fail open to tech-gated worker actions when no projection is present', () => {
    render(
      <UnitContextMenu
        unit={{
          ...unit,
          capabilities: {
            ...unit.capabilities!,
            canBuildImprovements: true,
            availableWorkerActions: undefined,
          },
        }}
        position={{ x: 10, y: 10 }}
        onClose={vi.fn()}
        onActionSelect={vi.fn()}
      />
    );

    expect(screen.queryByText('Build')).not.toBeInTheDocument();
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

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js:1627-1632
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js:2301-2307
   * @assertion The unit tile menu exposes tile information and whole-stack selection commands alongside unit actions.
   */
  it('exposes city, tile-info, and stack selection commands from a unit tile', () => {
    const onShowCity = vi.fn();
    const onShowTileInfo = vi.fn();
    const onSelectAllOnTile = vi.fn();
    const onSelectSameType = vi.fn();

    render(
      <UnitContextMenu
        unit={unit}
        position={{ x: 10, y: 10 }}
        onClose={vi.fn()}
        onActionSelect={vi.fn()}
        onShowCity={onShowCity}
        onShowTileInfo={onShowTileInfo}
        onSelectAllOnTile={onSelectAllOnTile}
        onSelectSameType={onSelectSameType}
      />
    );

    fireEvent.click(screen.getByText('Show City'));
    fireEvent.click(screen.getByText('Tile Info'));
    fireEvent.click(screen.getByText('Select All on Tile'));
    fireEvent.click(screen.getByText('Select Same Type'));

    expect(onShowCity).toHaveBeenCalledTimes(1);
    expect(onShowTileInfo).toHaveBeenCalledTimes(1);
    expect(onSelectAllOnTile).toHaveBeenCalledTimes(1);
    expect(onSelectSameType).toHaveBeenCalledTimes(1);
  });
});
