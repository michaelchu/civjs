import { Socket } from 'socket.io';
import { z } from 'zod';
import logger from '../utils/logger';
import { Packet, PacketType } from '../types/packet';

export type PacketHandlerFunction = (
  socket: Socket,
  data: any,
  packet: Packet
) => void | Promise<void>;

export class PacketHandler {
  private handlers: Map<PacketType, PacketHandlerFunction> = new Map();
  private validators: Map<PacketType, z.ZodSchema> = new Map();
  private sequenceNumbers: Map<string, number> = new Map();

  constructor() {
    logger.info('PacketHandler initialized');
  }

  /**
   * Register a packet handler with optional validation schema
   */
  register(type: PacketType, handler: PacketHandlerFunction, validator?: z.ZodSchema): void {
    this.handlers.set(type, handler);
    if (validator) {
      this.validators.set(type, validator);
    }
    logger.debug(`Registered handler for packet type: ${PacketType[type]}`);
  }

  /**
   * Process incoming packet
   */
  async process(socket: Socket, packet: Packet): Promise<void> {
    try {
      // Validate packet structure
      if (!packet.type || packet.data === undefined) {
        throw new Error('Invalid packet structure');
      }

      // Check sequence number if provided
      if (packet.seq !== undefined) {
        const lastSeq = this.sequenceNumbers.get(socket.id) || -1;
        if (packet.seq <= lastSeq) {
          logger.warn(`Out of order packet from ${socket.id}: ${packet.seq} <= ${lastSeq}`);
          return;
        }
        this.sequenceNumbers.set(socket.id, packet.seq);
      }

      // Get handler
      const handler = this.handlers.get(packet.type);
      if (!handler) {
        logger.warn(`No handler for packet type: ${PacketType[packet.type] || packet.type}`);
        return;
      }

      // Validate data if validator exists
      const validator = this.validators.get(packet.type);
      if (validator) {
        try {
          packet.data = validator.parse(packet.data);
        } catch (error) {
          if (error instanceof z.ZodError) {
            logger.error(`Validation failed for packet ${PacketType[packet.type]}:`, error.issues);
            this.sendError(socket, `Invalid data for ${PacketType[packet.type]}`);
            return;
          }
          throw error;
        }
      }

      // Execute handler
      await handler(socket, packet.data, packet);

      logger.debug(`Processed packet ${PacketType[packet.type]} from ${socket.id}`);
    } catch (error) {
      logger.error(`Error processing packet from ${socket.id}:`, error);
      this.sendError(socket, 'Internal server error');
    }
  }

  /**
   * Send packet to client
   */
  send(socket: Socket, type: PacketType, data: any): void {
    const packet: Packet = {
      type,
      data,
      timestamp: Date.now(),
    };

    socket.emit('packet', packet);
    logger.debug(`Sent packet ${PacketType[type]} to ${socket.id}`);
  }

  /**
   * Broadcast packet to multiple clients
   */
  broadcast(sockets: Socket[], type: PacketType, data: any): void {
    const packet: Packet = {
      type,
      data,
      timestamp: Date.now(),
    };

    sockets.forEach(socket => {
      socket.emit('packet', packet);
    });

    logger.debug(`Broadcast packet ${PacketType[type]} to ${sockets.length} clients`);
  }

  /**
   * Send error packet
   */
  private sendError(socket: Socket, message: string): void {
    this.send(socket, PacketType.CONNECT_MSG, {
      type: 'error',
      message,
    });
  }

  /**
   * Clean up sequence tracking for disconnected client
   */
  cleanup(socketId: string): void {
    this.sequenceNumbers.delete(socketId);
  }
}
