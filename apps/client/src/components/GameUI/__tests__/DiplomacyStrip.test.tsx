import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../../store/gameStore';
import { DiplomacyStrip } from '../DiplomacyStrip';

const { mockGameClient } = vi.hoisted(() => ({
  mockGameClient: {
    requestDiplomacy: vi.fn(),
  },
}));

vi.mock('../../../services/GameClient', () => ({ gameClient: mockGameClient }));

describe('DiplomacyStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGameStore.setState({
      activeTab: 'map',
      currentPlayerId: 'player-1',
      players: {
        'player-2': {
          id: 'player-2',
          name: 'Pericles',
          nation: 'greek',
          color: '#22c55e',
          gold: 0,
          science: 0,
          history: 0,
          government: 'despotism',
          isHuman: false,
          isActive: true,
        },
      },
      diplomacy: {
        playerId: 'player-1',
        nations: [
          {
            id: 'player-2',
            civilization: 'Greek',
            leaderName: 'Pericles',
            isAlive: true,
            isAI: false,
            known: true,
            relation: {
              state: 'peace',
              sinceTurn: 3,
              embassy: true,
              sharedVision: false,
              proposal: {
                id: 'proposal-1',
                proposerId: 'player-2',
                recipientId: 'player-1',
                status: 'pending',
                createdAt: '2026-07-30T12:00:00.000Z',
                clauses: [{ type: 'peace' }],
              },
            },
          },
          {
            id: 'player-3',
            civilization: 'Unknown',
            leaderName: 'Hidden Leader',
            isAlive: true,
            isAI: true,
            known: false,
            relation: {
              state: 'no_contact',
              sinceTurn: 0,
              embassy: false,
              sharedVision: false,
            },
          },
        ],
      },
    });
  });

  it('shows known leaders and hides unknown identity details', () => {
    render(<DiplomacyStrip />);
    const leaderButton = screen.getByRole('button', { name: /open diplomacy card for pericles/i });
    expect(leaderButton).not.toHaveTextContent('Pericles');
    expect(leaderButton).not.toHaveTextContent('Greek');
    expect(screen.getByText('Pericles')).toBeInTheDocument();
    expect(screen.getByText('Greek · Human')).toBeInTheDocument();
    expect(screen.getByText('Peace')).toBeInTheDocument();
    expect(screen.getByText('Unknown nation')).toBeInTheDocument();
    expect(screen.queryByText('Hidden Leader')).not.toBeInTheDocument();
    const insignia = leaderButton.querySelector('span[style]');
    expect(insignia).toHaveStyle({ backgroundColor: '#22c55e' });
  });

  it('shows pending treaty status in the hover details', () => {
    render(<DiplomacyStrip />);
    expect(screen.getByText('Proposal pending')).toBeInTheDocument();
  });

  it('opens the full diplomacy report and supports collapse', () => {
    render(<DiplomacyStrip />);
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    fireEvent.click(screen.getByRole('button', { name: /open diplomacy card for pericles/i }));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'open-report', detail: { report: 'diplomacy' } })
    );
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'focus-nation-card' })
    );
  });

  it('keeps each nation as an avatar launcher with hover details', () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    render(<DiplomacyStrip />);

    expect(
      screen.getByRole('button', { name: 'Open diplomacy card for Pericles' })
    ).toBeInTheDocument();
    expect(screen.getByText('Peace')).toBeInTheDocument();
    expect(screen.queryByText('Hidden Leader')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unknown nation' }));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'open-report', detail: { report: 'diplomacy' } })
    );
  });

  it('keeps diplomacy accessible through the avatar rail', () => {
    render(<DiplomacyStrip />);
    expect(
      screen.getByRole('button', { name: 'Open diplomacy card for Pericles' })
    ).toBeInTheDocument();
  });
});
