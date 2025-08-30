/* eslint-disable @typescript-eslint/no-explicit-any */
import { io, Socket } from 'socket.io-client';
import { SERVER_URL } from '../config';
import { useGameStore } from '../store/gameStore';
import { PacketType } from '../types/packets';

class GameClient {
  private socket: Socket | null = null;
  private serverUrl: string;
  private currentGameId: string | null = null;

  constructor() {
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

    this.socket.on(PacketType.GAME_STATE, data => {
      console.log('Received game state:', data);
      useGameStore.getState().updateGameState(data);
      useGameStore.getState().setClientState('running');
    });

    this.socket.on('game_started', data => {
      console.log('Game started:', data);
      useGameStore.getState().setClientState('running');
    });

    this.socket.on('map-data', data => {
      useGameStore.getState().updateGameState({
        mapData: data,
        map: {
          width: data.width || 0,
          height: data.height || 0,
          tiles: data.tiles || {},
        },
      });
    });

    this.socket.on('map-info', data => {
      // Store in global map variable exactly like freeciv-web: map = packet;
      (window as any).map = data;

      const totalTiles = data.xsize * data.ysize;
      (window as any).tiles = new Array(totalTiles);

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

    this.socket.on('tile-info', data => {
      if ((window as any).tiles && data.tile !== undefined) {
        const tiles = (window as any).tiles;
        tiles[data.tile] = Object.assign(tiles[data.tile] || {}, data);

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

        if (Object.keys(updatedTiles).length === 1) {
          useGameStore.getState().setViewport({
            x: 0,
            y: 0,
          });
        }
      }
    });

    this.socket.on('tile-info-batch', data => {
      if (!(window as any).tiles || !data.tiles) return;

      const tiles = (window as any).tiles;
      const currentMap = useGameStore.getState().map;
      const updatedTiles = { ...currentMap.tiles };

      for (const tileData of data.tiles) {
        tiles[tileData.tile] = Object.assign(tiles[tileData.tile] || {}, tileData);

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

      if (data.endIndex === data.total) {
        setTimeout(() => {
          const resizeEvent = new Event('resize', { bubbles: true });
          window.dispatchEvent(resizeEvent);

          setTimeout(() => {
            window.dispatchEvent(new Event('resize', { bubbles: true }));
          }, 50);

          setTimeout(() => {
            window.dispatchEvent(new Event('resize', { bubbles: true }));
          }, 150);
        }, 200);
      }
    });

    this.socket.on('game_created', data => {
      console.log('Game created:', data);
      if (data.maxPlayers === 1) {
        useGameStore.getState().setClientState('running');
      } else {
        useGameStore.getState().setClientState('waiting_for_players');
      }
    });

    this.socket.on(PacketType.TURN_STARTED, data => {
      console.log('Turn started:', data);
      useGameStore.getState().updateGameState({ turn: data.turn });
    });

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

    this.socket.on(PacketType.ERROR, error => {
      console.error('Game error:', error);
    });
  }

  moveUnit(unitId: string, fromX: number, fromY: number, toX: number, toY: number) {
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
        type: 4,
        data: {
          username: playerName,
          version: '1.0.0',
          capability: 'civjs-1.0',
        },
      };

      this.socket.emit('packet', packet);

      const handleReply = (packet: any) => {
        if (packet.type === 5) {
          this.socket?.off('packet', handleReply);
          if (packet.data.accepted) {
            resolve();
          } else {
            console.error('Authentication failed:', packet.data);
            reject(new Error(packet.data.message || 'Authentication failed'));
          }
        }
      };

      this.socket.on('packet', handleReply);

      setTimeout(() => {
        this.socket?.off('packet', handleReply);
        reject(new Error('Authentication timeout'));
      }, 10000);
    });
  }

  async createGame(gameData: {
    gameName: string;
    playerName: string;
    gameType?: 'single' | 'multiplayer';
    maxPlayers: number;
    mapSize: string;
    terrainSettings?: {
      generator: string;
      landmass: string;
      huts: number;
      temperature: number;
      wetness: number;
      rivers: number;
      resources: string;
    };
  }): Promise<string> {
    await this.authenticatePlayer(gameData.playerName);

    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to server'));
        return;
      }

      const mapSizes: Record<string, { width: number; height: number }> = {
        small: { width: 40, height: 25 },
        standard: { width: 80, height: 50 },
        large: { width: 120, height: 75 },
      };

      const dimensions = mapSizes[gameData.mapSize] || mapSizes.standard;

      this.socket.emit('packet', {
        type: 200, // GAME_CREATE
        data: {
          name: gameData.gameName,
          gameType: gameData.gameType || 'multiplayer',
          maxPlayers: gameData.maxPlayers,
          mapWidth: dimensions.width,
          mapHeight: dimensions.height,
          ruleset: 'classic',
          victoryConditions: [],
          turnTimeLimit: 120,
          terrainSettings: gameData.terrainSettings || {
            generator: 'random',
            landmass: 'normal',
            huts: 15,
            temperature: 50,
            wetness: 50,
            rivers: 50,
            resources: 'normal',
          },
        },
      });

      const handleReply = (packet: any) => {
        if (packet.type === 201) {
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

      setTimeout(() => {
        this.socket?.off('packet', handleReply);
        reject(new Error('Game creation timeout'));
      }, 10000);
    });
  }

  joinGame(playerName: string): void {
    if (!this.socket) return;

    this.socket.emit('join_game', { playerName });
  }

  async joinSpecificGame(gameId: string, playerName: string): Promise<void> {
    await this.authenticatePlayer(playerName);

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

  async observeGame(gameId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to server'));
        return;
      }

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

export const gameClient = new GameClient();
