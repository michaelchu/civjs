/**
 * @module client/services/GameTransport
 * Provides the client-side Game Transport service.
 */
import { io, type Socket } from 'socket.io-client';

export interface GameTransportLifecycle {
  connected: () => void;
  disconnected: (reason: string) => void;
  reconnected: (attemptNumber: number) => void;
  connectionError: (error: Error) => void;
  reconnectError: (error: Error) => void;
}

/**
 * Owns Socket.IO connection mechanics. Packet interpretation and game state
 * mutation deliberately remain outside this boundary.
 */
export class GameTransport {
  private socket: Socket | null = null;
  private connectionPromise: Promise<Socket> | null = null;

  constructor(private readonly serverUrl: string) {}

  connect(configure: (socket: Socket) => void, lifecycle: GameTransportLifecycle): Promise<Socket> {
    if (this.socket?.connected) return Promise.resolve(this.socket);
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = new Promise((resolve, reject) => {
      const socket = io(this.serverUrl, {
        transports: ['websocket'],
        timeout: 20000,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        forceNew: false,
        autoConnect: true,
      });
      this.socket = socket;
      configure(socket);

      socket.on('connect', () => {
        this.connectionPromise = null;
        lifecycle.connected();
        resolve(socket);
      });
      socket.on('disconnect', reason => lifecycle.disconnected(reason));
      socket.on('connect_error', error => {
        this.connectionPromise = null;
        lifecycle.connectionError(error);
        reject(error);
      });
      socket.io.on('reconnect', lifecycle.reconnected);
      socket.io.on('reconnect_error', lifecycle.reconnectError);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    });

    return this.connectionPromise;
  }

  disconnect(): void {
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.socket?.disconnect();
    this.socket = null;
    this.connectionPromise = null;
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && this.socket?.connected) {
      this.socket.emit('ping');
    }
  };
}
