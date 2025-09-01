/* eslint-disable @typescript-eslint/no-explicit-any */
import { io, Socket } from 'socket.io-client';
import { SERVER_URL } from '../config';
import { useGameStore } from '../store/gameStore';
import { PacketType, PACKET_NAMES, type Packet } from '../types/packets';
import { ActionType } from '../types/shared/actions';

// Mock government data for development
const getMockGovernments = () => ({
  anarchy: {
    id: 'anarchy',
    name: 'Anarchy',
    graphic: 'gov.anarchy',
    graphic_alt: '-',
    sound: 'g_anarchy',
    sound_alt: '-',
    sound_alt2: '-',
    ruler_male_title: 'Warlord %s',
    ruler_female_title: 'Warlady %s',
    helptext:
      'Anarchy is simply the absence of any recognizable government. Citizens are disorganized and unproductive, and will spend all income as quickly as possible, rather than paying taxes or conducting research.',
  },
  despotism: {
    id: 'despotism',
    name: 'Despotism',
    graphic: 'gov.despotism',
    graphic_alt: '-',
    sound: 'g_despotism',
    sound_alt: 'g_generic',
    sound_alt2: '-',
    ai_better: 'Monarchy',
    ruler_male_title: 'Chief %s',
    ruler_female_title: 'Chief %s',
    helptext:
      'Under Despotism, you are the absolute ruler of your people. Your control over your citizens is maintained largely by martial law. Despotism suffers the highest level of corruption of all forms of government.',
  },
  monarchy: {
    id: 'monarchy',
    name: 'Monarchy',
    reqs: [{ type: 'tech', name: 'Monarchy', range: 'Player' }],
    graphic: 'gov.monarchy',
    graphic_alt: '-',
    sound: 'g_monarchy',
    sound_alt: 'g_generic',
    sound_alt2: '-',
    ai_better: 'Communism',
    ruler_male_title: 'King %s',
    ruler_female_title: 'Queen %s',
    helptext:
      'Under Monarchy, a king or queen serves as a hereditary figurehead for your government. Monarchy suffers the same small amount of corruption that the Republic does.',
  },
  republic: {
    id: 'republic',
    name: 'Republic',
    reqs: [{ type: 'tech', name: 'The Republic', range: 'Player' }],
    graphic: 'gov.republic',
    graphic_alt: '-',
    sound: 'g_republic',
    sound_alt: 'g_generic',
    sound_alt2: '-',
    ruler_male_title: 'President %s',
    ruler_female_title: 'President %s',
    helptext:
      'Under a Republican government, citizens hold an election to select a representative who will govern them; since elected leaders must remain popular to remain in control, citizens are given a greater degree of freedom.',
  },
  communism: {
    id: 'communism',
    name: 'Communism',
    reqs: [{ type: 'tech', name: 'Communism', range: 'Player' }],
    graphic: 'gov.communism',
    graphic_alt: '-',
    sound: 'g_communism',
    sound_alt: 'g_generic',
    sound_alt2: '-',
    ruler_male_title: 'Comrade %s',
    ruler_female_title: 'Comrade %s',
    helptext:
      'A Communist government is based on the ideal that all people are equal. All goods are owned by the state, rather than by private citizens.',
  },
  democracy: {
    id: 'democracy',
    name: 'Democracy',
    reqs: [{ type: 'tech', name: 'Democracy', range: 'Player' }],
    graphic: 'gov.democracy',
    graphic_alt: '-',
    sound: 'g_democracy',
    sound_alt: 'g_generic',
    sound_alt2: '-',
    ruler_male_title: 'Prime Minister %s',
    ruler_female_title: 'Prime Minister %s',
    helptext:
      'Under Democracy, citizens govern directly by voting on issues. Democracy offers the highest possible level of trade, but also offers the most potential for unhappiness.',
  },
});

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

    // Main packet handler - processes all structured packets
    this.socket.on('packet', (packet: Packet) => {
      this.handlePacket(packet);
    });

    // Legacy event handlers removed - now handled via structured packets

    // Keep compatibility events for game management
    this.socket.on('game_created', data => {
      console.log('Game created:', data);

      // Initialize mock player state since server automatically joins creator as player
      if (data.playerId) {
        const mockPlayer = {
          id: data.playerId,
          name: 'Player', // We don't have the name here, will be updated later
          nation: 'random',
          color: '#0066cc',
          gold: 50,
          science: 0,
          government: 'despotism', // Default starting government
          isHuman: true,
          isActive: true, // Make player active so turn done button works
        };

        const mockGovernments = getMockGovernments();

        useGameStore.getState().updateGameState({
          currentPlayerId: data.playerId,
          players: {
            [data.playerId]: mockPlayer,
          },
          governments: mockGovernments,
          turn: 1, // Initialize turn
        });
      }

      if (data.maxPlayers === 1) {
        useGameStore.getState().setClientState('running');
        useGameStore.getState().updateGameState({
          phase: 'movement',
        });
      } else {
        useGameStore.getState().setClientState('waiting_for_players');
      }
    });

    this.socket.on('game_started', data => {
      console.log('Game started:', data);
      useGameStore.getState().setClientState('running');
      // Set initial game phase to movement so turn done button works
      useGameStore.getState().updateGameState({
        phase: 'movement',
      });
    });
  }

  private handlePacket(packet: Packet) {
    const packetName = PACKET_NAMES[packet.type] || `UNKNOWN_${packet.type}`;

    switch (packet.type) {
      case PacketType.GAME_INFO:
        useGameStore.getState().updateGameState({
          ...packet.data,
          phase: 'movement', // Ensure phase is set for turn system to work
        });
        useGameStore.getState().setClientState('running');
        break;

      case PacketType.TURN_START:
        console.log('Turn started:', packet.data);
        console.log('Updating turn to:', packet.data.turn);
        useGameStore.getState().updateGameState({
          turn: packet.data.turn,
          phase: 'movement', // Reset phase to movement for new turn
          // TODO: Add year to GameState interface
        });
        // Let turn processing complete naturally - don't reset immediately
        console.log('Current game state turn after update:', useGameStore.getState().turn);
        break;

      case PacketType.UNIT_INFO:
        console.log('Unit info:', packet.data);
        if (packet.data.units && Array.isArray(packet.data.units)) {
          const { units } = useGameStore.getState();
          const updatedUnits = { ...units };

          for (const unitData of packet.data.units) {
            updatedUnits[unitData.id] = {
              id: unitData.id,
              playerId: unitData.playerId,
              type: unitData.type,
              x: unitData.x,
              y: unitData.y,
              hp: unitData.hp,
              movesLeft: unitData.movesLeft,
              veteranLevel: unitData.veteranLevel,
            };
          }

          useGameStore.getState().updateGameState({
            units: updatedUnits,
          });
        }
        break;

      case PacketType.UNIT_MOVE_REPLY:
        console.log('Unit move reply:', packet.data);
        if (packet.data.success) {
          const { units } = useGameStore.getState();
          if (units[packet.data.unitId]) {
            useGameStore.getState().updateGameState({
              units: {
                ...units,
                [packet.data.unitId]: {
                  ...units[packet.data.unitId],
                  x: packet.data.newX,
                  y: packet.data.newY,
                  movementLeft: packet.data.movementLeft,
                },
              },
            });
          }
        } else {
          console.error('Unit move failed:', packet.data.message);
        }
        break;

      case PacketType.CITY_FOUND_REPLY:
        console.log('City found reply:', packet.data);
        if (packet.data.success) {
          // City info will come via separate CITY_INFO packet
          console.log('City founded successfully:', packet.data.cityId);
        } else {
          console.error('City founding failed:', packet.data.message);
        }
        break;

      case PacketType.CITY_INFO: {
        console.log('City info:', packet.data);
        const { cities } = useGameStore.getState();
        useGameStore.getState().updateGameState({
          cities: {
            ...cities,
            [packet.data.id]: packet.data,
          },
        });
        break;
      }

      case PacketType.RESEARCH_SET_REPLY:
        console.log('Research set reply:', packet.data);
        if (packet.data.success && packet.data.availableTechs) {
          // TODO: Add availableTechnologies to GameState interface
          console.log('Available technologies updated:', packet.data.availableTechs);
        } else if (!packet.data.success) {
          console.error('Research setting failed:', packet.data.message);
        }
        break;

      case PacketType.SERVER_JOIN_REPLY:
        console.log('Server join reply:', packet.data);
        if (packet.data.accepted) {
          console.log('Successfully joined server as:', packet.data.playerId);
        } else {
          console.error('Server join failed:', packet.data.message);
        }
        break;

      case PacketType.CONNECT_MSG:
        console.log('Connection message:', packet.data);
        if (packet.data.type === 'error') {
          console.error('Server error:', packet.data.message);
        }
        break;

      case PacketType.CHAT_MSG:
        console.log('Chat message:', packet.data);
        // Handle chat messages
        break;

      case PacketType.MAP_INFO:
        this.handleMapInfo(packet.data);
        break;

      case PacketType.TILE_INFO:
        if (Array.isArray(packet.data.tiles)) {
          // Handle batch tile info
          this.handleTileInfoBatch(packet.data);
        } else {
          // Handle single tile info
          this.handleTileInfo(packet.data);
        }
        break;

      case PacketType.PROCESSING_STARTED:
        console.log('Server processing started');
        break;

      case PacketType.PROCESSING_FINISHED:
        console.log('Server processing finished');
        break;

      case PacketType.TURN_END_REPLY:
        console.log('Turn end reply:', packet.data);
        if (packet.data.success) {
          console.log('Turn ended successfully', { turnAdvanced: packet.data.turnAdvanced });
        } else {
          console.error('Turn end failed:', packet.data.message);
        }
        break;

      case PacketType.GAME_CREATE_REPLY:
        console.log('Game create reply:', packet.data);
        if (packet.data.success) {
          console.log('Game created successfully:', packet.data.gameId);
        } else {
          console.error('Game creation failed:', packet.data.message);
        }
        break;

      case PacketType.TURN_PROCESSING_STEP:
        this.handleTurnProcessingStep(packet.data);
        break;

      default:
        console.log(`Unhandled packet type: ${packetName} (${packet.type})`);
    }
  }

  private handleMapInfo(data: any) {
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
  }

  private handleTileInfo(data: any) {
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
  }

  private handleTileInfoBatch(data: any) {
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
  }

  moveUnit(unitId: string, _fromX: number, _fromY: number, toX: number, toY: number) {
    if (!this.socket) return;

    const packet: Packet = {
      type: PacketType.UNIT_MOVE,
      data: {
        unitId,
        x: toX, // Server expects x, y as destination
        y: toY,
      },
      timestamp: Date.now(),
    };

    this.socket.emit('packet', packet);
  }

  foundCity(name: string, x: number, y: number) {
    if (!this.socket) return;

    const packet: Packet = {
      type: PacketType.CITY_FOUND,
      data: {
        name,
        x,
        y,
      },
      timestamp: Date.now(),
    };

    this.socket.emit('packet', packet);
  }

  setResearch(techId: string) {
    if (!this.socket) return;

    const packet: Packet = {
      type: PacketType.RESEARCH_SET,
      data: {
        techId,
      },
      timestamp: Date.now(),
    };

    this.socket.emit('packet', packet);
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

      const packet: Packet = {
        type: PacketType.SERVER_JOIN_REQ,
        data: {
          username: playerName,
          version: '1.0.0',
          capability: 'civjs-1.0',
        },
        timestamp: Date.now(),
      };

      this.socket.emit('packet', packet);

      const handleReply = (replyPacket: Packet) => {
        if (replyPacket.type === PacketType.SERVER_JOIN_REPLY) {
          this.socket?.off('packet', handleReply);
          if (replyPacket.data.accepted) {
            console.log('Authentication successful:', replyPacket.data);
            resolve();
          } else {
            console.error('Authentication failed:', replyPacket.data);
            reject(new Error(replyPacket.data.message || 'Authentication failed'));
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

      const createPacket: Packet = {
        type: PacketType.GAME_CREATE,
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
        timestamp: Date.now(),
      };

      console.log(
        `Sending packet: ${PACKET_NAMES[createPacket.type]} (${createPacket.type})`,
        createPacket.data
      );
      this.socket.emit('packet', createPacket);

      const handleReply = (replyPacket: Packet) => {
        if (replyPacket.type === PacketType.GAME_CREATE_REPLY) {
          this.socket?.off('packet', handleReply);
          if (replyPacket.data.success) {
            this.currentGameId = replyPacket.data.gameId;
            resolve(replyPacket.data.gameId);
          } else {
            reject(new Error(replyPacket.data.message || 'Failed to create game'));
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

          // Initialize mock player state for turn system to work
          const mockPlayer = {
            id: response.playerId,
            name: playerName,
            nation: 'random',
            color: '#0066cc',
            gold: 50,
            science: 0,
            government: 'despotism', // Default starting government
            isHuman: true,
            isActive: true, // Make player active so turn done button works
          };

          useGameStore.getState().updateGameState({
            currentPlayerId: response.playerId,
            players: {
              [response.playerId]: mockPlayer,
            },
            governments: getMockGovernments(),
            phase: 'movement', // Set phase to movement
            turn: 1, // Initialize turn
          });

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

  async deleteGame(gameId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to server'));
        return;
      }

      this.socket.emit('delete_game', { gameId }, (response: any) => {
        if (response && response.success) {
          resolve();
        } else {
          reject(new Error(response?.error || 'Failed to delete game'));
        }
      });
    });
  }

  endTurn(): void {
    if (!this.socket) return;

    const packet: Packet = {
      type: PacketType.END_TURN,
      data: {},
      timestamp: Date.now(),
    };

    this.socket.emit('packet', packet);
  }

  private handleTurnProcessingStep(data: any) {
    const gameStore = useGameStore.getState();

    // Handle completion step
    if (data.step === 'complete') {
      gameStore.completeTurnProcessing();
      return;
    }

    // Map server step IDs to client step IDs
    const stepMapping: Record<string, string> = {
      'player-actions': 'validate',
      'city-production': 'cities',
      'unit-actions': 'units',
      research: 'research',
      'random-events': 'events',
      statistics: 'events', // Map statistics to events step for now
      'database-save': 'events', // Map database save to events step for now
      'next-turn': 'advance',
    };

    const clientStepId = stepMapping[data.step] || data.step;

    // Initialize processing if steps are empty (either idle state or processing with no steps)
    if (gameStore.turnProcessingState === 'idle' || gameStore.turnProcessingSteps.length === 0) {
      // Set up initial steps based on server processing steps
      const initialSteps = [
        { id: 'validate', label: 'Processing player actions...', completed: false, active: false },
        { id: 'units', label: 'Processing unit actions...', completed: false, active: false },
        { id: 'cities', label: 'Processing city production...', completed: false, active: false },
        { id: 'research', label: 'Processing research...', completed: false, active: false },
        {
          id: 'events',
          label: 'Processing events & statistics...',
          completed: false,
          active: false,
        },
        { id: 'advance', label: 'Advancing to next turn...', completed: false, active: false },
      ];

      gameStore.setTurnProcessingState('processing');
      gameStore.updateTurnProcessingSteps(initialSteps);
    }

    // Update the specific step - get fresh state after potential initialization
    const freshGameStore = useGameStore.getState();
    const currentSteps = freshGameStore.turnProcessingSteps;
    const updatedSteps = currentSteps.map(step => {
      if (step.id === clientStepId) {
        return {
          ...step,
          label: data.label,
          active: true,
          completed: false,
        };
      } else {
        // Mark previous steps as completed
        const stepOrder = ['validate', 'units', 'cities', 'research', 'events', 'advance'];
        const currentStepIndex = stepOrder.indexOf(clientStepId);
        const thisStepIndex = stepOrder.indexOf(step.id);

        if (thisStepIndex < currentStepIndex) {
          return { ...step, completed: true, active: false };
        }
        return { ...step, active: false };
      }
    });

    freshGameStore.updateTurnProcessingSteps(updatedSteps);
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

  /**
   * Request unit action from server
   */
  requestUnitAction(
    unitId: string,
    actionType: ActionType,
    targetX?: number,
    targetY?: number
  ): Promise<boolean> {
    return new Promise(resolve => {
      if (!this.socket) {
        console.error('Socket not connected');
        resolve(false);
        return;
      }

      // Send unit action request to server and wait for response
      this.socket.emit('unit_action', {
        unitId,
        actionType,
        targetX,
        targetY,
      }, (response: { success: boolean; error?: string; result?: any }) => {
        if (response.success) {
          console.log(`Successfully executed ${actionType} for unit ${unitId}`, {
            targetX,
            targetY,
            result: response.result
          });
          resolve(true);
        } else {
          console.error(`Failed to execute ${actionType} for unit ${unitId}:`, response.error);
          resolve(false);
        }
      });
    });
  }

  /**
   * Request unit fortify action (legacy compatibility)
   */
  fortifyUnit(unitId: string): Promise<boolean> {
    return this.requestUnitAction(unitId, ActionType.FORTIFY);
  }

  /**
   * Request unit sentry action (legacy compatibility)
   */
  sentryUnit(unitId: string): Promise<boolean> {
    return this.requestUnitAction(unitId, ActionType.SENTRY);
  }

  /**
   * Request unit goto action (legacy compatibility)
   */
  gotoUnit(unitId: string, targetX: number, targetY: number): Promise<boolean> {
    return this.requestUnitAction(unitId, ActionType.GOTO, targetX, targetY);
  }

  /**
   * Request unit found city action (legacy compatibility)
   */
  foundCityWithUnit(unitId: string): Promise<boolean> {
    return this.requestUnitAction(unitId, ActionType.FOUND_CITY);
  }
}

export const gameClient = new GameClient();
