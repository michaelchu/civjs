/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Socket } from 'socket.io-client';
import { SERVER_URL } from '../config';
import { useGameStore } from '../store/gameStore';
import { PacketType, PACKET_NAMES, PROTOCOL_VERSION, type Packet } from '../types/packets';
import { ActionType, type ActionResult } from '../types/shared/actions';
import { pathfindingService } from './PathfindingService';
import { playerColorToHex } from '../utils/playerColors';
import { storeUsername } from '../utils/gameSession';
import type {
  City,
  DiplomacyState,
  GovernmentState,
  ProductionOption,
  TreatyClause,
  TreatyClauseType,
} from '../types';
import { playEndGameSound } from './UserPreferences';
import { GameSessionCoordinator, type GameSessionTarget } from './GameSessionCoordinator';
import { GameTransport } from './GameTransport';
import { MapSnapshotAssembler } from './MapSnapshotAssembler';

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

export class GameClient {
  private socket: Socket | null = null;
  private currentGameId: string | null = null;
  private pendingGameJoins = new Map<string, Promise<void>>();
  private readonly session = new GameSessionCoordinator();
  private readonly transport: GameTransport;
  private readonly mapSnapshots = new MapSnapshotAssembler();
  private reconnectPromise: Promise<void> | null = null;

  constructor(transport = new GameTransport(SERVER_URL)) {
    this.transport = transport;
    console.log('Connecting to server:', SERVER_URL);
  }

  async connect(): Promise<void> {
    if (this.socket?.connected) {
      return;
    }

    this.session.connecting();
    this.socket = await this.transport.connect(
      socket => {
        this.socket = socket;
        this.setupGameHandlers();
      },
      {
        connected: () => {
          console.log('Connected to game server');
          useGameStore.getState().setClientState('connecting');
        },
        disconnected: () => {
          console.log('Disconnected from game server');
          this.session.disconnected();
          this.mapSnapshots.cancel();
          useGameStore.getState().setClientState('initial');
        },
        connectionError: error => {
          console.error('Connection error:', error);
        },
        reconnected: attemptNumber => {
          console.log(`Reconnected to server after ${attemptNumber} attempts`);
          void this.resumeSession();
        },
        reconnectError: error => {
          console.warn('Reconnection failed:', error);
        },
      }
    );
  }

  private setupGameHandlers() {
    if (!this.socket) return;

    // Main packet handler - processes all structured packets
    this.socket.on('packet', (packet: Packet) => {
      this.handlePacket(packet);
    });

    // Legacy event handlers removed - now handled via structured packets

    this.socket.on('game_started', data => {
      console.log('Game started:', data);
      useGameStore.getState().setClientState('running');
      // Set initial game phase to movement so turn done button works
      useGameStore.getState().updateGameState({
        phase: 'movement',
      });
    });

    // Handle unit movement updates
    this.socket.on('unit_moved', data => {
      console.log('Unit moved:', data);
      const { units } = useGameStore.getState();
      if (units[data.unitId]) {
        useGameStore.getState().updateGameState({
          units: {
            ...units,
            [data.unitId]: {
              ...units[data.unitId],
              x: data.x,
              y: data.y,
              movesLeft: Math.floor(data.movementLeft / 3), // Convert from fragments to moves
            },
          },
        });

        // Clear cached paths for this unit to prevent stale path visualization
        pathfindingService.clearUnitPaths(data.unitId);
      }
    });

    // Handle unit destruction (e.g., settler consumed by city founding)
    this.socket.on('unit_destroyed', data => {
      console.log('Unit destroyed:', data);
      const { units } = useGameStore.getState();
      if (units[data.unitId]) {
        const newUnits = { ...units };
        delete newUnits[data.unitId];
        useGameStore.getState().updateGameState({
          units: newUnits,
        });

        // Clear selected unit if this unit was selected
        const { selectedUnitId } = useGameStore.getState();
        if (selectedUnitId === data.unitId) {
          useGameStore.getState().selectUnit(null);
        }

        // Clear cached paths for this unit
        pathfindingService.clearUnitPaths(data.unitId);
      }
    });

    // Handle city founding
    this.socket.on('city_founded', data => {
      console.log('City founded:', data);
      const { cities } = useGameStore.getState();
      const newCities = { ...cities };
      // Use the actual city data sent from the server
      newCities[data.city.id] = data.city;
      useGameStore.getState().updateGameState({
        cities: newCities,
      });
    });

    // Handle bulk city data updates with calculated production rates
    this.socket.on('cities_updated', data => {
      console.log('Cities updated with production data:', data);

      if (data.cities) {
        useGameStore.getState().updateGameState({
          cities: data.cities,
        });
      }
    });

    this.socket.on('culture_updated', data => this.applyCultureUpdate(data));

    // Handle production completion events
    this.socket.on('production:completed', data => {
      console.log('Production completed:', data);
      const { cityId, productionType, productionId, newUnitId } = data;

      if (productionType === 'unit' && newUnitId) {
        // A new unit was created - it should already be in the units update
        console.log(`New unit ${newUnitId} created at city ${cityId}`);

        // The unit should already be added to the game state via other packets
        // But we can trigger any UI notifications here if needed
      } else if (productionType === 'building') {
        console.log(`Building ${productionId} completed in city ${cityId}`);
        // Building completions are handled via city updates
      } else if (productionType === 'wonder') {
        console.log(`Wonder ${productionId} completed in city ${cityId}`);
        // Wonder completions might need special handling/notifications
      }
    });
  }

  private handlePacket(packet: Packet) {
    if (packet.version !== undefined && packet.version !== PROTOCOL_VERSION) {
      console.error(`Ignoring unsupported protocol version ${packet.version}`);
      return;
    }
    const packetName = PACKET_NAMES[packet.type] || `UNKNOWN_${packet.type}`;

    // Debug log for border packets
    if (packet.type >= 240 && packet.type <= 244) {
      console.log(`📡 Received border packet: ${packetName} (${packet.type})`, packet.data);
    }

    switch (packet.type) {
      case PacketType.GAME_INFO:
        useGameStore.getState().updateGameState({
          ...packet.data,
          phase: 'movement', // Ensure phase is set for turn system to work
        });
        useGameStore.getState().setClientState('running');
        break;

      case PacketType.PLAYER_INFO: {
        console.log('Player info received:', packet.data);
        const { players } = useGameStore.getState();
        const updatedPlayer = {
          id: packet.data.id,
          name: packet.data.name,
          nation: packet.data.nation,
          color: playerColorToHex(packet.data.color), // Convert RGB to hex
          gold: packet.data.gold,
          goldPerTurn: packet.data.goldPerTurn ?? 0,
          science: packet.data.science,
          sciencePerTurn: packet.data.sciencePerTurn ?? 0,
          history: players[packet.data.id]?.history ?? 0,
          culture: packet.data.culture,
          government: packet.data.government,
          isHuman: !packet.data.isAI,
          isActive: packet.data.alive,
        };

        useGameStore.getState().updateGameState({
          players: {
            ...players,
            [packet.data.id]: updatedPlayer,
          },
        });
        break;
      }

      case PacketType.NEW_YEAR:
        // Update game state with new year and turn information
        // @reference freeciv-web/javascript/packhand.js handle_new_year()
        useGameStore.getState().updateGameState({
          turn: packet.data.turn,
          year: packet.data.year,
          // TODO: Add calendar fragments support in Phase 2
        });
        console.log('Game state updated with new year:', {
          turn: packet.data.turn,
          year: packet.data.year,
          fragments: packet.data.fragments,
        });
        break;

      case PacketType.TURN_START:
      case PacketType.BEGIN_TURN:
        console.log('Turn started:', packet.data);
        useGameStore.getState().updateGameState({
          turn: packet.data.turn,
          phase: 'movement', // Reset phase to movement for new turn
          // Year should already be set by NEW_YEAR packet
        });
        // Clear turn processing UI when new turn starts
        useGameStore.getState().setTurnProcessingState('idle');
        useGameStore.getState().updateTurnProcessingSteps([]);
        break;

      case PacketType.END_TURN:
        // Server has finished processing the turn
        // The THAW_CLIENT packet will handle clearing the UI
        break;

      case PacketType.ENDGAME_REPORT:
        useGameStore.getState().updateGameState({ endGameReport: packet.data });
        useGameStore.getState().setClientState('over');
        useGameStore.getState().completeTurnProcessing();
        playEndGameSound();
        break;

      case PacketType.UNIT_INFO:
        console.log('Unit info:', packet.data);
        if (packet.data.units && Array.isArray(packet.data.units)) {
          const { units } = useGameStore.getState();
          const updatedUnits = packet.data.fullSnapshot ? {} : { ...units };

          for (const unitData of packet.data.units) {
            const existingUnit = units[unitData.id];
            const newUnit = {
              id: unitData.id,
              playerId: unitData.owner, // Server sends 'owner' not 'playerId'
              unitTypeId: unitData.type,
              x: unitData.x,
              y: unitData.y,
              hp: unitData.hp,
              movesLeft: unitData.movesleft, // Server sends 'movesleft' not 'movesLeft'
              maxMoves: unitData.maxmoves,
              veteranLevel: unitData.veteran, // Server sends 'veteran' not 'veteranLevel'
              fortified: unitData.fortified,
              activity: unitData.activity,
              orders: unitData.orders,
              transportedBy: unitData.transportedBy,
              cargoUnits: unitData.cargoUnits,
              capabilities: unitData.capabilities,
            };

            // Check if unit position changed and clear cached paths if so
            if (existingUnit && (existingUnit.x !== unitData.x || existingUnit.y !== unitData.y)) {
              pathfindingService.clearUnitPaths(unitData.id);
            }

            updatedUnits[unitData.id] = newUnit;
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
          const availableTechs = packet.data.availableTechs as Array<{
            id: string;
            name: string;
            cost: number;
            requirements: string[];
            description?: string;
          }>;
          const { technologies } = useGameStore.getState();
          useGameStore.getState().updateGameState({
            technologies: {
              ...technologies,
              ...Object.fromEntries(
                availableTechs.map(tech => [
                  tech.id,
                  {
                    ...tech,
                    discovered: false,
                  },
                ])
              ),
            },
          });
          useGameStore.getState().updateResearchState({
            availableTechs: new Set(availableTechs.map(tech => tech.id)),
          });
        } else if (!packet.data.success) {
          console.error('Research setting failed:', packet.data.message);
        }
        break;

      case PacketType.RESEARCH_LIST_REPLY: {
        const availableTechs = Array.isArray(packet.data.availableTechs)
          ? packet.data.availableTechs
          : [];
        const researchedTechIds = Array.isArray(packet.data.researchedTechs)
          ? packet.data.researchedTechs
          : [];
        const { technologies } = useGameStore.getState();
        useGameStore.getState().updateGameState({
          technologies: {
            ...technologies,
            ...Object.fromEntries(
              availableTechs.map(
                (tech: {
                  id: string;
                  name: string;
                  cost: number;
                  requirements: string[];
                  description?: string;
                }) => [
                  tech.id,
                  {
                    ...tech,
                    discovered: false,
                  },
                ]
              )
            ),
          },
        });
        useGameStore.getState().updateResearchState({
          researchedTechs: new Set(researchedTechIds),
          availableTechs: new Set(availableTechs.map((tech: { id: string }) => tech.id)),
        });
        break;
      }

      case PacketType.RESEARCH_PROGRESS_REPLY:
        useGameStore.getState().updateResearchState({
          currentTech: packet.data.currentTech,
          techGoal: packet.data.techGoal,
          bulbsAccumulated: packet.data.current ?? 0,
          bulbsLastTurn: packet.data.bulbsLastTurn ?? 0,
        });
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
      case PacketType.SERVER_MESSAGE:
        console.log('Connection message:', packet.data);
        if (packet.data.type === 'error') {
          console.error('Server error:', packet.data.message);
          useGameStore.getState().addNotification({ message: packet.data.message, tone: 'error' });
        }
        break;

      case PacketType.CHAT_MSG:
        console.log('Chat message:', packet.data);
        useGameStore.getState().addNotification({
          message: packet.data.message,
          tone: packet.data.type === 'error' ? 'error' : 'info',
        });
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
        break;

      case PacketType.PROCESSING_FINISHED:
        break;

      case PacketType.TURN_END_REPLY:
        if (!packet.data.success) {
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

      case PacketType.FREEZE_CLIENT:
        // Set processing state to disable the turn button
        useGameStore.getState().setTurnProcessingState('processing');
        break;

      case PacketType.THAW_CLIENT:
        // Reset the turn processing state to re-enable the turn button
        useGameStore.getState().setTurnProcessingState('idle');
        useGameStore.getState().updateTurnProcessingSteps([]);
        break;

      // Border system packets
      // @reference freeciv-web border synchronization similar to tile updates
      case PacketType.BORDER_UPDATE:
        this.handleBorderUpdate(packet.data);
        break;

      case PacketType.BORDER_SOURCE_UPDATE:
        this.handleBorderSourceUpdate(packet.data);
        break;

      case PacketType.BORDER_CHANGE_NOTIFICATION:
        this.handleBorderChangeNotification(packet.data);
        break;

      case PacketType.DIPLOMACY_LIST_REPLY:
      case PacketType.DIPLOMACY_UPDATE:
        if (packet.data.success && packet.data.playerId && packet.data.nations) {
          useGameStore.getState().updateGameState({
            diplomacy: {
              playerId: packet.data.playerId,
              nations: packet.data.nations,
            } as DiplomacyState,
          });
        } else if (packet.data.message) {
          useGameStore.getState().addNotification({
            message: packet.data.message,
            tone: 'error',
          });
        }
        break;

      default:
        console.log(`Unhandled packet type: ${packetName} (${packet.type})`);
    }
  }

  private applyCultureUpdate(data: {
    players?: Record<string, { history: number; totalCulture: number }>;
  }): void {
    const state = useGameStore.getState();
    if (!data.players) return;

    const players = { ...state.players };
    for (const [playerId, culture] of Object.entries(data.players)) {
      const player = players[playerId];
      if (player) {
        players[playerId] = {
          ...player,
          history: culture.history,
          culture: culture.totalCulture,
        };
      }
    }
    state.updateGameState({ players });
  }

  private handleMapInfo(data: any) {
    console.log('Received MAP_INFO packet:', {
      xsize: data.xsize,
      ysize: data.ysize,
      totalTiles: data.xsize * data.ysize,
    });

    useGameStore.getState().updateGameState({
      map: this.mapSnapshots.begin(data),
    });
  }

  private handleTileInfo(data: any) {
    console.log('Received single TILE_INFO packet:', {
      tile: data.tile,
      x: data.x,
      y: data.y,
      terrain: data.terrain,
      elevation: data.elevation,
    });

    if (data.tile !== undefined) {
      const currentMap = useGameStore.getState().map;
      const map = this.mapSnapshots.applyTile(currentMap, data);

      useGameStore.getState().updateGameState({
        map,
      });

      if (Object.keys(map.tiles).length === 1) {
        useGameStore.getState().setViewport({
          x: 0,
          y: 0,
        });
      }
    }
  }

  private handleTileInfoBatch(data: any) {
    console.log('Received TILE_INFO batch:', {
      batchSize: data.tiles?.length || 0,
      startIndex: data.startIndex,
      endIndex: data.endIndex,
      total: data.total,
      firstTile: data.tiles?.[0]
        ? {
            tile: data.tiles[0].tile,
            x: data.tiles[0].x,
            y: data.tiles[0].y,
            terrain: data.tiles[0].terrain,
            elevation: data.tiles[0].elevation,
          }
        : 'none',
    });

    if (!data.tiles) return;

    const currentMap = useGameStore.getState().map;
    const map = this.mapSnapshots.applyBatch(currentMap, data);
    if (!map) return;
    useGameStore.getState().updateGameState({
      map,
    });
  }

  /**
   * Move unit method for keyboard controls
   */
  async moveUnit(unitId: string, toX: number, toY: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'));
        return;
      }

      const packet: Packet = {
        type: PacketType.UNIT_MOVE,
        data: {
          unitId,
          x: toX,
          y: toY,
        },
        timestamp: Date.now(),
      };

      // Set up response handler
      const responseHandler = (replyPacket: any) => {
        if (replyPacket.type === PacketType.UNIT_MOVE_REPLY && replyPacket.data.unitId === unitId) {
          this.socket?.off('packet', responseHandler);
          if (replyPacket.data.success) {
            resolve(true);
          } else {
            reject(new Error(replyPacket.data.message || 'Failed to move unit'));
          }
        }
      };

      this.socket.on('packet', responseHandler);

      // Set timeout
      setTimeout(() => {
        this.socket?.off('packet', responseHandler);
        reject(new Error('Move request timed out'));
      }, 5000);

      this.socket.emit('packet', packet);
    });
  }

  /**
   * Execute a unit action via socket event
   */
  async executeUnitAction(
    unitId: string,
    actionType: string,
    targetX?: number,
    targetY?: number
  ): Promise<ActionResult> {
    console.log('GameClient.executeUnitAction called:', { unitId, actionType, targetX, targetY });

    return new Promise((resolve, reject) => {
      if (!this.socket) {
        console.error('GameClient.executeUnitAction: Socket not connected');
        reject(new Error('Socket not connected'));
        return;
      }

      this.socket.emit(
        'unit_action',
        {
          unitId,
          actionType,
          targetX,
          targetY,
        },
        (response: any) => {
          console.log('GameClient.executeUnitAction response:', response);
          if (response.success) {
            resolve(response.result ?? { success: true });
          } else {
            reject(new Error(response.error || 'Action failed'));
          }
        }
      );
    });
  }

  foundCity(name: string, x: number, y: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'));
        return;
      }

      const packet: Packet = {
        type: PacketType.CITY_FOUND,
        data: {
          name,
          x,
          y,
        },
        timestamp: Date.now(),
      };

      // Set up a one-time listener for the reply
      const responseHandler = (replyPacket: any) => {
        if (replyPacket.type === PacketType.CITY_FOUND_REPLY) {
          this.socket?.off('packet', responseHandler);
          if (replyPacket.data.success) {
            resolve(replyPacket.data.cityId || 'unknown');
          } else {
            reject(new Error(replyPacket.data.message || 'Failed to found city'));
          }
        }
      };

      this.socket.on('packet', responseHandler);

      // Set a timeout to prevent hanging
      setTimeout(() => {
        this.socket?.off('packet', responseHandler);
        reject(new Error('City founding request timed out'));
      }, 10000); // 10 second timeout

      this.socket.emit('packet', packet);
    });
  }

  async setResearch(techId: string): Promise<void> {
    await this.requestPacket(
      PacketType.RESEARCH_SET,
      PacketType.RESEARCH_SET_REPLY,
      { techId },
      data => Boolean(data.success),
      'Failed to set research'
    );
    useGameStore.getState().setCurrentResearch(techId);
  }

  async setResearchGoal(techId: string): Promise<void> {
    await this.requestPacket(
      PacketType.RESEARCH_GOAL_SET,
      PacketType.RESEARCH_GOAL_SET_REPLY,
      { techId },
      data => Boolean(data.success),
      'Failed to set research goal'
    );
    useGameStore.getState().setResearchGoal(techId);
  }

  refreshResearch(): void {
    this.emitPacket(PacketType.RESEARCH_LIST, {});
    this.emitPacket(PacketType.RESEARCH_PROGRESS, {});
  }

  private emitPacket(type: PacketType, data: unknown, requestId?: string): void {
    if (!this.socket) return;
    this.socket.emit('packet', {
      type,
      version: PROTOCOL_VERSION,
      requestId,
      data,
      timestamp: Date.now(),
    } satisfies Packet);
  }

  private requestPacket(
    requestType: PacketType,
    replyType: PacketType,
    data: unknown,
    isSuccess: (data: Record<string, unknown>) => boolean,
    fallbackError: string,
    matchesReply: (data: Record<string, unknown>) => boolean = () => true
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'));
        return;
      }

      const requestId = crypto.randomUUID();
      const timeoutId = window.setTimeout(() => {
        this.socket?.off('packet', responseHandler);
        reject(new Error(`${fallbackError}: request timed out`));
      }, 5000);
      const responseHandler = (reply: Packet<Record<string, unknown>>) => {
        if (reply.type !== replyType) return;
        if (reply.version !== undefined && reply.version !== PROTOCOL_VERSION) return;
        if (reply.requestId !== requestId) return;
        if (!matchesReply(reply.data)) return;
        window.clearTimeout(timeoutId);
        this.socket?.off('packet', responseHandler);
        if (isSuccess(reply.data)) {
          resolve(reply.data);
        } else {
          reject(new Error((reply.data.message as string | undefined) || fallbackError));
        }
      };

      this.socket.on('packet', responseHandler);
      this.emitPacket(requestType, data, requestId);
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

  async getTileVisibility(
    x: number,
    y: number
  ): Promise<{ x: number; y: number; isVisible: boolean; isExplored: boolean; lastSeen?: number }> {
    const data = await this.requestPacket(
      PacketType.TILE_VISIBILITY_REQ,
      PacketType.TILE_VISIBILITY_REPLY,
      { x, y },
      reply => reply.success !== false,
      'Failed to get tile visibility',
      reply => reply.x === x && reply.y === y
    );
    return data as {
      x: number;
      y: number;
      isVisible: boolean;
      isExplored: boolean;
      lastSeen?: number;
    };
  }

  async setDebugVisibility(enabled: boolean): Promise<boolean> {
    const data = await this.requestPacket(
      PacketType.DEBUG_VISIBILITY_SET,
      PacketType.DEBUG_VISIBILITY_REPLY,
      { enabled },
      reply => Boolean(reply.success),
      'Failed to update debug visibility',
      reply => reply.enabled === enabled || reply.success === false
    );
    return data.enabled === true;
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
          clearTimeout(timeout);
          if (replyPacket.data.accepted) {
            console.log('Authentication successful:', replyPacket.data);
            // Keep the identity used to create/join a game so an active game
            // can be continued after a browser reload or route change.
            storeUsername(playerName);
            resolve();
          } else {
            console.error('Authentication failed:', replyPacket.data);
            reject(new Error(replyPacket.data.message || 'Authentication failed'));
          }
        }
      };

      this.socket.on('packet', handleReply);

      const timeout = setTimeout(() => {
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
    selectedNation: string;
    terrainSettings?: {
      generator: string;
      landmass: string;
      huts: number;
      temperature: number;
      wetness: number;
      rivers: number;
      resources: string;
      topologyId?: number;
      wrapId?: number;
      scenarioId?: string;
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
          selectedNation: gameData.selectedNation,
          victoryConditions: ['conquest'],
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
          clearTimeout(timeout);
          if (replyPacket.data.success) {
            this.currentGameId = replyPacket.data.gameId;
            this.applyJoinedPlayer(replyPacket.data, gameData.playerName, gameData.selectedNation);
            const operation = this.session.begin({
              role: 'player',
              gameId: replyPacket.data.gameId,
              playerName: gameData.playerName,
              selectedNation: gameData.selectedNation,
            });
            this.session.ready(operation);
            resolve(replyPacket.data.gameId);
          } else {
            reject(new Error(replyPacket.data.message || 'Failed to create game'));
          }
        }
      };

      this.socket.on('packet', handleReply);

      const timeout = setTimeout(() => {
        this.socket?.off('packet', handleReply);
        reject(new Error('Game creation timeout'));
      }, 10000);
    });
  }

  joinGame(playerName: string): void {
    if (!this.socket) return;

    this.socket.emit('join_game', { playerName });
  }

  joinSpecificGame(
    gameId: string,
    playerName: string,
    selectedNation: string = 'random'
  ): Promise<void> {
    const pendingJoin = this.pendingGameJoins.get(gameId);
    if (pendingJoin) return pendingJoin;

    const trackedJoin = this.joinSpecificGameOnce(gameId, playerName, selectedNation).finally(
      () => {
        this.pendingGameJoins.delete(gameId);
      }
    );
    this.pendingGameJoins.set(gameId, trackedJoin);
    return trackedJoin;
  }

  private async joinSpecificGameOnce(
    gameId: string,
    playerName: string,
    selectedNation: string
  ): Promise<void> {
    const operation = this.session.begin({
      role: 'player',
      gameId,
      playerName,
      selectedNation,
    });

    try {
      await this.authenticatePlayer(playerName);
      if (!this.session.transition(operation, 'joining')) return;

      await new Promise<void>((resolve, reject) => {
        if (!this.socket) {
          reject(new Error('Not connected to server'));
          return;
        }

        this.session.transition(operation, 'syncing');
        this.socket.emit('join_game', { gameId, playerName, selectedNation }, (response: any) => {
          if (!this.session.isCurrent(operation)) {
            resolve();
            return;
          }
          if (response.success) {
            this.currentGameId = gameId;
            this.applyJoinedPlayer(response, playerName, selectedNation);
            this.session.ready(operation);
            resolve();
          } else {
            reject(new Error(response.error || 'Failed to join game'));
          }
        });
      });
    } catch (error) {
      this.session.fail(operation, error);
      throw error;
    }
  }

  private async observeGameOnce(gameId: string): Promise<void> {
    const operation = this.session.begin({ role: 'observer', gameId });

    try {
      await new Promise<void>((resolve, reject) => {
        if (!this.socket) {
          reject(new Error('Not connected to server'));
          return;
        }

        this.session.transition(operation, 'syncing');
        this.socket.emit('observe_game', { gameId }, (response: any) => {
          if (!this.session.isCurrent(operation)) {
            resolve();
            return;
          }
          if (response.success) {
            this.currentGameId = gameId;
            this.session.ready(operation);
            resolve();
          } else {
            reject(new Error(response.error || 'Failed to observe game'));
          }
        });
      });
    } catch (error) {
      this.session.fail(operation, error);
      throw error;
    }
  }

  private applyJoinedPlayer(response: any, playerName: string, selectedNation: string): void {
    if (!response.playerId) return;
    const existingPlayers = useGameStore.getState().players ?? {};
    const finalNation =
      response.assignedNation && response.assignedNation !== 'random'
        ? response.assignedNation
        : selectedNation !== 'random'
          ? selectedNation
          : 'american';
    useGameStore.getState().updateGameState({
      currentPlayerId: response.playerId,
      players: {
        ...existingPlayers,
        [response.playerId]: {
          id: response.playerId,
          name: playerName,
          nation: finalNation,
          color: response.assignedColor ? playerColorToHex(response.assignedColor) : '#808080',
          gold: 50,
          science: 0,
          history: 0,
          government: 'despotism',
          isHuman: true,
          isActive: true,
        },
      },
      governments: getMockGovernments(),
      phase: 'movement',
      turn: 1,
    });
  }

  async observeGame(gameId: string): Promise<void> {
    return this.observeGameOnce(gameId);
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

  requestDiplomacy(): void {
    this.sendPacket(PacketType.DIPLOMACY_LIST_REQ, {});
  }

  proposeTreaty(recipientId: string, clauses: Array<TreatyClauseType | TreatyClause>): void {
    this.sendPacket(PacketType.DIPLOMACY_TREATY_PROPOSE, {
      recipientId,
      clauses: clauses.map(clause => (typeof clause === 'string' ? { type: clause } : clause)),
      requestId: crypto.randomUUID(),
    });
  }

  respondToTreaty(otherPlayerId: string, proposalId: string, accept: boolean): void {
    this.sendPacket(PacketType.DIPLOMACY_TREATY_RESPONSE, {
      otherPlayerId,
      proposalId,
      accept,
    });
  }

  cancelTreaty(otherPlayerId: string, proposalId: string): void {
    this.sendPacket(PacketType.DIPLOMACY_TREATY_CANCEL, { otherPlayerId, proposalId });
  }

  declareWar(otherPlayerId: string): void {
    this.sendPacket(PacketType.DIPLOMACY_DECLARE_WAR, { otherPlayerId });
  }

  private sendPacket(type: PacketType, data: unknown): void {
    if (!this.socket) return;
    this.socket.emit('packet', {
      type,
      version: PROTOCOL_VERSION,
      data,
      timestamp: Date.now(),
    } satisfies Packet);
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
    this.session.cancel();
    this.mapSnapshots.cancel();
    this.pendingGameJoins.clear();
    this.currentGameId = null;
    const socket = this.socket;
    const transportSocket = this.transport.getSocket();
    this.transport.disconnect();
    if (socket && socket !== transportSocket) socket.disconnect();
    this.socket = null;
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  getCurrentGameId(): string | null {
    return this.currentGameId;
  }

  getSessionState() {
    return this.session.getState();
  }

  private resumeSession(): Promise<void> {
    if (this.reconnectPromise) return this.reconnectPromise;

    const target = this.session.getState().target;
    if (!target) {
      useGameStore.getState().setClientState('connecting');
      return Promise.resolve();
    }

    this.reconnectPromise = this.resumeTarget(target)
      .catch(error => {
        console.error('Failed to resume game session:', error);
        useGameStore.getState().setClientState('initial');
      })
      .finally(() => {
        this.reconnectPromise = null;
      });
    return this.reconnectPromise;
  }

  private async resumeTarget(target: GameSessionTarget): Promise<void> {
    if (target.role === 'player') {
      await this.joinSpecificGame(target.gameId, target.playerName, target.selectedNation);
    } else {
      await this.observeGameOnce(target.gameId);
    }
    useGameStore
      .getState()
      .setClientState(useGameStore.getState().endGameReport ? 'over' : 'running');
  }

  /**
   * Get the socket instance for external services (like PathfindingService)
   */
  getSocket(): Socket | null {
    return this.socket;
  }

  /**
   * Request unit action from server
   */
  async requestUnitAction(
    unitId: string,
    actionType: ActionType,
    targetX?: number,
    targetY?: number
  ): Promise<boolean> {
    try {
      await this.executeUnitAction(unitId, actionType, targetX, targetY);
      return true;
    } catch (error) {
      console.error(`Failed to execute ${actionType} for unit ${unitId}:`, error);
      return false;
    }
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
   * Found city with specific unit ID (includes unit for destruction)
   */
  foundCityWithUnit(unitId: string, name: string, x: number, y: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'));
        return;
      }

      const packet: Packet = {
        type: PacketType.CITY_FOUND,
        data: {
          unitId, // Include unit ID so server can remove the settler
          name,
          x,
          y,
        },
        timestamp: Date.now(),
      };

      // Set up a one-time listener for the reply
      const responseHandler = (replyPacket: any) => {
        if (replyPacket.type === PacketType.CITY_FOUND_REPLY) {
          this.socket?.off('packet', responseHandler);
          if (replyPacket.data.success) {
            resolve(replyPacket.data.cityId || 'unknown');
          } else {
            reject(new Error(replyPacket.data.message || 'Failed to found city'));
          }
        }
      };

      this.socket.on('packet', responseHandler);

      // Set a timeout to prevent hanging
      setTimeout(() => {
        this.socket?.off('packet', responseHandler);
        reject(new Error('City founding request timed out'));
      }, 10000); // 10 second timeout

      this.socket.emit('packet', packet);
    });
  }

  /**
   * Request unit found city action (legacy compatibility)
   */
  foundCityWithUnitLegacy(unitId: string): Promise<boolean> {
    return this.requestUnitAction(unitId, ActionType.FOUND_CITY);
  }

  /**
   * Handle border update packets - updates tile ownership
   * @reference freeciv-web tile info handling pattern
   */
  private handleBorderUpdate(data: any): void {
    console.log('Border update received:', data);

    if (!data.tiles || !Array.isArray(data.tiles)) {
      console.warn('Invalid border update data - no tiles array');
      return;
    }

    const gameState = useGameStore.getState();
    const { map } = gameState;

    if (!map || !map.tiles) {
      console.warn('No map data available for border update');
      return;
    }

    // Update tile ownership data
    const updatedTiles =
      data.updateType === 'full_update'
        ? Object.fromEntries(
            Object.entries(map.tiles).map(([key, tile]) => [key, { ...tile, owner: undefined }])
          )
        : { ...map.tiles };
    let updatedCount = 0;

    for (const tileUpdate of data.tiles) {
      const tileKey = `${tileUpdate.x},${tileUpdate.y}`;
      const existingTile = updatedTiles[tileKey];

      if (existingTile) {
        updatedTiles[tileKey] = {
          ...existingTile,
          owner: tileUpdate.owner || undefined,
        };
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      useGameStore.getState().updateGameState({
        map: {
          ...map,
          tiles: updatedTiles,
        },
      });
      console.log(`🎯 Updated ownership for ${updatedCount} tiles - Border system active!`);
    }
  }

  /**
   * Handle border source update packets - updates cities/forts that generate borders
   */
  private handleBorderSourceUpdate(data: any): void {
    console.log('Border source update received:', data);
    // Border sources are typically handled via city/fort updates
    // This would be used for more advanced border mechanics
  }

  /**
   * Handle border change notifications - territory gained/lost events
   */
  private handleBorderChangeNotification(data: any): void {
    console.log('Border change notification:', data);

    if (data.playerId && data.tilesGained?.length > 0) {
      console.log(`Player ${data.playerId} gained ${data.tilesGained.length} tiles`);
      useGameStore.getState().addNotification({
        message: `${data.tilesGained.length} territory tiles gained`,
        tone: 'success',
      });
    }

    if (data.playerId && data.tilesLost?.length > 0) {
      console.log(`Player ${data.playerId} lost ${data.tilesLost.length} tiles`);
      useGameStore.getState().addNotification({
        message: `${data.tilesLost.length} territory tiles lost`,
        tone: 'info',
      });
    }
  }

  /**
   * Get available production options for a city
   */
  async getAvailableProductions(cityId: string): Promise<ProductionOption[]> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to server'));
        return;
      }

      // Set up response handler
      const handleResponse = (data: { cityId: string; productions: ProductionOption[] }) => {
        if (data.cityId === cityId) {
          this.socket?.off('city:availableProductions', handleResponse);
          this.socket?.off('error', handleError);
          clearTimeout(timeout);
          resolve(data.productions);
        }
      };

      const handleError = (error: { message: string }) => {
        this.socket?.off('city:availableProductions', handleResponse);
        this.socket?.off('error', handleError);
        clearTimeout(timeout);
        reject(new Error(error.message));
      };

      this.socket.on('city:availableProductions', handleResponse);
      this.socket.on('error', handleError);

      // Set timeout
      const timeout = setTimeout(() => {
        this.socket?.off('city:availableProductions', handleResponse);
        this.socket?.off('error', handleError);
        reject(new Error('Get available productions timeout'));
      }, 10000);

      // Send request
      this.socket.emit('city:getAvailableProductions', { cityId });
    });
  }

  /**
   * Change city production
   */
  async changeProduction(
    cityId: string,
    productionId: string,
    productionType: 'unit' | 'building' | 'wonder'
  ): Promise<void> {
    const data = await this.requestPacket(
      PacketType.CITY_PRODUCTION_CHANGE,
      PacketType.CITY_PRODUCTION_CHANGE_REPLY,
      { cityId, production: productionId, type: productionType },
      reply => Boolean(reply.success),
      'Failed to change production',
      reply => reply.cityId === cityId
    );
    const { cities } = useGameStore.getState();
    if (cities[cityId] && data.production) {
      useGameStore.getState().updateGameState({
        cities: {
          ...cities,
          [cityId]: {
            ...cities[cityId],
            production: data.production as City['production'],
          },
        },
      });
    }
  }

  async configureCityGovernor(
    cityId: string,
    config: {
      enabled: boolean;
      priority: string;
      autoManageSpecialists: boolean;
      autoManageTiles: boolean;
      autoManageProduction: boolean;
      preventStarvation: boolean;
      maintainHappiness: boolean;
    }
  ): Promise<void> {
    const response = await this.requestSocketEvent<{
      success: boolean;
      governor?: import('../types').City['governor'];
      error?: string;
    }>('city:configureGovernor', { cityId, ...config });
    if (!response.success) throw new Error(response.error || 'Failed to configure governor');

    const { cities } = useGameStore.getState();
    const city = cities[cityId];
    if (city && response.governor) {
      useGameStore.getState().updateGameState({
        cities: {
          ...cities,
          [cityId]: { ...city, governor: response.governor },
        },
      });
    }
  }

  async optimizeCityCitizens(cityId: string): Promise<void> {
    const response = await this.requestSocketEvent<{ success: boolean; error?: string }>(
      'city:optimizeCitizens',
      { cityId }
    );
    if (!response.success) throw new Error(response.error || 'Failed to optimize citizens');
  }

  async buyCityProduction(cityId: string): Promise<{
    goldSpent: number;
    completed: boolean;
    remainingGold?: number;
  }> {
    const response = await this.requestSocketEvent<{
      success: boolean;
      result?: { goldSpent: number; completed: boolean; remainingGold?: number };
      error?: string;
    }>('city:buyProduction', { cityId });
    if (!response.success || !response.result) {
      throw new Error(response.error || 'Failed to buy production');
    }
    if (response.result.remainingGold !== undefined) {
      const store = useGameStore.getState();
      const player = store.players[store.currentPlayerId];
      if (player) {
        store.updateGameState({
          players: {
            ...store.players,
            [player.id]: { ...player, gold: response.result.remainingGold },
          },
        });
      }
    }
    return response.result;
  }

  async addCityWorklistItem(
    cityId: string,
    productionId: string,
    type: 'unit' | 'building' | 'wonder'
  ): Promise<void> {
    const response = await this.requestSocketEvent<{ success: boolean; error?: string }>(
      'city:addWorklist',
      { cityId, items: [{ productionId, type }] }
    );
    if (!response.success) throw new Error(response.error || 'Failed to add worklist item');
  }

  async removeCityWorklistItem(cityId: string, index: number): Promise<void> {
    const response = await this.requestSocketEvent<{ success: boolean; error?: string }>(
      'city:removeWorklist',
      { cityId, index }
    );
    if (!response.success) throw new Error(response.error || 'Failed to remove worklist item');
  }

  async reorderCityWorklist(cityId: string, fromIndex: number, toIndex: number): Promise<void> {
    const response = await this.requestSocketEvent<{ success: boolean; error?: string }>(
      'city:reorderWorklist',
      { cityId, fromIndex, toIndex }
    );
    if (!response.success) throw new Error(response.error || 'Failed to reorder worklist');
  }

  async assignCityCitizen(cityId: string, x: number, y: number): Promise<void> {
    const response = await this.requestSocketEvent<{ success: boolean; error?: string }>(
      'city:assignCitizen',
      { cityId, x, y }
    );
    if (!response.success) throw new Error(response.error || 'Failed to assign citizen');
  }

  async convertCityWorkerToSpecialist(
    cityId: string,
    x: number,
    y: number,
    specialistType: number
  ): Promise<void> {
    const response = await this.requestSocketEvent<{ success: boolean; error?: string }>(
      'city:workerToSpecialist',
      { cityId, x, y, specialistType }
    );
    if (!response.success) throw new Error(response.error || 'Failed to create specialist');
  }

  async convertCitySpecialistToTile(
    cityId: string,
    specialistType: number,
    x: number,
    y: number
  ): Promise<void> {
    const response = await this.requestSocketEvent<{ success: boolean; error?: string }>(
      'city:specialistToTile',
      { cityId, specialistType, x, y }
    );
    if (!response.success) throw new Error(response.error || 'Failed to assign specialist');
  }

  async changeCitySpecialist(cityId: string, fromType: number, toType: number): Promise<void> {
    const response = await this.requestSocketEvent<{ success: boolean; error?: string }>(
      'city:changeSpecialist',
      { cityId, fromType, toType }
    );
    if (!response.success) throw new Error(response.error || 'Failed to change specialist');
  }

  async renameCity(cityId: string, name: string): Promise<void> {
    const response = await this.requestSocketEvent<{ success: boolean; error?: string }>(
      'city:rename',
      { cityId, name }
    );
    if (!response.success) throw new Error(response.error || 'Failed to rename city');
  }

  async sellCityBuilding(
    cityId: string,
    buildingId: string
  ): Promise<{ goldReceived: number; remainingGold?: number }> {
    const response = await this.requestSocketEvent<{
      success: boolean;
      goldReceived?: number;
      remainingGold?: number;
      error?: string;
    }>('city:sellBuilding', { cityId, buildingId });
    if (!response.success) throw new Error(response.error || 'Failed to sell building');
    if (response.remainingGold !== undefined) {
      const store = useGameStore.getState();
      const player = store.players[store.currentPlayerId];
      if (player) {
        store.updateGameState({
          players: {
            ...store.players,
            [player.id]: { ...player, gold: response.remainingGold },
          },
        });
      }
    }
    return {
      goldReceived: response.goldReceived ?? 0,
      remainingGold: response.remainingGold,
    };
  }

  async disbandCity(cityId: string): Promise<void> {
    const response = await this.requestSocketEvent<{ success: boolean; error?: string }>(
      'city:disband',
      { cityId }
    );
    if (!response.success) throw new Error(response.error || 'Failed to disband city');
  }

  async getGovernmentState(): Promise<GovernmentState> {
    const response = await this.requestSocketEvent<{
      success: boolean;
      state?: GovernmentState;
      error?: string;
    }>('government:getState', {});
    if (!response.success || !response.state) {
      throw new Error(response.error || 'Failed to load government state');
    }
    this.applyGovernmentState(response.state);
    return response.state;
  }

  async startRevolution(governmentId: string): Promise<string> {
    const response = await this.requestSocketEvent<{
      success: boolean;
      state?: GovernmentState;
      message?: string;
      error?: string;
    }>('government:startRevolution', { governmentId });
    if (!response.success || !response.state) {
      throw new Error(response.error || 'Failed to start revolution');
    }
    this.applyGovernmentState(response.state);
    return response.message || 'Revolution started';
  }

  async getTaxRates(): Promise<{ tax: number; luxury: number; science: number }> {
    const response = await this.requestSocketEvent<{
      success: boolean;
      rates?: { tax: number; luxury: number; science: number };
      error?: string;
    }>('economy:getTaxRates', {});
    if (!response.success || !response.rates) {
      throw new Error(response.error || 'Failed to load tax rates');
    }
    return response.rates;
  }

  async setTaxRates(rates: {
    tax: number;
    luxury: number;
    science: number;
  }): Promise<{ tax: number; luxury: number; science: number }> {
    const response = await this.requestSocketEvent<{
      success: boolean;
      rates?: { tax: number; luxury: number; science: number };
      error?: string;
    }>('economy:setTaxRates', rates);
    if (!response.success || !response.rates) {
      throw new Error(response.error || 'Failed to update tax rates');
    }
    return response.rates;
  }

  async getHostControls(): Promise<{
    isHost: boolean;
    paused: boolean;
    turnTimeLimit: number;
  }> {
    const response = await this.requestSocketEvent<{
      success: boolean;
      isHost: boolean;
      paused: boolean;
      turnTimeLimit: number;
      error?: string;
    }>('host:getControls', {});
    if (!response.success) throw new Error(response.error || 'Failed to load host controls');
    return response;
  }

  async setGamePaused(paused: boolean): Promise<void> {
    const response = await this.requestSocketEvent<{ success: boolean; error?: string }>(
      'host:setPaused',
      { paused }
    );
    if (!response.success) throw new Error(response.error || 'Failed to update game state');
  }

  async setTurnTimeLimit(turnTimeLimit: number): Promise<void> {
    const response = await this.requestSocketEvent<{ success: boolean; error?: string }>(
      'host:setTurnTimeLimit',
      { turnTimeLimit }
    );
    if (!response.success) throw new Error(response.error || 'Failed to update turn timer');
  }

  private applyGovernmentState(state: GovernmentState): void {
    const store = useGameStore.getState();
    const player = store.players[store.currentPlayerId];
    useGameStore.getState().updateGameState({
      governments: state.governments,
      players: player
        ? {
            ...store.players,
            [player.id]: {
              ...player,
              government: state.currentGovernment || player.government,
              revolutionTurns: state.revolutionTurns,
            },
          }
        : store.players,
    });
  }

  private requestSocketEvent<T>(event: string, data: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'));
        return;
      }
      const timeoutId = window.setTimeout(
        () => reject(new Error(`${event} request timed out`)),
        5000
      );
      this.socket.emit(event, data, (response: T) => {
        window.clearTimeout(timeoutId);
        resolve(response);
      });
    });
  }
}

export const gameClient = new GameClient();
