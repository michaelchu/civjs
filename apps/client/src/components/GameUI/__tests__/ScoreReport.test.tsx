import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Player } from '../../../types';
import { ScoreReport, type ScoreSnapshot } from '../ScoreReport';

const players: Record<string, Player> = {
  'player-1': {
    id: 'player-1',
    name: 'Player One',
    nation: 'Romans',
    color: '#67e8f9',
    gold: 10,
    science: 8,
    history: 12,
    culture: 24,
    score: 180,
    government: 'despotism',
    isHuman: true,
    isActive: true,
  },
  'player-2': {
    id: 'player-2',
    name: 'Player Two',
    nation: 'Greeks',
    color: '#c4b5fd',
    gold: 12,
    science: 6,
    history: 10,
    culture: 18,
    score: 220,
    government: 'despotism',
    isHuman: false,
    isActive: true,
  },
};

describe('ScoreReport', () => {
  it('renders current standings and a historical chart from authoritative snapshots', () => {
    const history: ScoreSnapshot[] = [
      { turn: 1, scores: { 'player-1': 120, 'player-2': 150 } },
      { turn: 2, scores: { 'player-1': 180, 'player-2': 220 } },
    ];
    render(
      <ScoreReport
        open
        onOpenChange={vi.fn()}
        players={players}
        currentPlayerId="player-1"
        history={history}
        cityCounts={{ 'player-1': 2, 'player-2': 3 }}
      />
    );

    expect(screen.getByRole('heading', { name: 'Scores and history' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Historical score chart' })).toBeInTheDocument();
    expect(screen.getByText('Romans')).toBeInTheDocument();
    expect(screen.getByText('Greeks')).toBeInTheDocument();
    expect(screen.getByText('Known cities')).toBeInTheDocument();
    expect(screen.getByText(/your city count is exact/i)).toBeInTheDocument();
    expect(screen.getByText('2 turns captured')).toBeInTheDocument();
  });

  it('shows an explicit sparse-history state instead of implying missing data is complete', () => {
    render(
      <ScoreReport
        open
        onOpenChange={vi.fn()}
        players={players}
        currentPlayerId="player-1"
        history={[{ turn: 4, scores: { 'player-1': 180, 'player-2': 220 } }]}
        cityCounts={{}}
      />
    );

    expect(screen.getByText('Waiting for another turn')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Historical score chart' })).toBeInTheDocument();
  });

  it('leaves an explicit gap when a player score is absent for a turn', () => {
    render(
      <ScoreReport
        open
        onOpenChange={vi.fn()}
        players={players}
        currentPlayerId="player-1"
        history={[
          { turn: 1, scores: { 'player-1': 120 } },
          { turn: 2, scores: { 'player-1': 180, 'player-2': 220 } },
        ]}
        cityCounts={{}}
      />
    );

    const chart = screen.getByRole('img', { name: 'Historical score chart' });
    expect(chart.querySelectorAll('circle')).toHaveLength(3);
    expect(chart.querySelectorAll('polyline')).toHaveLength(1);
  });

  it('notifies the caller when the report closes', () => {
    const onOpenChange = vi.fn();
    render(
      <ScoreReport
        open
        onOpenChange={onOpenChange}
        players={players}
        currentPlayerId="player-1"
        history={[]}
        cityCounts={{}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
