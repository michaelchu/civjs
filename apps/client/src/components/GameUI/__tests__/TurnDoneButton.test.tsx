import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../../../store/gameStore';
import { TurnDoneButton } from '../TurnDoneButton';

describe('TurnDoneButton', () => {
  beforeEach(() => {
    useGameStore.setState({
      clientState: 'running',
      currentPlayerId: 'player-1',
      phase: 'movement',
      turnProcessingState: 'idle',
      players: {
        'player-1': {
          id: 'player-1', name: 'Leader', nation: 'rome', color: '#22d3ee',
          gold: 0, science: 0, history: 0, government: 'republic',
          isHuman: true, isActive: true,
        },
      },
    });
  });

  it('explains why ending the turn is unavailable', () => {
    useGameStore.setState({ phase: 'research' });
    render(<TurnDoneButton />);

    const button = screen.getByRole('button', { name: 'research Phase' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      'title',
      'Turn completion is unavailable during the research phase'
    );
  });
});
