import { io, Socket } from 'socket.io-client';
import { useGameStore } from '../store/gameStore';
import { PacketType, type SocketPacket } from '../types/packets';

class GameClient {
  private socket: Socket | null = null;
  private serverUrl: string;

  constructor() {
    this.serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = io(this.serverUrl, {
          transports: ['websocket'],
          timeout: 10000,
        });

        this.socket.on('connect', () => {
          console.log('Connected to game server');
          useGameStore.getState().setClientState('connecting');
          resolve();
        });

        this.socket.on('disconnect', () => {
          console.log('Disconnected from game server');
          useGameStore.getState().setClientState('initial');
        });

        this.socket.on('connect_error', (error) => {
          console.error('Connection error:', error);
          reject(error);
        });

        this.setupGameHandlers();
      } catch (error) {
        reject(error);
      }
    });
  }

  private setupGameHandlers() {
    if (!this.socket) return;

    // Game state updates
    this.socket.on(PacketType.GAME_STATE, (data) => {
      console.log('Received game state:', data);
      useGameStore.getState().updateGameState(data);
      useGameStore.getState().setClientState('running');
    });

    // Game started (when game transitions from waiting to active)
    this.socket.on('game_started', (data) => {
      console.log('Game started:', data);
      useGameStore.getState().setClientState('running');
    });

    // Game created successfully (when you create a game)
    this.socket.on('game_created', (data) => {
      console.log('Game created:', data);
      // For single player games, start immediately
      if (data.maxPlayers === 1) {
        useGameStore.getState().setClientState('running');
      } else {
        useGameStore.getState().setClientState('waiting_for_players');
      }
    });

    // Turn events
    this.socket.on(PacketType.TURN_STARTED, (data) => {
      console.log('Turn started:', data);
      useGameStore.getState().updateGameState({ turn: data.turn });
    });

    // Unit events
    this.socket.on(PacketType.UNIT_MOVED, (data) => {
      console.log('Unit moved:', data);
      const { units } = useGameStore.getState();
      if (units[data.unitId]) {
        useGameStore.getState().updateGameState({
          units: {
            ...units,
            [data.unitId]: { ...units[data.unitId], x: data.x, y: data.y }
          }
        });
      }
    });

    // City events
    this.socket.on(PacketType.CITY_FOUNDED, (data) => {
      console.log('City founded:', data);
      const { cities } = useGameStore.getState();
      useGameStore.getState().updateGameState({
        cities: {
          ...cities,
          [data.city.id]: data.city
        }
      });
    });

    // Research events
    this.socket.on(PacketType.RESEARCH_COMPLETED, (data) => {
      console.log('Research completed:', data);
      const { technologies } = useGameStore.getState();
      useGameStore.getState().updateGameState({
        technologies: {
          ...technologies,
          [data.techId]: { ...technologies[data.techId], discovered: true }
        }
      });
    });

    // Error handling
    this.socket.on(PacketType.ERROR, (error) => {
      console.error('Game error:', error);
    });
  }

  // Game actions
  moveUnit(unitId: string, fromX: number, fromY: number, toX: number, toY: number) {
    if (!this.socket) return;
    
    this.socket.emit(PacketType.MOVE_UNIT, {
      unitId,
      fromX,
      fromY,
      toX,
      toY
    });
  }

  foundCity(name: string, x: number, y: number) {
    if (!this.socket) return;
    
    this.socket.emit(PacketType.FOUND_CITY, {
      name,
      x,
      y
    });
  }

  setResearch(techId: string) {
    if (!this.socket) return;
    
    this.socket.emit(PacketType.RESEARCH_SET, {
      techId
    });
  }

  async authenticatePlayer(playerName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to server'));
        return;
      }

      this.socket.emit('packet', {
        type: 4, // SERVER_JOIN_REQ
        data: { username: playerName }
      });

      // Listen for the reply
      const handleReply = (packet: any) => {
        if (packet.type === 5) { // SERVER_JOIN_REPLY
          this.socket?.off('packet', handleReply);
          if (packet.data.accepted) {
            resolve();
          } else {
            reject(new Error(packet.data.message || 'Authentication failed'));
          }
        }
      };

      this.socket.on('packet', handleReply);

      // Timeout after 10 seconds
      setTimeout(() => {
        this.socket?.off('packet', handleReply);
        reject(new Error('Authentication timeout'));
      }, 10000);
    });
  }

  async createGame(gameData: {
    gameName: string;
    playerName: string;
    maxPlayers: number;
    mapSize: string;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to server'));
        return;
      }

      this.socket.emit('create_game', gameData, (response: any) => {
        if (response.success) {
          resolve();
        } else {
          reject(new Error(response.error || 'Failed to create game'));
        }
      });
    });
  }

  // Simple join method for authentication (used by ConnectionDialog)
  joinGame(playerName: string): void {
    if (!this.socket) return;
    
    this.socket.emit('join_game', { playerName });
  }

  // Join specific game method (used by GameLobby)  
  async joinSpecificGame(gameId: string, playerName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to server'));
        return;
      }

      this.socket.emit('join_game', { gameId, playerName }, (response: any) => {
        if (response.success) {
          resolve();
        } else {
          reject(new Error(response.error || 'Failed to join game'));
        }
      });
    });
  }

  async getGameList(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to server'));
        return;
      }

      this.socket.emit('get_game_list', (response: any) => {
        if (response && response.success) {
          resolve(response.games || []);
        } else {
          reject(new Error(response?.error || 'Failed to get game list'));
        }
      });
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }
}

// Export singleton instance
export const gameClient = new GameClient();