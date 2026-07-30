import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gameClient } from '../../../services/GameClient';
import { useGameStore } from '../../../store/gameStore';
import { ChatBox } from '../ChatBox';

describe('ChatBox', () => {
  beforeEach(() => {
    useGameStore.setState({
      currentPlayerId: 'player-1',
      chatMessages: [],
    });
  });

  it('shows an empty state and closes from the header', () => {
    const onOpenChange = vi.fn();
    render(<ChatBox open onOpenChange={onOpenChange} />);

    expect(screen.getByLabelText('Chat')).toBeInTheDocument();
    expect(screen.getByText('No messages yet. Say hello to the other players.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('sends trimmed messages through the game client', () => {
    const sendChatMessage = vi.spyOn(gameClient, 'sendChatMessage').mockImplementation(() => undefined);
    render(<ChatBox open onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: '  Hello, world!  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send chat message' }));

    expect(sendChatMessage).toHaveBeenCalledWith('Hello, world!');
  });
});
