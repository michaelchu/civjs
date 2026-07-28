import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NationsPanel } from '../NationsPanel';

const { mockGameClient, mockState } = vi.hoisted(() => ({
  mockGameClient: {
    requestDiplomacy: vi.fn(),
    proposeTreaty: vi.fn(),
    respondToTreaty: vi.fn(),
    cancelTreaty: vi.fn(),
    declareWar: vi.fn(),
  },
  mockState: {
    currentPlayerId: 'player-1',
    players: {
      'player-1': { gold: 50 },
    },
    research: {
      researchedTechs: new Set(['alphabet']),
    },
    technologies: {
      alphabet: {
        id: 'alphabet',
        name: 'Alphabet',
        cost: 20,
        requirements: [],
        discovered: true,
      },
      writing: {
        id: 'writing',
        name: 'Writing',
        cost: 40,
        requirements: ['alphabet'],
        discovered: false,
      },
    },
    cities: {
      rome: { id: 'rome', name: 'Rome', playerId: 'player-1' },
      athens: { id: 'athens', name: 'Athens', playerId: 'player-2' },
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
            embassy: false,
            sharedVision: false,
          },
        },
      ],
    },
  },
}));

vi.mock('../../../services/GameClient', () => ({ gameClient: mockGameClient }));
vi.mock('../../../store/gameStore', () => ({
  useGameStore: vi.fn(selector => selector(mockState)),
}));

describe('NationsPanel treaty builder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.diplomacy.nations[0] = {
      id: 'player-2',
      civilization: 'Greek',
      leaderName: 'Pericles',
      isAlive: true,
      isAI: false,
      known: true,
      relation: {
        state: 'peace',
        sinceTurn: 3,
        embassy: false,
        sharedVision: false,
      },
    };
  });

  it('builds and submits a multi-item, two-sided treaty', () => {
    render(<NationsPanel />);

    fireEvent.change(screen.getByLabelText('Treaty clause'), { target: { value: 'technology' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add clause' }));

    fireEvent.change(screen.getByLabelText('Treaty clause'), { target: { value: 'gold' } });
    fireEvent.change(screen.getByLabelText('Clause giver'), { target: { value: 'player-2' } });
    fireEvent.change(screen.getByLabelText('Gold amount'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add clause' }));

    expect(screen.getByText('You give:')).toBeInTheDocument();
    expect(screen.getByText('They give:')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Propose treaty' }));

    expect(mockGameClient.proposeTreaty).toHaveBeenCalledWith('player-2', [
      { type: 'technology', techId: 'alphabet', giverId: 'player-1' },
      { type: 'gold', amount: 25, giverId: 'player-2' },
    ]);
  });

  it('validates offered gold against the current treasury', () => {
    render(<NationsPanel />);

    fireEvent.change(screen.getByLabelText('Treaty clause'), { target: { value: 'gold' } });
    fireEvent.change(screen.getByLabelText('Gold amount'), { target: { value: '51' } });

    expect(screen.getByText('You have only 50 gold.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add clause' })).toBeDisabled();
  });

  it('shows proposal item details and response actions', () => {
    const relationWithProposal = {
      ...mockState.diplomacy.nations[0].relation,
      proposal: {
        id: 'proposal-1',
        proposerId: 'player-2',
        recipientId: 'player-1',
        status: 'pending',
        createdAt: '2026-07-28T12:00:00.000Z',
        clauses: [
          { type: 'city', cityId: 'athens', giverId: 'player-2' },
          { type: 'gold', amount: 10, giverId: 'player-1' },
        ],
      },
    };
    mockState.diplomacy.nations[0] = {
      ...mockState.diplomacy.nations[0],
      relation: relationWithProposal,
    };

    render(<NationsPanel />);

    const proposal = screen.getByText('Incoming proposal').parentElement!;
    expect(within(proposal).getByText('Athens')).toBeInTheDocument();
    expect(within(proposal).getByText('10 gold')).toBeInTheDocument();
    fireEvent.click(within(proposal).getByRole('button', { name: 'Accept' }));
    expect(mockGameClient.respondToTreaty).toHaveBeenCalledWith('player-2', 'proposal-1', true);
  });

  it('does not disclose or allow actions against an unknown nation', () => {
    mockState.diplomacy.nations[0] = {
      ...mockState.diplomacy.nations[0],
      civilization: 'Secret civilization',
      leaderName: 'Secret leader',
      known: false,
      relation: {
        ...mockState.diplomacy.nations[0].relation,
        state: 'no_contact',
      },
    };

    render(<NationsPanel />);

    expect(screen.getByText('Unknown nation')).toBeInTheDocument();
    expect(screen.queryByText('Secret civilization')).not.toBeInTheDocument();
    expect(screen.queryByText('Secret leader')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Propose treaty' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Declare war' })).not.toBeInTheDocument();
  });
});
