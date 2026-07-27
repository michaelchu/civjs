import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gameClient } from '../GameClient';
import { useGameStore } from '../../store/gameStore';
import { ActionType } from '../../types/shared/actions';
import { PacketType, type Packet } from '../../types/packets';

const mockSocket = {
  connected: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

describe('GameClient unit action feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (gameClient as unknown as { socket: typeof mockSocket }).socket = mockSocket;
    useGameStore.getState().updateGameState({ units: {} });
  });

  it('returns the authoritative action result message', async () => {
    mockSocket.emit.mockImplementation(
      (
        event: string,
        request: unknown,
        callback: (response: {
          success: boolean;
          result: { success: boolean; message: string };
        }) => void
      ) => {
        expect(event).toBe('unit_action');
        expect(request).toEqual({
          unitId: 'unit-1',
          actionType: ActionType.FORTIFY,
          targetX: undefined,
          targetY: undefined,
        });
        callback({
          success: true,
          result: { success: true, message: 'Unit fortified' },
        });
      }
    );

    await expect(gameClient.executeUnitAction('unit-1', ActionType.FORTIFY)).resolves.toEqual({
      success: true,
      message: 'Unit fortified',
    });
  });

  it('surfaces the server validation error', async () => {
    mockSocket.emit.mockImplementation(
      (_event: string, _request: unknown, callback: (response: unknown) => void) => {
        callback({ success: false, error: 'Unit cannot perform Fortify' });
      }
    );

    await expect(gameClient.executeUnitAction('unit-1', ActionType.FORTIFY)).rejects.toThrow(
      'Unit cannot perform Fortify'
    );
  });

  it('applies the canonical incremental unit packet shape', () => {
    (gameClient as unknown as { handlePacket: (packet: Packet) => void }).handlePacket({
      type: PacketType.UNIT_INFO,
      data: {
        units: [
          {
            id: 'unit-1',
            owner: 'player-1',
            type: 'warriors',
            x: 4,
            y: 5,
            hp: 90,
            movesleft: 3,
            maxmoves: 3,
            veteran: 1,
            fortified: true,
            activity: { type: 'fortified' },
            orders: [],
            transportedBy: undefined,
            cargoUnits: [],
          },
        ],
      },
    });

    expect(useGameStore.getState().units['unit-1']).toEqual({
      id: 'unit-1',
      playerId: 'player-1',
      unitTypeId: 'warriors',
      x: 4,
      y: 5,
      hp: 90,
      movesLeft: 3,
      maxMoves: 3,
      veteranLevel: 1,
      fortified: true,
      activity: { type: 'fortified' },
      orders: [],
      transportedBy: undefined,
      cargoUnits: [],
    });
  });
});
