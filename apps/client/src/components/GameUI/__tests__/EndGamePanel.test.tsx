import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { EndGamePanel } from '../EndGamePanel';
import { useGameStore } from '../../../store/gameStore';

describe('EndGamePanel', () => {
  beforeEach(() => {
    useGameStore.setState({
      currentPlayerId: 'player-1',
      endGameReport: {
        version: 1,
        gameId: 'game-1',
        turn: 42,
        year: -2320,
        reason: 'conquest',
        winnerPlayerId: 'player-1',
        winnerPlayerIds: ['player-1'],
        endedAt: '2026-07-26T12:00:00.000Z',
        standings: [
          {
            playerId: 'player-1',
            civilization: 'Roman',
            score: 410,
            cities: 2,
            population: 8,
            units: 1,
            technologies: 2,
            history: 10,
            alive: true,
          },
        ],
      },
    });
  });

  it('renders a labelled final standings dialog', () => {
    render(<EndGamePanel />);

    expect(screen.getByRole('dialog', { name: 'Victory' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Final civilization standings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to game list' })).toHaveAttribute('href', '/');
  });
});
