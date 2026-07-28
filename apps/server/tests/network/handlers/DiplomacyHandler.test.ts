import { DiplomacyHandler } from '@network/handlers/DiplomacyHandler';
import { PacketHandler } from '@network/PacketHandler';
import { PacketType, PROTOCOL_VERSION } from '@app-types/packet';

describe('DiplomacyHandler', () => {
  const socket = { id: 'socket-1', emit: jest.fn() } as any;
  const roomEmit = jest.fn();
  const io = { to: jest.fn(() => ({ emit: roomEmit })) } as any;
  const gameId = 'game-1';
  const playerId = 'player-1';
  const otherPlayerId = 'player-2';
  let packetHandler: PacketHandler;
  let gameManager: any;
  let connections: Map<string, any>;

  beforeEach(() => {
    jest.clearAllMocks();
    packetHandler = new PacketHandler();
    connections = new Map([[socket.id, { userId: 'user-1', gameId, role: 'player' }]]);
    gameManager = {
      getGameInstance: jest.fn().mockReturnValue({
        players: new Map([
          [playerId, { id: playerId, userId: 'user-1' }],
          [otherPlayerId, { id: otherPlayerId, userId: 'user-2' }],
        ]),
      }),
      getDiplomacySnapshot: jest.fn().mockImplementation((_gameId: string, id: string) => ({
        playerId: id,
        nations: [],
      })),
      proposeTreaty: jest.fn(),
      respondToTreaty: jest.fn(),
      cancelTreaty: jest.fn(),
      declareWar: jest.fn(),
      cancelDiplomaticPact: jest.fn(),
      cancelSharedVision: jest.fn(),
    };
    new DiplomacyHandler(connections, gameManager).register(packetHandler, io, socket);
  });

  const process = (type: PacketType, data: Record<string, unknown>) =>
    packetHandler.process(socket, {
      type,
      version: PROTOCOL_VERSION,
      data,
      timestamp: Date.now(),
    });

  it('routes two-sided treaty clauses through the authenticated player', async () => {
    const clauses = [
      { type: 'technology', techId: 'alphabet', giverId: playerId },
      { type: 'gold', amount: 50, giverId: otherPlayerId },
    ];
    await process(PacketType.DIPLOMACY_TREATY_PROPOSE, {
      recipientId: otherPlayerId,
      requestId: 'request-1',
      clauses,
    });
    expect(gameManager.proposeTreaty).toHaveBeenCalledWith(
      gameId,
      playerId,
      otherPlayerId,
      clauses,
      'request-1'
    );
    expect(roomEmit).toHaveBeenCalledWith(
      'packet',
      expect.objectContaining({ type: PacketType.DIPLOMACY_UPDATE })
    );
  });

  it('routes accepted-pact and directional-vision cancellation separately', async () => {
    await process(PacketType.DIPLOMACY_PACT_CANCEL, { otherPlayerId });
    await process(PacketType.DIPLOMACY_VISION_CANCEL, { otherPlayerId });
    expect(gameManager.cancelDiplomaticPact).toHaveBeenCalledWith(gameId, playerId, otherPlayerId);
    expect(gameManager.cancelSharedVision).toHaveBeenCalledWith(gameId, playerId, otherPlayerId);
  });

  it('rejects spectator mutations', async () => {
    connections.set(socket.id, { userId: 'user-1', gameId, role: 'spectator' });
    await process(PacketType.DIPLOMACY_DECLARE_WAR, { otherPlayerId });
    expect(gameManager.declareWar).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'packet',
      expect.objectContaining({
        type: PacketType.DIPLOMACY_UPDATE,
        data: expect.objectContaining({ success: false }),
      })
    );
  });
});
