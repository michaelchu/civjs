import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../store/gameStore';

const socketHarness = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  const socketHandlers = new Map<string, Handler[]>();
  const managerHandlers = new Map<string, Handler[]>();

  const addHandler = (handlers: Map<string, Handler[]>, event: string, handler: Handler) => {
    handlers.set(event, [...(handlers.get(event) ?? []), handler]);
  };

  const socket = {
    connected: false,
    on: vi.fn((event: string, handler: Handler) => {
      addHandler(socketHandlers, event, handler);
      if (event === 'connect') {
        queueMicrotask(() => {
          socket.connected = true;
          handler();
        });
      }
      return socket;
    }),
    off: vi.fn(),
    emit: vi.fn(
      (event: string, data: { type?: number }, callback?: (response: unknown) => void) => {
        if (event === 'packet' && data.type === 4) {
          queueMicrotask(() => {
            for (const handler of socketHandlers.get('packet') ?? []) {
              handler({ type: 5, data: { accepted: true } });
            }
          });
        }
        if (event === 'join_game') {
          queueMicrotask(() =>
            callback?.({
              success: true,
              playerId: 'player-1',
              assignedNation: 'roman',
            })
          );
        }
        return socket;
      }
    ),
    disconnect: vi.fn(),
    io: {
      on: vi.fn((event: string, handler: Handler) => {
        addHandler(managerHandlers, event, handler);
      }),
    },
  };

  return { socket, socketHandlers, managerHandlers };
});

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => socketHarness.socket),
}));

import { GameClient } from '../GameClient';

describe('GameClient session lifecycle', () => {
  beforeEach(() => {
    socketHarness.socketHandlers.clear();
    socketHarness.managerHandlers.clear();
    socketHarness.socket.connected = false;
    vi.clearAllMocks();
    useGameStore.setState({
      clientState: 'initial',
      currentGameId: null,
      players: {},
      currentPlayerId: '',
    });
  });

  it('re-authenticates and resyncs the active game after a Manager reconnect', async () => {
    const client = new GameClient();
    await client.connect();
    await client.joinSpecificGame('game-1', 'Ada', 'roman');

    expect(client.getSessionState().phase).toBe('ready');
    expect(
      socketHarness.socket.emit.mock.calls.filter(([event]) => event === 'join_game')
    ).toHaveLength(1);

    for (const handler of socketHarness.socketHandlers.get('disconnect') ?? []) {
      handler('transport close');
    }
    expect(client.getSessionState().phase).toBe('reconnecting');

    for (const handler of socketHarness.managerHandlers.get('reconnect') ?? []) {
      handler(1);
    }

    await vi.waitFor(() => {
      expect(
        socketHarness.socket.emit.mock.calls.filter(([event]) => event === 'join_game')
      ).toHaveLength(2);
    });
    expect(client.getSessionState().phase).toBe('ready');
    expect(useGameStore.getState().clientState).toBe('running');

    client.disconnect();
  });
});
