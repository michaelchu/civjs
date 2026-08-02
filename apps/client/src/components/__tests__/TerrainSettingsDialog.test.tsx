import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TerrainSettingsDialog } from '../TerrainSettingsDialog';
import { useGameCreationStore } from '../../store/gameCreationStore';

describe('TerrainSettingsDialog', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    useGameCreationStore.setState({
      _hasHydrated: true,
      formData: {
        gameName: 'Game',
        gameType: 'single',
        maxPlayers: 4,
        mapSize: 'standard',
        nationSet: 'core',
        selectedNation: 'random',
        aiLevel: 'normal',
        scienceBox: 150,
      },
      terrainSettings: {
        generator: 'random',
        landmass: 'normal',
        huts: 15,
        temperature: 50,
        wetness: 50,
        rivers: 50,
        resources: 'normal',
        startpos: 0,
      },
    });
  });

  it('does not offer scenario generation while the capability is deferred', () => {
    render(
      <MemoryRouter>
        <TerrainSettingsDialog />
      </MemoryRouter>
    );

    fireEvent.click(screen.getAllByRole('combobox')[0]);

    expect(screen.queryByText('Classic scenario')).not.toBeInTheDocument();
    expect(screen.getAllByText('Default Random')).not.toHaveLength(0);
    expect(screen.getByText('Fracture')).toBeInTheDocument();
  });
});
