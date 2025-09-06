import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { NationSelectionDialog } from '../NationSelectionDialog';
import '@testing-library/jest-dom';

// Mock the nations hook
const mockNations = [
  { id: 'american', name: 'American' },
  { id: 'chinese', name: 'Chinese' },
  { id: 'roman', name: 'Roman' },
];

jest.mock('../../hooks/useNations', () => ({
  useNationSelection: jest.fn(() => ({
    nations: mockNations,
    loading: false,
    error: null,
  })),
}));

// Mock UI components
jest.mock('../ui/combobox', () => ({
  Combobox: ({
    options,
    value,
    onValueChange,
    placeholder,
    disabled,
  }: {
    options: Array<{ value: string; label: string }>;
    value: string;
    onValueChange: (value: string) => void;
    placeholder: string;
    disabled: boolean;
  }) => (
    <select
      data-testid="nation-select"
      value={value}
      onChange={e => onValueChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">{placeholder}</option>
      {options.map((option: { value: string; label: string }) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

jest.mock('../ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
    type,
    className,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    disabled: boolean;
    variant: string;
    type?: 'button' | 'reset' | 'submit';
    className: string;
  }) => (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={className}
      data-variant={variant}
    >
      {children}
    </button>
  ),
}));

describe('NationSelectionDialog', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    onConfirm: jest.fn(),
    playerName: 'TestPlayer',
    gameName: 'Test Game',
    loading: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render with random selected by default', () => {
    render(<NationSelectionDialog {...defaultProps} />);

    expect(screen.getByText('Choose Your Nation')).toBeInTheDocument();
    expect(screen.getByText('Joining "Test Game" as TestPlayer')).toBeInTheDocument();

    const select = screen.getByTestId('nation-select');
    expect(select).toHaveValue('random');
  });

  it('should include random option and all available nations', () => {
    render(<NationSelectionDialog {...defaultProps} />);

    const select = screen.getByTestId('nation-select');
    const options = select.querySelectorAll('option');

    // Should have placeholder + random + 3 nations = 5 options
    expect(options).toHaveLength(5);
    expect(options[1]).toHaveValue('random');
    expect(options[1]).toHaveTextContent('Random');
    expect(options[2]).toHaveValue('american');
    expect(options[2]).toHaveTextContent('American');
    expect(options[3]).toHaveValue('chinese');
    expect(options[3]).toHaveTextContent('Chinese');
    expect(options[4]).toHaveValue('roman');
    expect(options[4]).toHaveTextContent('Roman');
  });

  it('should call onConfirm with selected nation when Join Game clicked', () => {
    const onConfirm = jest.fn();
    render(<NationSelectionDialog {...defaultProps} onConfirm={onConfirm} />);

    // Select a specific nation
    const select = screen.getByTestId('nation-select');
    fireEvent.change(select, { target: { value: 'chinese' } });

    // Click Join Game
    const joinButton = screen.getByText('Join Game');
    fireEvent.click(joinButton);

    expect(onConfirm).toHaveBeenCalledWith('chinese');
  });

  it('should call onConfirm with random when random is selected', () => {
    const onConfirm = jest.fn();
    render(<NationSelectionDialog {...defaultProps} onConfirm={onConfirm} />);

    // Random is selected by default, just click Join Game
    const joinButton = screen.getByText('Join Game');
    fireEvent.click(joinButton);

    expect(onConfirm).toHaveBeenCalledWith('random');
  });

  it('should call onClose when Cancel is clicked', () => {
    const onClose = jest.fn();
    render(<NationSelectionDialog {...defaultProps} onClose={onClose} />);

    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);

    expect(onClose).toHaveBeenCalled();
  });

  it('should disable buttons and show loading state when loading', () => {
    render(<NationSelectionDialog {...defaultProps} loading={true} />);

    const joinButton = screen.getByText(/Joining.../);
    const cancelButton = screen.getByText('Cancel');

    expect(joinButton).toBeDisabled();
    expect(cancelButton).toBeDisabled();
    expect(screen.getByText('Joining...')).toBeInTheDocument();
  });

  it('should not render when isOpen is false', () => {
    render(<NationSelectionDialog {...defaultProps} isOpen={false} />);

    expect(screen.queryByText('Choose Your Nation')).not.toBeInTheDocument();
  });

  it('should disable Join Game button when no nation selected', () => {
    render(<NationSelectionDialog {...defaultProps} />);

    // Clear selection
    const select = screen.getByTestId('nation-select');
    fireEvent.change(select, { target: { value: '' } });

    const joinButton = screen.getByText('Join Game');
    expect(joinButton).toBeDisabled();
  });

  it('should show error message when nations fail to load', () => {
    const { useNationSelection } = jest.requireMock('../../hooks/useNations');
    useNationSelection.mockReturnValue({
      nations: [],
      loading: false,
      error: 'Failed to load nations',
    });

    render(<NationSelectionDialog {...defaultProps} />);

    expect(
      screen.getByText('Failed to load nations. Using default selection.')
    ).toBeInTheDocument();
  });

  it('should show loading placeholder when nations are loading', () => {
    const { useNationSelection } = jest.requireMock('../../hooks/useNations');
    useNationSelection.mockReturnValue({
      nations: [],
      loading: true,
      error: null,
    });

    render(<NationSelectionDialog {...defaultProps} />);

    expect(screen.getByText('Loading nations...')).toBeInTheDocument();
  });
});
