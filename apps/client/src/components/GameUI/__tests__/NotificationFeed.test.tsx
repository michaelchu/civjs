import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../../../store/gameStore';
import { NotificationFeed } from '../NotificationFeed';

describe('NotificationFeed', () => {
  beforeEach(() => {
    useGameStore.setState({
      notifications: [{ id: 'notice-1', message: 'Diplomatic contact established', tone: 'info' }],
    });
  });

  it('uses a translucent blurred surface so the map remains perceptible', () => {
    render(<NotificationFeed />);

    const notification = screen.getByText('Diplomatic contact established').parentElement;
    expect(notification).toHaveClass('bg-blue-950/80', 'backdrop-blur-md', 'rounded-xl');
    expect(notification).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeInTheDocument();
  });

  it('announces errors assertively', () => {
    useGameStore.setState({
      notifications: [{ id: 'error-1', message: 'Turn rejected', tone: 'error' }],
    });

    render(<NotificationFeed />);

    expect(screen.getByRole('alert')).toHaveTextContent('Turn rejected');
  });
});
