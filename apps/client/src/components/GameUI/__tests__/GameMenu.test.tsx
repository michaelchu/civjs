import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gameClient } from '../../../services/GameClient';
import { useGameStore } from '../../../store/gameStore';
import { GameMenu } from '../GameMenu';
import { GameTabs } from '../GameTabs';

const CurrentPath = () => <div data-testid="current-path">{useLocation().pathname}</div>;

describe('GameMenu', () => {
  beforeEach(() => {
    useGameStore.setState({
      activeTab: 'map',
      clientState: 'running',
      currentGameId: 'game-1',
    });
    vi.restoreAllMocks();
  });

  it('moves Settings out of the tabs and opens it from the menu', () => {
    render(
      <MemoryRouter>
        <GameTabs />
        <GameMenu />
      </MemoryRouter>
    );

    expect(screen.queryByRole('button', { name: /Settings screen/ })).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Game menu' }), {
      key: 'ArrowDown',
    });
    expect(screen.getByRole('menu')).toHaveClass('bg-slate-950/90', 'backdrop-blur-md');
    fireEvent.click(screen.getByRole('menuitem', { name: /Settings/ }));

    expect(useGameStore.getState().activeTab).toBe('options');
  });

  it('disconnects and returns to the lobby after confirmation', () => {
    const disconnect = vi.spyOn(gameClient, 'disconnect').mockImplementation(() => undefined);

    render(
      <MemoryRouter initialEntries={['/game/game-1']}>
        <GameMenu />
        <CurrentPath />
      </MemoryRouter>
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Game menu' }), {
      key: 'ArrowDown',
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Exit Game' }));
    expect(screen.getByRole('dialog')).toHaveClass('bg-slate-900/95', 'backdrop-blur-md');
    fireEvent.click(screen.getByRole('button', { name: 'Exit Game' }));

    expect(disconnect).toHaveBeenCalledOnce();
    expect(screen.getByTestId('current-path')).toHaveTextContent('/browse-games');
    expect(useGameStore.getState()).toMatchObject({
      activeTab: 'map',
      clientState: 'initial',
      currentGameId: null,
    });
  });
});
