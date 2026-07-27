import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  const handlers = new Map<string, Handler>();
  const socket = {
    connected: false,
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
      return socket;
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
    io: { on: vi.fn() },
  };
  return { handlers, socket };
});

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => harness.socket),
}));

import { io } from 'socket.io-client';
import { GameTransport, type GameTransportLifecycle } from '../GameTransport';

describe('GameTransport', () => {
  beforeEach(() => {
    harness.handlers.clear();
    harness.socket.connected = false;
    vi.clearAllMocks();
  });

  it('owns and deduplicates connection establishment', async () => {
    const transport = new GameTransport('http://game.test');
    const configure = vi.fn();
    const lifecycle: GameTransportLifecycle = {
      connected: vi.fn(),
      disconnected: vi.fn(),
      reconnected: vi.fn(),
      connectionError: vi.fn(),
      reconnectError: vi.fn(),
    };

    const first = transport.connect(configure, lifecycle);
    const second = transport.connect(configure, lifecycle);
    harness.socket.connected = true;
    harness.handlers.get('connect')?.();

    await expect(first).resolves.toBe(harness.socket);
    await expect(second).resolves.toBe(harness.socket);
    expect(io).toHaveBeenCalledOnce();
    expect(configure).toHaveBeenCalledOnce();
    expect(lifecycle.connected).toHaveBeenCalledOnce();

    transport.disconnect();
    expect(harness.socket.disconnect).toHaveBeenCalledOnce();
    expect(transport.getSocket()).toBeNull();
  });
});
