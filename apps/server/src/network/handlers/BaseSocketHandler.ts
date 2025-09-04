import { Server, Socket } from 'socket.io';
import { PacketType } from '../../types/packet';
import { PacketHandler } from '../PacketHandler';

/**
 * Base interface for all socket handlers
 */
export interface SocketHandler {
  /**
   * Register packet handlers with the packet handler system
   */
  register(handler: PacketHandler, io: Server, socket: Socket): void;

  /**
   * Clean up any resources when socket disconnects (optional)
   */
  cleanup?(socketId: string): void;

  /**
   * Get the list of packet types this handler manages
   */
  getHandledPacketTypes(): PacketType[];

  /**
   * Get handler name for logging and debugging
   */
  getName(): string;
}

/**
 * Abstract base class for socket handlers providing common functionality
 */
export abstract class BaseSocketHandler implements SocketHandler {
  protected abstract handledPacketTypes: PacketType[];
  protected abstract handlerName: string;

  abstract register(handler: PacketHandler, io: Server, socket: Socket): void;

  cleanup?(_socketId: string): void {
    // Default implementation - can be overridden by subclasses
  }

  getHandledPacketTypes(): PacketType[] {
    return this.handledPacketTypes;
  }

  getName(): string {
    return this.handlerName;
  }

  /**
   * Helper method to get active connection from socket
   */
  protected getConnection(socket: Socket, activeConnections: Map<string, any>): any {
    return activeConnections.get(socket.id);
  }

  /**
   * Helper method to check if user is authenticated
   */
  protected isAuthenticated(connection: any): boolean {
    return !!connection?.userId;
  }

  /**
   * Helper method to check if user is in a game
   */
  protected isInGame(connection: any): boolean {
    return !!connection?.gameId;
  }
}
