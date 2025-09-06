import { render, screen } from '@testing-library/react';
import { StatusPanel } from '../StatusPanel';
import '@testing-library/jest-dom';

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

const mockUseGameStore = {
  turn: 5,
  getCurrentPlayer: jest.fn(() => mockPlayer),
};

jest.mock('../../../store/gameStore', () => ({
  useGameStore: jest.fn(() => mockUseGameStore),
}));

describe('StatusPanel - Nation Display', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset console.log mock
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should display formatted nation name for american', () => {
    mockUseGameStore.getCurrentPlayer.mockReturnValue({
      ...mockPlayer,
      nation: 'american',
    });

    render(<StatusPanel />);

    expect(screen.getByText('American')).toBeInTheDocument();
    expect(console.log).toHaveBeenCalledWith(
      'StatusPanel: formatNationName called with:',
      'american'
    );
  });

  it('should display formatted nation name for chinese', () => {
    mockUseGameStore.getCurrentPlayer.mockReturnValue({
      ...mockPlayer,
      nation: 'chinese',
    });

    render(<StatusPanel />);

    expect(screen.getByText('Chinese')).toBeInTheDocument();
    expect(console.log).toHaveBeenCalledWith(
      'StatusPanel: formatNationName called with:',
      'chinese'
    );
  });

  it('should display "Random" for random nation', () => {
    mockUseGameStore.getCurrentPlayer.mockReturnValue({
      ...mockPlayer,
      nation: 'random',
    });

    render(<StatusPanel />);

    expect(screen.getByText('Random')).toBeInTheDocument();
    expect(console.log).toHaveBeenCalledWith(
      'StatusPanel: formatNationName called with:',
      'random'
    );
  });

  it('should handle multi-word nations correctly', () => {
    mockUseGameStore.getCurrentPlayer.mockReturnValue({
      ...mockPlayer,
      nation: 'holy_roman_empire',
    });

    render(<StatusPanel />);

    expect(screen.getByText('Holy Roman Empire')).toBeInTheDocument();
    expect(console.log).toHaveBeenCalledWith(
      'StatusPanel: formatNationName called with:',
      'holy_roman_empire'
    );
  });

  it('should handle nations with dashes', () => {
    mockUseGameStore.getCurrentPlayer.mockReturnValue({
      ...mockPlayer,
      nation: 'austro-hungarian',
    });

    render(<StatusPanel />);

    expect(screen.getByText('Austro Hungarian')).toBeInTheDocument();
    expect(console.log).toHaveBeenCalledWith(
      'StatusPanel: formatNationName called with:',
      'austro-hungarian'
    );
  });

  it('should handle nations with spaces', () => {
    mockUseGameStore.getCurrentPlayer.mockReturnValue({
      ...mockPlayer,
      nation: 'ancient greece',
    });

    render(<StatusPanel />);

    expect(screen.getByText('Ancient Greece')).toBeInTheDocument();
    expect(console.log).toHaveBeenCalledWith(
      'StatusPanel: formatNationName called with:',
      'ancient greece'
    );
  });

  it('should handle single word nations', () => {
    mockUseGameStore.getCurrentPlayer.mockReturnValue({
      ...mockPlayer,
      nation: 'roman',
    });

    render(<StatusPanel />);

    expect(screen.getByText('Roman')).toBeInTheDocument();
    expect(console.log).toHaveBeenCalledWith('StatusPanel: formatNationName called with:', 'roman');
  });

  it('should handle empty nation gracefully', () => {
    mockUseGameStore.getCurrentPlayer.mockReturnValue({
      ...mockPlayer,
      nation: '',
    });

    render(<StatusPanel />);

    expect(screen.getByText('')).toBeInTheDocument();
    expect(console.log).toHaveBeenCalledWith('StatusPanel: formatNationName called with:', '');
  });

  it('should log nation value for debugging', () => {
    const testNation = 'test_nation';
    mockUseGameStore.getCurrentPlayer.mockReturnValue({
      ...mockPlayer,
      nation: testNation,
    });

    render(<StatusPanel />);

    expect(console.log).toHaveBeenCalledWith(
      'StatusPanel: formatNationName called with:',
      testNation
    );
  });

  describe('formatNationName function behavior', () => {
    // Test the formatting function directly by checking rendered output
    const testCases = [
      { input: 'american', expected: 'American' },
      { input: 'chinese', expected: 'Chinese' },
      { input: 'roman', expected: 'Roman' },
      { input: 'random', expected: 'Random' },
      { input: 'holy_roman_empire', expected: 'Holy Roman Empire' },
      { input: 'austro-hungarian', expected: 'Austro Hungarian' },
      { input: 'ancient greece', expected: 'Ancient Greece' },
      { input: 'UPPERCASE', expected: 'Uppercase' },
      { input: 'mixed_CASE-nation name', expected: 'Mixed Case Nation Name' },
    ];

    testCases.forEach(({ input, expected }) => {
      it(`should format "${input}" as "${expected}"`, () => {
        mockUseGameStore.getCurrentPlayer.mockReturnValue({
          ...mockPlayer,
          nation: input,
        });

        render(<StatusPanel />);

        expect(screen.getByText(expected)).toBeInTheDocument();
      });
    });
  });
});
