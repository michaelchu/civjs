import { fireEvent, render } from '@testing-library/react';
import { vi } from 'vitest';
import { StatusPanel } from '../StatusPanel';

type MockStatusStore = {
  turn: number;
  year: number;
  phase: string;
  clientState: string;
  currentPlayerId: string;
  cities: Record<string, { id?: string; playerId: string; size: number }>;
  setActiveTab: ReturnType<typeof vi.fn>;
  players: Record<string, Record<string, unknown>>;
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
        government: 'republic',
      },
    },
  } as unknown as MockStatusStore,
}));

vi.mock('../../../store/gameStore', () => ({
  useGameStore: vi.fn(selector => selector(mockUseGameStore)),
}));

describe('StatusPanel - Nation Display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseGameStore.cities = {};
    mockUseGameStore.players['player-1'] = mockPlayer;
  });

  it.each([
    { input: 'american', expected: 'American' },
    { input: 'chinese', expected: 'Chinese' },
    { input: 'roman', expected: 'Roman' },
    { input: 'random', expected: 'Random' },
    { input: 'holy_roman_empire', expected: 'Holy Roman Empire' },
    { input: 'austro-hungarian', expected: 'Austro Hungarian' },
    { input: 'ancient greece', expected: 'Ancient Greece' },
    { input: 'UPPERCASE', expected: 'Uppercase' },
    { input: 'mixed_CASE-nation name', expected: 'Mixed Case Nation Name' },
  ])('formats $input as $expected', ({ input, expected }) => {
    mockUseGameStore.players['player-1'] = { ...mockPlayer, nation: input };

    const { getByText } = render(<StatusPanel />);

    expect(getByText(expected)).toBeInTheDocument();
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
      cityOne: { id: 'cityOne', playerId: 'player-1', size: 4 },
      cityTwo: { id: 'cityTwo', playerId: 'player-1', size: 2 },
    };

    const onOpenDemographics = vi.fn();
    const { getByText, getByRole } = render(<StatusPanel onOpenDemographics={onOpenDemographics} />);

    expect(getByText('60/10/30%')).toBeInTheDocument();
    expect(getByText('6')).toBeInTheDocument();
    expect(getByText('480')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Open demographics report' })).toHaveTextContent(
      '3800 BC'
    );
    expect(getByText('Online')).toBeInTheDocument();

    fireEvent.click(getByRole('button', { name: 'Open economy settings' }));
    expect(mockUseGameStore.setActiveTab).toHaveBeenCalledWith('options');

    fireEvent.click(getByRole('button', { name: 'Open demographics report' }));
    expect(onOpenDemographics).toHaveBeenCalledTimes(1);
    expect(mockUseGameStore.setActiveTab).not.toHaveBeenCalledWith('nations');
  });
});
