import { vi } from 'vitest';
import { gameClient } from '../GameClient';
import { PacketType, PROTOCOL_VERSION } from '../../types/packets';

const mockSocket = {
  connected: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

describe('GameClient canonical protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (gameClient as unknown as { socket: typeof mockSocket }).socket = mockSocket;
  });

  it('requests tile visibility through the versioned packet envelope', async () => {
    let packetListener: ((data: unknown) => void) | undefined;
    mockSocket.on.mockImplementation((event: string, callback: (data: unknown) => void) => {
      if (event === 'packet') packetListener = callback;
    });
    mockSocket.emit.mockImplementation((event: string, request: { requestId?: string }) => {
      if (event === 'packet') {
        queueMicrotask(() =>
          packetListener?.({
            type: PacketType.TILE_VISIBILITY_REPLY,
            version: PROTOCOL_VERSION,
            requestId: request.requestId,
            data: {
              success: true,
              x: 4,
              y: 7,
              isVisible: true,
              isExplored: true,
              lastSeen: 12,
            },
          })
        );
      }
    });

    await expect(gameClient.getTileVisibility(4, 7)).resolves.toEqual({
      success: true,
      x: 4,
      y: 7,
      isVisible: true,
      isExplored: true,
      lastSeen: 12,
    });
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'packet',
      expect.objectContaining({
        type: PacketType.TILE_VISIBILITY_REQ,
        version: PROTOCOL_VERSION,
        data: { x: 4, y: 7 },
      })
    );
  });

  it('requests a server snapshot when debug visibility changes', async () => {
    let packetListener: ((data: unknown) => void) | undefined;
    mockSocket.on.mockImplementation((event: string, callback: (data: unknown) => void) => {
      if (event === 'packet') packetListener = callback;
    });
    mockSocket.emit.mockImplementation((event: string, request: { requestId?: string }) => {
      if (event === 'packet') {
        queueMicrotask(() =>
          packetListener?.({
            type: PacketType.DEBUG_VISIBILITY_REPLY,
            version: PROTOCOL_VERSION,
            requestId: request.requestId,
            data: { success: true, enabled: true },
          })
        );
      }
    });

    await expect(gameClient.setDebugVisibility(true)).resolves.toBe(true);
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'packet',
      expect.objectContaining({
        type: PacketType.DEBUG_VISIBILITY_SET,
        version: PROTOCOL_VERSION,
        data: { enabled: true },
      })
    );
  });
});
