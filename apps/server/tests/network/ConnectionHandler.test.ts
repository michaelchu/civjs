import { ConnectionHandler } from '@network/handlers/ConnectionHandler';

describe('ConnectionHandler', () => {
  it('keeps disconnect cleanup best-effort when the database is unavailable', async () => {
    const where = jest.fn().mockRejectedValue(new Error('connect timeout'));
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));
    const database = { update };
    const activeConnections = new Map([
      ['socket-1', { userId: 'user-1', username: 'Caesar', gameId: 'game-1' }],
    ]);
    const socket = {
      id: 'socket-1',
      to: jest.fn(() => ({ emit: jest.fn() })),
    };
    const handler = new ConnectionHandler(activeConnections, database as never);

    await (handler as any).handleDisconnect(socket, {});

    expect(update).toHaveBeenCalled();
    expect(socket.to).toHaveBeenCalledWith('game:game-1');
  });
});
