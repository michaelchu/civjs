/* eslint-disable @typescript-eslint/no-explicit-any */
import { io, Socket } from 'socket.io-client';
import { useGameStore } from '../store/gameStore';
import { PacketType } from '../types/packets';
import { SERVER_URL } from '../config';

class GameClient {
  private socket: Socket | null = null;
  private serverUrl: string;
  private currentGameId: string | null = null;

  constructor() {
    // Use server URL from config
    this.serverUrl = SERVER_URL;
    console.log('Connecting to server:', this.serverUrl);
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

        this.socket.on('connect_error', error => {
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
    this.socket.on(PacketType.GAME_STATE, data => {
      console.log('Received game state:', data);
      useGameStore.getState().updateGameState(data);
      useGameStore.getState().setClientState('running');
    });

    // Game started (when game transitions from waiting to active)
    this.socket.on('game_started', data => {
      console.log('Game started:', data);
      useGameStore.getState().setClientState('running');
    });

    // Map data events - handle both formats
    this.socket.on('map-data', data => {
      useGameStore.getState().updateGameState({
        mapData: data,
        map: {
          width: data.width || 0,
          height: data.height || 0,
          tiles: data.tiles || {}, // Use server-provided tiles
        },
      });
    });

    // Handle map-info packet exactly like freeciv-web
    this.socket.on('map-info', data => {
      // Store in global map variable exactly like freeciv-web: map = packet;
      (window as any).map = data;

      // Initialize empty tiles array
      const totalTiles = data.xsize * data.ysize;
      (window as any).tiles = new Array(totalTiles);

      // Initialize tiles with empty objects like freeciv-web does
      for (let i = 0; i < totalTiles; i++) {
        (window as any).tiles[i] = {
          index: i,
          x: i % data.xsize,
          y: Math.floor(i / data.xsize),
          known: 0,
          seen: 0,
        };
      }
    });

    // Handle tile-info packets exactly like freeciv-web
    this.socket.on('tile-info', data => {
      // Update tiles array exactly like freeciv-web: tiles[packet['tile']] = $.extend(tiles[packet['tile']], packet);
      if ((window as any).tiles && data.tile !== undefined) {
        const tiles = (window as any).tiles;
        tiles[data.tile] = Object.assign(tiles[data.tile] || {}, data);

        // Update our game store for compatibility (convert to object format)
        const tileKey = `${data.x},${data.y}`;
        const currentMap = useGameStore.getState().map;

        const updatedTiles = {
          ...currentMap.tiles,
          [tileKey]: {
            x: data.x,
            y: data.y,
            terrain: data.terrain,
            visible: data.known > 0,
            known: data.seen > 0,
            units: [],
            city: undefined,
          },
        };

        useGameStore.getState().updateGameState({
          map: {
            width: (window as any).map?.xsize || 80,
            height: (window as any).map?.ysize || 50,
            tiles: updatedTiles,
            // Store freeciv-web references
            xsize: (window as any).map?.xsize || 80,
            ysize: (window as any).map?.ysize || 50,
            wrap_id: (window as any).map?.wrap_id || 0,
          },
        });

        // Center viewport on first received tile
        if (Object.keys(updatedTiles).length === 1) {
          useGameStore.getState().setViewport({
            x: 0,
            y: 0,
          });
        }
      }
    });

    // OPTIMIZED: Handle batch tile updates for better performance
    this.socket.on('tile-info-batch', data => {
      if (!(window as any).tiles || !data.tiles) return;

      const tiles = (window as any).tiles;
      const currentMap = useGameStore.getState().map;
      const updatedTiles = { ...currentMap.tiles };

      // Process all tiles in the batch
      for (const tileData of data.tiles) {
        // Update global tiles array
        tiles[tileData.tile] = Object.assign(
          tiles[tileData.tile] || {},
          tileData
        );

        // Update game store tiles
        const tileKey = `${tileData.x},${tileData.y}`;
        updatedTiles[tileKey] = {
          x: tileData.x,
          y: tileData.y,
          terrain: tileData.terrain,
          visible: tileData.known > 0,
          known: tileData.seen > 0,
          units: [],
          city: undefined,
          resource: tileData.resource,
        };
      }

      // Update the store once with all tiles
      useGameStore.getState().updateGameState({
        map: {
          width: (window as any).map?.xsize || 80,
          height: (window as any).map?.ysize || 50,
          tiles: updatedTiles,
          // Store freeciv-web references
          xsize: (window as any).map?.xsize || 80,
          ysize: (window as any).map?.ysize || 50,
          wrap_id: (window as any).map?.wrap_id || 0,
        },
      });

      // Log progress  
      if (data.endIndex === data.total) {
        // All tiles received - batch processing complete
        console.log('All tile batches loaded - simulating manual resize fix');
        
        // Replicate what manual window resize does to fix the display
        setTimeout(() => {
          // Create and dispatch actual resize events like a real window resize
          const resizeEvent = new Event('resize', { bubbles: true });
          window.dispatchEvent(resizeEvent);
          
          // Also try triggering it multiple times to ensure it takes
          setTimeout(() => {
            window.dispatchEvent(new Event('resize', { bubbles: true }));
          }, 50);
          
          setTimeout(() => {
            window.dispatchEvent(new Event('resize', { bubbles: true }));
          }, 150);
        }, 200);
      }
    });

    // Game created successfully (when you create a game)
    this.socket.on('game_created', data => {
      console.log('Game created:', data);
      // For single player games, start immediately
      if (data.maxPlayers === 1) {
        useGameStore.getState().setClientState('running');
      } else {
        useGameStore.getState().setClientState('waiting_for_players');
      }
    });

    // Turn events
    this.socket.on(PacketType.TURN_STARTED, data => {
      console.log('Turn started:', data);
      useGameStore.getState().updateGameState({ turn: data.turn });
    });

    // Unit events
    this.socket.on(PacketType.UNIT_MOVED, data => {
      console.log('Unit moved:', data);
      const { units } = useGameStore.getState();
      if (units[data.unitId]) {
        useGameStore.getState().updateGameState({
          units: {
            ...units,
            [data.unitId]: { ...units[data.unitId], x: data.x, y: data.y },
          },
        });
      }
    });

    // City events
    this.socket.on(PacketType.CITY_FOUNDED, data => {
      console.log('City founded:', data);
      const { cities } = useGameStore.getState();
      useGameStore.getState().updateGameState({
        cities: {
          ...cities,
          [data.city.id]: data.city,
        },
      });
    });

    // Research events
    this.socket.on(PacketType.RESEARCH_COMPLETED, data => {
      console.log('Research completed:', data);
      const { technologies } = useGameStore.getState();
      useGameStore.getState().updateGameState({
        technologies: {
          ...technologies,
          [data.techId]: { ...technologies[data.techId], discovered: true },
        },
      });
    });

    // Error handling
    this.socket.on(PacketType.ERROR, error => {
      console.error('Game error:', error);
    });
  }

  // Game actions
  moveUnit(
    unitId: string,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ) {
    if (!this.socket) return;

    this.socket.emit(PacketType.MOVE_UNIT, {
      unitId,
      fromX,
      fromY,
      toX,
      toY,
    });
  }

  foundCity(name: string, x: number, y: number) {
    if (!this.socket) return;

    this.socket.emit(PacketType.FOUND_CITY, {
      name,
      x,
      y,
    });
  }

  setResearch(techId: string) {
    if (!this.socket) return;

    this.socket.emit(PacketType.RESEARCH_SET, {
      techId,
    });
  }

  // Map data methods
  async getMapData(): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to server'));
        return;
      }

      this.socket.emit('get_map_data', {}, (response: any) => {
        if (response.success) {
          resolve(response.mapData);
        } else {
          reject(new Error(response.error || 'Failed to get map data'));
        }
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        reject(new Error('Get map data timeout'));
      }, 10000);
    });
  }

  async getVisibleTiles(): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to server'));
        return;
      }

      this.socket.emit('get_visible_tiles', {}, (response: any) => {
        if (response.success) {
          resolve(response.visibleTiles);
        } else {
          reject(new Error(response.error || 'Failed to get visible tiles'));
        }
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        reject(new Error('Get visible tiles timeout'));
      }, 10000);
    });
  }

  async authenticatePlayer(playerName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to server'));
        return;
      }

      const packet = {
        type: 4, // SERVER_JOIN_REQ
        data: {
          username: playerName,
          version: '1.0.0',
          capability: 'civjs-1.0',
        },
      };

      console.log('Sending SERVER_JOIN_REQ packet:', packet);
      this.socket.emit('packet', packet);

      // Listen for the reply
      const handleReply = (packet: any) => {
        console.log('Received packet:', packet);
        if (packet.type === 5) {
          // SERVER_JOIN_REPLY
          console.log('Received SERVER_JOIN_REPLY:', packet.data);
          this.socket?.off('packet', handleReply);
          if (packet.data.accepted) {
            console.log('Authentication successful');
            resolve();
          } else {
            console.error('Authentication failed:', packet.data);
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
  }): Promise<string> {
    // First authenticate the player
    await this.authenticatePlayer(gameData.playerName);

    // Then create the game using the packet system
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to server'));
        return;
      }

      // Map size to dimensions
      const mapSizes: Record<string, { width: number; height: number }> = {
        small: { width: 40, height: 25 },
        standard: { width: 80, height: 50 },
        large: { width: 120, height: 75 },
      };

      const dimensions = mapSizes[gameData.mapSize] || mapSizes.standard;

      // Send GAME_CREATE packet
      this.socket.emit('packet', {
        type: 200, // GAME_CREATE
        data: {
          name: gameData.gameName,
          maxPlayers: gameData.maxPlayers,
          mapWidth: dimensions.width,
          mapHeight: dimensions.height,
          ruleset: 'classic',
          victoryConditions: [],
          turnTimeLimit: 120,
        },
      });

      // Listen for the reply
      const handleReply = (packet: any) => {
        if (packet.type === 201) {
          // GAME_CREATE_REPLY
          this.socket?.off('packet', handleReply);
          if (packet.data.success) {
            this.currentGameId = packet.data.gameId;
            resolve(packet.data.gameId);
          } else {
            reject(new Error(packet.data.message || 'Failed to create game'));
          }
        }
      };

      this.socket.on('packet', handleReply);

      // Timeout after 10 seconds
      setTimeout(() => {
        this.socket?.off('packet', handleReply);
        reject(new Error('Game creation timeout'));
      }, 10000);
    });
  }

  // Simple join method for authentication (used by ConnectionDialog)
  joinGame(playerName: string): void {
    if (!this.socket) return;

    this.socket.emit('join_game', { playerName });
  }

  // Join specific game method (used by GameLobby)
  async joinSpecificGame(gameId: string, playerName: string): Promise<void> {
    // First authenticate the player
    await this.authenticatePlayer(playerName);

    // Then join the specific game
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to server'));
        return;
      }

      this.socket.emit('join_game', { gameId, playerName }, (response: any) => {
        if (response.success) {
          this.currentGameId = gameId;
          resolve();
        } else {
          reject(new Error(response.error || 'Failed to join game'));
        }
      });
    });
  }

  // Observe game method for when joining as player fails
  async observeGame(gameId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to server'));
        return;
      }

      // Try to observe/spectate the game instead of joining as a player
      this.socket.emit('observe_game', { gameId }, (response: any) => {
        if (response.success) {
          this.currentGameId = gameId;
          resolve();
        } else {
          reject(new Error(response.error || 'Failed to observe game'));
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
      this.currentGameId = null;
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  getCurrentGameId(): string | null {
    return this.currentGameId;
  }
}

// Export singleton instance
export const gameClient = new GameClient();
