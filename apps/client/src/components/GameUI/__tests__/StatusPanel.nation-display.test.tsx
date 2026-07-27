import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { StatusPanel } from '../StatusPanel';

// Mock the game store
const mockPlayer = {
  id: 'player-1',
  name: 'TestPlayer',
  nation: 'american',
  color: '#0066cc',
  gold: 50,
  science: 10,
  government: 'republic',
};

const { mockUseGameStore } = vi.hoisted(() => ({
  mockUseGameStore: {
    turn: 5,
    currentPlayerId: 'player-1',
    players: {
      'player-1': {
        id: 'player-1',
        name: 'TestPlayer',
        nation: 'american',
        color: '#0066cc',
        gold: 50,
        science: 10,
        government: 'republic',
      },
    },
  },
}));

vi.mock('../../../store/gameStore', () => ({
  useGameStore: vi.fn(selector => selector(mockUseGameStore)),
}));

describe('StatusPanel - Nation Display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
