import { PacketHandler } from '@network/PacketHandler';
import { PacketType } from '@app-types/packet';

describe('PacketHandler ordering and duplicates', () => {
  it('accepts increasing sequences and ignores duplicate or stale requests', async () => {
    const packetHandler = new PacketHandler();
    const socket = { id: 'socket-1', emit: jest.fn() } as any;
    const handled: number[] = [];
    packetHandler.register(PacketType.CHAT_MSG_REQ, async (_socket, data) => {
      handled.push(data.value);
    });

    await packetHandler.process(socket, {
      type: PacketType.CHAT_MSG_REQ,
      seq: 4,
      data: { value: 4 },
    });
    await packetHandler.process(socket, {
      type: PacketType.CHAT_MSG_REQ,
      seq: 4,
      data: { value: 40 },
    });
    await packetHandler.process(socket, {
      type: PacketType.CHAT_MSG_REQ,
      seq: 3,
      data: { value: 3 },
    });
    await packetHandler.process(socket, {
      type: PacketType.CHAT_MSG_REQ,
      seq: 5,
      data: { value: 5 },
    });

    expect(handled).toEqual([4, 5]);
  });

  it('accepts packet type zero and resets sequence state on disconnect cleanup', async () => {
    const packetHandler = new PacketHandler();
    const socket = { id: 'socket-1', emit: jest.fn() } as any;
    const handler = jest.fn();
    packetHandler.register(PacketType.PROCESSING_STARTED, handler);

    await packetHandler.process(socket, {
      type: PacketType.PROCESSING_STARTED,
      seq: 2,
      data: {},
    });
    packetHandler.cleanup(socket.id);
    await packetHandler.process(socket, {
      type: PacketType.PROCESSING_STARTED,
      seq: 1,
      data: {},
    });

    expect(handler).toHaveBeenCalledTimes(2);
  });
});
