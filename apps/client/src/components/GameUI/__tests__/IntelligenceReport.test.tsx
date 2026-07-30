import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { City, DiplomacyNation, Player, Tile, Unit } from '../../../types';
import { IntelligenceReport } from '../IntelligenceReport';

const players: Record<string, Player> = {
  'player-1': {
    id: 'player-1', name: 'Player One', nation: 'Romans', color: '#67e8f9', gold: 20,
    science: 10, history: 0, government: 'despotism', isHuman: true, isActive: true,
  },
  'player-2': {
    id: 'player-2', name: 'Player Two', nation: 'Greeks', color: '#c4b5fd', gold: 8,
    science: 5, history: 0, government: 'despotism', isHuman: false, isActive: true,
  },
};

const diplomacy = {
  nations: [
    {
      id: 'player-2', civilization: 'Greeks', leaderName: 'Pericles', isAlive: true, isAI: true, known: true,
      relation: { state: 'peace', sinceTurn: 3, embassy: true, sharedVision: false },
    },
  ],
} as unknown as { nations: DiplomacyNation[] };

const cities = {
  rome: { id: 'rome', name: 'Rome', playerId: 'player-1', x: 1, y: 1, size: 4 },
  athens: { id: 'athens', name: 'Athens', playerId: 'player-2', x: 2, y: 2, size: 2 },
} as unknown as Record<string, City>;

const units = {
  warrior: { id: 'warrior', playerId: 'player-1', unitTypeId: 'warrior', x: 1, y: 1 },
  scout: { id: 'scout', playerId: 'player-2', unitTypeId: 'scout', x: 2, y: 2 },
} as unknown as Record<string, Unit>;

const tiles = {
  '1,1': { x: 1, y: 1, owner: 'player-1', known: true, visible: true },
  '2,2': { x: 2, y: 2, owner: 'player-2', known: true, visible: true },
} as unknown as Record<string, Tile>;

describe('IntelligenceReport', () => {
  it('shows known relations and map-observed foreign metrics', () => {
    render(
      <IntelligenceReport
        open
        onOpenChange={vi.fn()}
        players={players}
        diplomacy={diplomacy}
        cities={cities}
        units={units}
        tiles={tiles}
        currentPlayerId="player-1"
        researchedTechCount={4}
      />
    );

    expect(screen.getByRole('heading', { name: 'Intelligence report' })).toBeInTheDocument();
    expect(screen.getByText('Pericles')).toBeInTheDocument();
    expect(screen.getByText('Peace')).toBeInTheDocument();
    expect(screen.getByText('Observation-based intelligence')).toBeInTheDocument();
    expect(screen.getByText('Unreported')).toBeInTheDocument();
  });

  it('does not expose map entities for an unknown nation', () => {
    const unknownDiplomacy = {
      nations: [{ ...diplomacy.nations[0], known: false }],
    } as unknown as { nations: DiplomacyNation[] };

    render(
      <IntelligenceReport
        open
        onOpenChange={vi.fn()}
        players={players}
        diplomacy={unknownDiplomacy}
        cities={cities}
        units={units}
        tiles={tiles}
        currentPlayerId="player-1"
        researchedTechCount={4}
      />
    );

    expect(screen.getByText('Unknown nation')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('Pericles')).not.toBeInTheDocument();
  });

  it('focuses the first known entity for a nation', () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');

    render(
      <IntelligenceReport
        open
        onOpenChange={vi.fn()}
        players={players}
        diplomacy={diplomacy}
        cities={cities}
        units={units}
        tiles={tiles}
        currentPlayerId="player-1"
        researchedTechCount={4}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /focus known unit for player two/i }));
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'center-map-on-tile' }));
    dispatchSpy.mockRestore();
  });
});
