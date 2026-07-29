import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gameClient } from '../../../services/GameClient';
import { useGameStore } from '../../../store/gameStore';
import { GameOptionsPanel } from '../GameOptionsPanel';

describe('GameOptionsPanel advisor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGameStore.setState({
      currentGameId: 'game-1',
      turn: 12,
      year: -3520,
    });
    vi.spyOn(gameClient, 'getTaxRates').mockResolvedValue({
      tax: 50,
      luxury: 20,
      science: 30,
    });
    vi.spyOn(gameClient, 'getHostControls').mockResolvedValue({
      isHost: false,
      paused: false,
      turnTimeLimit: 120,
    });
    vi.spyOn(gameClient, 'setDebugVisibility').mockResolvedValue(false);
  });

  it('renders recommendations from the shared native planners on demand', async () => {
    const getAdvice = vi.spyOn(gameClient, 'getAdvisorRecommendations').mockResolvedValue({
      playerId: 'player-1',
      turn: 12,
      economy: {
        reserve: 45,
        rates: { tax: 40, luxury: 10, science: 50 },
        rushCityIds: ['capital'],
        saleCandidates: [],
      },
      research: [{ technologyId: 'writing', want: 72, reason: 'unlocks valuable research paths' }],
      cities: [
        {
          cityId: 'capital',
          danger: 0,
          urgency: 0,
          production: [{ kind: 'building', id: 'library', want: 60, reason: 'science' }],
        },
      ],
      workers: [],
      exploration: [],
      military: [],
    });

    render(<GameOptionsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Get advice' }));

    await waitFor(() => expect(getAdvice).toHaveBeenCalledOnce());
    expect(await screen.findByText('Keep 45 gold in reserve')).toBeInTheDocument();
    expect(screen.getByText(/writing \(72\)/)).toBeInTheDocument();
    expect(screen.getByText('capital: building library (60)')).toBeInTheDocument();
    expect(screen.getByText('No unit reassignment recommended')).toBeInTheDocument();
  });
});
