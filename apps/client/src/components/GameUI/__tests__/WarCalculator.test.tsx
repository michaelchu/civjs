import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Unit } from '../../../types';
import { WarCalculator } from '../WarCalculator';

const units: Record<string, Unit> = {
  attacker: {
    id: 'attacker', playerId: 'player-1', unitTypeId: 'knight', x: 3, y: 4, hp: 100,
    movesLeft: 1, veteranLevel: 1, attack: 4, defense: 2, firepower: 1,
  },
  defender: {
    id: 'defender', playerId: 'player-2', unitTypeId: 'pikeman', x: 4, y: 4, hp: 80,
    movesLeft: 0, veteranLevel: 0, attack: 1, defense: 3, firepower: 1,
  },
};

describe('WarCalculator', () => {
  it('compares selected visible units and explains the estimate', () => {
    render(<WarCalculator open onOpenChange={vi.fn()} units={units} currentPlayerId="player-1" />);

    expect(screen.getByRole('heading', { name: 'War calculator' })).toBeInTheDocument();
    expect(screen.getByText('Attacker advantage')).toBeInTheDocument();
    expect(screen.getByText('Effective attack:')).toBeInTheDocument();
    expect(screen.getByText('Advisory estimate only')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Defender'), { target: { value: 'attacker' } });
    expect(screen.getAllByText('Attacker advantage').length).toBeGreaterThan(0);
  });

  it('shows a clear empty state when combat fields are absent', () => {
    const incomplete = {
      scout: { ...units.attacker, id: 'scout', attack: undefined, defense: undefined },
    };
    render(<WarCalculator open onOpenChange={vi.fn()} units={incomplete} currentPlayerId="player-1" />);

    expect(screen.getByText(/combat stats are not available/i)).toBeInTheDocument();
  });
});
