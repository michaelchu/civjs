import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../../store/gameStore';
import { DiplomacyStrip } from '../DiplomacyStrip';

const { mockGameClient } = vi.hoisted(() => ({
  mockGameClient: {
    respondToTreaty: vi.fn(),
    cancelTreaty: vi.fn(),
  },
}));

vi.mock('../../../services/GameClient', () => ({ gameClient: mockGameClient }));

describe('DiplomacyStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGameStore.setState({
      activeTab: 'map',
      currentPlayerId: 'player-1',
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
    expect(leaderButton).toHaveTextContent('Pericles');
    expect(leaderButton).toHaveTextContent('Greek');
    expect(screen.getByText('Peace')).toBeInTheDocument();
    expect(screen.getByText('Unknown nation')).toBeInTheDocument();
    expect(screen.queryByText('Hidden Leader')).not.toBeInTheDocument();
  });

  it('keeps incoming treaty actions available in the strip', () => {
    render(<DiplomacyStrip />);
    fireEvent.click(screen.getByRole('button', { name: /accept proposal from pericles/i }));
    expect(mockGameClient.respondToTreaty).toHaveBeenCalledWith('player-2', 'proposal-1', true);
  });

  it('opens the full diplomacy report and supports collapse', () => {
    render(<DiplomacyStrip />);
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    fireEvent.click(screen.getByRole('button', { name: /open diplomacy card for pericles/i }));
    expect(useGameStore.getState().activeTab).toBe('nations');
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'focus-nation-card' })
    );
    fireEvent.click(screen.getByRole('button', { name: /collapse diplomacy/i }));
    expect(screen.getByRole('button', { name: /expand diplomacy/i })).toBeInTheDocument();
  });

  it('opens intelligence for a known leader when the shortcut is available', () => {
    const onOpenIntelligence = vi.fn();
    render(<DiplomacyStrip onOpenIntelligence={onOpenIntelligence} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Open intelligence report for Pericles' })
    );

    expect(onOpenIntelligence).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', { name: 'Open intelligence report for Hidden Leader' })
    ).not.toBeInTheDocument();
  });

  it('keeps diplomacy accessible through a compact mobile entry point', () => {
    render(<DiplomacyStrip />);

    fireEvent.click(screen.getByRole('button', { name: 'Open diplomacy' }));

    expect(screen.getByText('Known world leaders')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /collapse diplomacy/i })).toBeInTheDocument();
  });
});
