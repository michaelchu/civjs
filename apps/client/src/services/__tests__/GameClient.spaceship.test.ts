import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gameClient } from '../GameClient';
import { PacketType, type Packet } from '../../types/packets';

type PacketListener = (packet: Packet<Record<string, unknown>>) => void;

describe('GameClient spaceship packets', () => {
  const listeners = new Set<PacketListener>();
  const socket = {
    connected: true,
    on: vi.fn((event: string, listener: PacketListener) => {
      if (event === 'packet') listeners.add(listener);
    }),
    off: vi.fn((_event: string, listener: PacketListener) => listeners.delete(listener)),
    emit: vi.fn(),
  };

  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
    (gameClient as unknown as { socket: typeof socket }).socket = socket;
  });

  it('sends a typed placement request and returns the authoritative state', async () => {
    const spaceshipState = {
      status: 'started',
      structurals: 1,
      components: 0,
      modules: 0,
      placedStructurals: [0],
    };
    socket.emit.mockImplementation((event: string, request: Packet) => {
      if (event !== 'packet' || request.type !== PacketType.SPACESHIP_PLACE) return;
      expect(request.data).toEqual({ placement: { kind: 'structural', index: 0 } });
      queueMicrotask(() => {
        listeners.forEach(listener =>
          listener({
            type: PacketType.SPACESHIP_PLACE_REPLY,
            requestId: request.requestId,
            data: { success: true, spaceshipState },
          })
        );
      });
    });

    await expect(gameClient.placeSpaceshipPart({ kind: 'structural', index: 0 })).resolves.toEqual(
      spaceshipState
    );
  });

  it('surfaces an authoritative launch rejection', async () => {
    socket.emit.mockImplementation((event: string, request: Packet) => {
      if (event !== 'packet' || request.type !== PacketType.SPACESHIP_LAUNCH) return;
      expect(request.data).toEqual({});
      queueMicrotask(() => {
        listeners.forEach(listener =>
          listener({
            type: PacketType.SPACESHIP_LAUNCH_REPLY,
            requestId: request.requestId,
            data: { success: false, message: 'A capital is required to launch' },
          })
        );
      });
    });

    await expect(gameClient.launchSpaceship()).rejects.toThrow('A capital is required to launch');
  });
});
