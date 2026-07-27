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
    mockSocket.on.mockImplementation((event: string, callback: (data: unknown) => void) => {
      if (event === 'packet') {
        queueMicrotask(() =>
          callback({
            type: PacketType.TILE_VISIBILITY_REPLY,
            version: PROTOCOL_VERSION,
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
});
