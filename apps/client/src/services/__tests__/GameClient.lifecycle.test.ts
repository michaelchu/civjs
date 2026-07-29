import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gameClient } from '../GameClient';
import { useGameStore } from '../../store/gameStore';
import { PacketType, type Packet } from '../../types/packets';

describe('GameClient lifecycle events', () => {
  const listeners = new Map<string, (data: unknown) => void>();
  const socket = {
    connected: true,
    on: vi.fn((event: string, listener: (data: unknown) => void) => {
      listeners.set(event, listener);
    }),
    off: vi.fn(),
    emit: vi.fn(),
  };

  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
    (gameClient as unknown as { socket: typeof socket }).socket = socket;
    (
      gameClient as unknown as {
        setupGameHandlers: () => void;
      }
    ).setupGameHandlers();
    useGameStore.setState({ clientState: 'connecting' });
    useGameStore.getState().updateGameState({ phase: 'production' });
  });

  it('refreshes research when the server marks the game active', () => {
    listeners.get('game-started')?.({ gameId: 'game-1', currentTurn: 1 });

    expect(useGameStore.getState().clientState).toBe('running');
    expect(useGameStore.getState().phase).toBe('movement');
    expect(socket.emit).toHaveBeenCalledWith(
      'packet',
      expect.objectContaining<Partial<Packet>>({
        type: PacketType.RESEARCH_LIST,
        data: {},
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'packet',
      expect.objectContaining<Partial<Packet>>({
        type: PacketType.RESEARCH_PROGRESS,
        data: {},
      })
    );
  });
});
