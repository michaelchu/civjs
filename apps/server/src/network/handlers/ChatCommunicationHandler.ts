/* eslint-disable @typescript-eslint/no-unused-vars */
import { Server, Socket } from 'socket.io';
import { logger } from '../../utils/logger';
import { PacketHandler } from '../PacketHandler';
import { BaseSocketHandler } from './BaseSocketHandler';
import { PacketType, ChatMsgSchema } from '../../types/packet';

/**
 * Handles chat and communication packets
 */
export class ChatCommunicationHandler extends BaseSocketHandler {
  protected handledPacketTypes = [
    PacketType.CHAT_MSG,
    PacketType.CHAT_MSG_REQ,
    PacketType.CONNECT_MSG,
    PacketType.SERVER_MESSAGE,
  ];

  protected handlerName = 'ChatCommunicationHandler';

  constructor(private activeConnections: Map<string, any>) {
    super();
  }

  register(handler: PacketHandler, io: Server, socket: Socket): void {
    handler.register(
      PacketType.CHAT_MSG_REQ,
      async (socket, data) => {
        await this.handleChatMessage(handler, socket, data, io);
      },
      ChatMsgSchema
    );

    logger.debug(`${this.handlerName} registered handlers for socket ${socket.id}`);
  }

  private async handleChatMessage(
    handler: PacketHandler,
    socket: Socket,
    data: any,
    io: Server
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection)) {
      return;
    }

    const chatPacket = {
      sender: connection.username || 'Unknown',
      message: data.message,
      channel: data.channel,
      timestamp: Date.now(),
    };

    if (data.channel === 'all' && connection.gameId) {
      io.to(`game:${connection.gameId}`).emit('packet', {
        type: PacketType.CHAT_MSG,
        data: chatPacket,
      });
    } else if (data.channel === 'private' && data.recipient) {
      const recipientSocket = this.findSocketByUsername(data.recipient);
      if (recipientSocket) {
        handler.send(recipientSocket, PacketType.CHAT_MSG, chatPacket);
        handler.send(socket, PacketType.CHAT_MSG, chatPacket); // Echo to sender
      }
    } else {
      io.emit('packet', {
        type: PacketType.CHAT_MSG,
        data: chatPacket,
      });
    }
  }

  private findSocketByUsername(username: string): Socket | null {
    for (const [socketId, connection] of this.activeConnections) {
      if (connection.username === username) {
        return (global as any).io.sockets.sockets.get(socketId);
      }
    }
    return null;
  }
}
