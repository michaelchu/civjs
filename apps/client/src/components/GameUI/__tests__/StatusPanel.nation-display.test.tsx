import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { StatusPanel } from '../StatusPanel';

type MockStatusStore = {
  turn: number;
  year: number;
  phase: string;
  clientState: string;
  currentPlayerId: string;
  cities: Record<
    string,
    { id?: string; playerId: string; size: number; actualPopulation?: number; trade?: number }
  >;
  setActiveTab: ReturnType<typeof vi.fn>;
  players: Record<string, Record<string, unknown>>;
  urgentFocusQueue?: string[];
  turnProcessingState?: string;
};

// Mock the game store
const mockPlayer = {
  id: 'player-1',
  name: 'TestPlayer',
  nation: 'american',
  color: '#0066cc',
  gold: 50,
  goldPerTurn: 3,
  science: 10,
  sciencePerTurn: 2,
  history: 19,
  culture: 27,
  government: 'republic',
};

const { mockUseGameStore } = vi.hoisted(() => ({
  mockUseGameStore: {
    turn: 5,
    year: -3800,
    phase: 'movement',
    clientState: 'running',
    currentPlayerId: 'player-1',
    cities: {} as Record<string, { playerId: string; size: number }>,
    setActiveTab: vi.fn(),
    urgentFocusQueue: [],
    turnProcessingState: 'idle',
    players: {
      'player-1': {
        id: 'player-1',
        name: 'TestPlayer',
        nation: 'american',
        color: '#0066cc',
        gold: 50,
        goldPerTurn: 3,
        science: 10,
        sciencePerTurn: 2,
        history: 19,
        culture: 27,
        government: 'republic',
      },
    },
  } as unknown as MockStatusStore,
}));

vi.mock('../../../store/gameStore', () => ({
  useGameStore: vi.fn(selector => selector(mockUseGameStore)),
}));

describe('StatusPanel - Resource Bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseGameStore.cities = {};
    mockUseGameStore.urgentFocusQueue = [];
    mockUseGameStore.turnProcessingState = 'idle';
    mockUseGameStore.players['player-1'] = mockPlayer;
  });

  it('shows signed gold and science changes per turn', () => {
    mockUseGameStore.players['player-1'] = {
      ...mockPlayer,
      gold: 42,
      goldPerTurn: -1,
      science: 18,
      sciencePerTurn: 2,
    };

    const { getByLabelText } = render(<StatusPanel />);

    expect(getByLabelText('Gold per turn')).toHaveTextContent('(-1)');
    expect(getByLabelText('Science per turn')).toHaveTextContent('(+2)');
  });

  it('shows economy, empire, calendar and connection status in the resource bar', () => {
    mockUseGameStore.players['player-1'] = {
      ...mockPlayer,
      taxRate: 60,
      luxuryRate: 10,
      scienceRate: 30,
      score: 480,
    };
    mockUseGameStore.cities = {
      cityOne: { id: 'cityOne', playerId: 'player-1', size: 4, trade: 3 },
      cityTwo: { id: 'cityTwo', playerId: 'player-1', size: 2, trade: 2 },
    };

    const onOpenDemographics = vi.fn();
    const { getByText, getByRole, getByTitle } = render(
      <StatusPanel onOpenDemographics={onOpenDemographics} />
    );

    expect(getByText('60/10/30%')).toBeInTheDocument();
    expect(getByText('6')).toBeInTheDocument();
    expect(getByTitle('Population: 6 · 2 cities')).toBeInTheDocument();
    expect(getByTitle('Trade: 5')).toBeInTheDocument();
    expect(getByTitle('Culture: 27')).toBeInTheDocument();
    expect(getByText('480')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Open demographics report' })).toHaveTextContent('3800 BC');

    fireEvent.click(getByRole('button', { name: 'Open economy settings' }));
    expect(mockUseGameStore.setActiveTab).toHaveBeenCalledWith('options');

    fireEvent.click(getByRole('button', { name: 'Open demographics report' }));
    expect(onOpenDemographics).toHaveBeenCalledTimes(1);
    expect(mockUseGameStore.setActiveTab).not.toHaveBeenCalledWith('nations');
  });

  it('keeps connection and phase status out of the resource bar', () => {
    mockUseGameStore.urgentFocusQueue = ['unit-1', 'unit-2'];
    render(<StatusPanel />);

    expect(screen.queryByText('Online')).not.toBeInTheDocument();
    expect(screen.queryByText('2 pending')).not.toBeInTheDocument();
    expect(
      screen.queryByTitle('running · movement phase · 2 pending actions')
    ).not.toBeInTheDocument();
  });

  it('opens the demographics report when no direct callback is provided', () => {
    const openReport = vi.fn();
    const handleOpenReport = (event: Event) => {
      openReport((event as CustomEvent<{ report?: string }>).detail?.report);
    };
    document.addEventListener('open-report', handleOpenReport);

    try {
      render(<StatusPanel />);
      fireEvent.click(screen.getByRole('button', { name: 'Open demographics report' }));
      expect(openReport).toHaveBeenCalledWith('demographics');
    } finally {
      document.removeEventListener('open-report', handleOpenReport);
    }
  });

  it('uses authoritative city population when available', () => {
    mockUseGameStore.cities = {
      cityOne: { id: 'cityOne', playerId: 'player-1', size: 4, actualPopulation: 7, trade: 3 },
      cityTwo: { id: 'cityTwo', playerId: 'player-1', size: 2, actualPopulation: 5, trade: 2 },
    };
    render(<StatusPanel />);

    expect(screen.getByText('12')).toBeInTheDocument();
  });
});
