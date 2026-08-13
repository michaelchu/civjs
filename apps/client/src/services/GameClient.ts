/**
 * @module client/services/GameClient
 * Provides the client-side Game Client service.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Socket } from 'socket.io-client';
import { SERVER_URL } from '../config';
import { useGameStore } from '../store/gameStore';
import {
  PacketType,
  PACKET_NAMES,
  PROTOCOL_VERSION,
  type Packet,
  type SpaceshipPlacement,
} from '../types/packets';
import { ActionType, type ActionResult } from '../types/shared/actions';
import { pathfindingService } from './PathfindingService';
import { playerColorToHex } from '../utils/playerColors';
import { getOrCreateUsername, storeUsername } from '../utils/gameSession';
import type {
  DiplomacyState,
  GovernmentState,
  ProductionOption,
  CityBatchAction,
  CityBatchResult,
  PresentationEffect,
  PresentationCombatant,
  TreatyClause,
  TreatyClauseType,
} from '../types';
import { playEndGameSound } from './UserPreferences';
import { GameSessionCoordinator, type GameSessionTarget } from './GameSessionCoordinator';
import { GameTransport } from './GameTransport';
import { MapSnapshotAssembler } from './MapSnapshotAssembler';
import { CityClientApi } from './CityClientApi';
import { getMockGovernments } from './GovernmentCatalog';
import { RuntimeControlClientApi, type AdvisorRecommendations } from './RuntimeControlClientApi';

export type { AdvisorRecommendations } from './RuntimeControlClientApi';
import { clientLogger } from '../utils/logger';

// Mock government data for development

export class GameClient {
  private socket: Socket | null = null;
  private currentGameId: string | null = null;
  private pendingGameJoins = new Map<string, Promise<void>>();
  private readonly session = new GameSessionCoordinator();
  private readonly transport: GameTransport;
  private readonly mapSnapshots = new MapSnapshotAssembler();
  private pendingMapSnapshot: ReturnType<MapSnapshotAssembler['begin']> | null = null;
  private readonly cityApi: CityClientApi;
  private readonly runtimeControls: RuntimeControlClientApi;
  private reconnectPromise: Promise<void> | null = null;

  constructor(transport = new GameTransport(SERVER_URL)) {
    this.transport = transport;
    this.cityApi = new CityClientApi(
      () => this.socket,
      (...args) => this.requestPacket(...args),
      <T>(event: string, data: unknown) => this.requestSocketEvent<T>(event, data)
    );
    this.runtimeControls = new RuntimeControlClientApi(<T>(event: string, data: unknown) =>
      this.requestSocketEvent<T>(event, data)
    );
    clientLogger.info('Connecting to server:', SERVER_URL);
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
          clientLogger.info('Connected to game server');
          useGameStore.getState().setClientState('connecting');
        },
        disconnected: () => {
          clientLogger.info('Disconnected from game server');
          this.session.disconnected();
          this.mapSnapshots.cancel();
          this.pendingMapSnapshot = null;
          useGameStore.getState().setClientState('initial');
        },
        connectionError: error => {
          console.error('Connection error:', error);
        },
        reconnected: attemptNumber => {
          clientLogger.info(`Reconnected to server after ${attemptNumber} attempts`);
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

    this.socket.on('game-started', data => {
      clientLogger.debug('Game started:', data);
      useGameStore.getState().setClientState('running');
      // Preserve the authoritative phase when the server provides it.
      useGameStore.getState().updateGameState({
        phase: data?.phase ?? 'movement',
      });
      this.refreshResearch();
    });

    // Handle unit movement updates
    this.socket.on('unit_moved', data => {
      clientLogger.debug('Unit moved:', data);
      const { units } = useGameStore.getState();
      if (units[data.unitId]) {
        useGameStore.getState().updateGameState({
          units: {
            ...units,
            [data.unitId]: {
              ...units[data.unitId],
              x: data.x,
              y: data.y,
              // The state packet and movement event both use Freeciv move fragments.
              movesLeft: data.movementLeft,
            },
          },
        });

        // Clear cached paths for this unit to prevent stale path visualization
        pathfindingService.clearUnitPaths(data.unitId);
      }
    });

    // Handle unit destruction (e.g., settler consumed by city founding)
    this.socket.on('unit_destroyed', data => {
      clientLogger.debug('Unit destroyed:', data);
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

    this.socket.on('combat_occurred', data => {
      if (typeof data?.x !== 'number' || typeof data?.y !== 'number') return;
      const combatants = this.normalizePresentationCombatants(data.combatants);
      this.addPresentationEffect({
        id: String(data.eventId ?? `combat:${data.x}:${data.y}:${Date.now()}`),
        type: 'combat',
        x: data.x,
        y: data.y,
        style: data.style === 'swords' ? 'swords' : 'explosion',
        combatants,
        correlationKey: this.getCombatCorrelationKey(combatants),
        origin: 'server',
      });
    });

    this.socket.on('nuclear_explosion', data => {
      if (typeof data?.x !== 'number' || typeof data?.y !== 'number') return;
      this.addPresentationEffect({
        id: String(data.eventId ?? `nuke:${data.x}:${data.y}:${Date.now()}`),
        type: 'nuclear',
        x: data.x,
        y: data.y,
        tiles: Array.isArray(data.tiles)
          ? data.tiles.filter(
              (tile: any) => typeof tile?.x === 'number' && typeof tile?.y === 'number'
            )
          : undefined,
      });
    });

    // Handle city founding
    this.socket.on('city_founded', data => {
      clientLogger.debug('City founded:', data);
      const { cities } = useGameStore.getState();
      const newCities = { ...cities };
      // Use the actual city data sent from the server
      const city = this.normalizeCityData(data.city);
      newCities[city.id] = city;
      useGameStore.getState().updateGameState({
        cities: newCities,
      });
    });

    // Handle bulk city data updates with calculated production rates
    this.socket.on('cities_updated', data => {
      clientLogger.debug('Cities updated with production data:', data);

      if (data.cities) {
        const nextCities = data.fullSnapshot === false ? { ...useGameStore.getState().cities } : {};
        for (const cityId of data.removedCityIds ?? []) delete nextCities[cityId];
        for (const [cityId, city] of Object.entries(data.cities)) {
          nextCities[cityId] = this.normalizeCityData(city);
        }
        useGameStore.getState().updateGameState({
          cities: nextCities,
        });
      }
    });

    this.socket.on('culture_updated', data => this.applyCultureUpdate(data));
    this.socket.on('player-control-changed', (data: { playerId: string; isAI: boolean }) => {
      const { players } = useGameStore.getState();
      const player = players[data.playerId];
      if (!player) return;
      useGameStore.getState().updateGameState({
        players: {
          ...players,
          [data.playerId]: { ...player, isHuman: !data.isAI },
        },
      });
    });
    this.socket.on('diplomacy_event', data => {
      if (typeof data?.message === 'string') {
        useGameStore.getState().addNotification({ message: data.message, tone: 'info' });
      }
      this.requestDiplomacy();
    });
    this.socket.on('hut_event', data => {
      if (typeof data?.message === 'string') {
        useGameStore.getState().addNotification({ message: data.message, tone: 'info' });
      }
    });

    // Handle production completion events
    this.socket.on('production:completed', data => {
      clientLogger.debug('Production completed:', data);
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
      clientLogger.debug(`📡 Received border packet: ${packetName} (${packet.type})`, packet.data);
    }

    switch (packet.type) {
      case PacketType.GAME_INFO:
        useGameStore.getState().updateGameState({
          ...packet.data,
          phase: packet.data.phase ?? useGameStore.getState().phase,
        });
        useGameStore.getState().setClientState('running');
        break;

      case PacketType.PLAYER_INFO: {
        clientLogger.debug('Player info received:', packet.data);
        const { players } = useGameStore.getState();
        const updatedPlayer = {
          id: packet.data.id,
          name: packet.data.name,
          nation: packet.data.nation,
          nationGraphic: packet.data.nationGraphic ?? players[packet.data.id]?.nationGraphic,
          color: playerColorToHex(packet.data.color), // Convert RGB to hex
          gold: packet.data.gold,
          goldPerTurn: packet.data.goldPerTurn ?? 0,
          science: packet.data.science,
          sciencePerTurn: packet.data.sciencePerTurn ?? 0,
          taxRate: packet.data.taxRate,
          luxuryRate: packet.data.luxuryRate,
          scienceRate: packet.data.scienceRate,
          score: packet.data.score,
          teamId: packet.data.teamId ?? packet.data.team,
          spaceshipState: packet.data.spaceshipState,
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
        // @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/packhand.js handle_new_year()
        useGameStore.getState().updateGameState({
          turn: packet.data.turn,
          year: packet.data.year,
          // TODO: Add calendar fragments support in Phase 2
        });
        clientLogger.debug('Game state updated with new year:', {
          turn: packet.data.turn,
          year: packet.data.year,
          fragments: packet.data.fragments,
        });
        break;

      case PacketType.TURN_START:
      case PacketType.BEGIN_TURN:
        clientLogger.debug('Turn started:', packet.data);
        useGameStore.getState().updateGameState({
          turn: packet.data.turn,
          phase: packet.data.phase ?? 'movement',
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
        clientLogger.debug('Unit info:', packet.data);
        if (packet.data.units && Array.isArray(packet.data.units)) {
          const { units } = useGameStore.getState();
          const updatedUnits = packet.data.fullSnapshot ? {} : { ...units };

          for (const unitData of packet.data.units) {
            const normalizedUnit = this.normalizeUnitData(unitData);
            const existingUnit = units[normalizedUnit.id];
            const newUnit = {
              id: normalizedUnit.id,
              playerId: normalizedUnit.owner,
              unitTypeId: normalizedUnit.type,
              x: normalizedUnit.x,
              y: normalizedUnit.y,
              hp: normalizedUnit.hp,
              maxHp: normalizedUnit.maxHp,
              attack: normalizedUnit.attack,
              defense: normalizedUnit.defense,
              firepower: normalizedUnit.firepower,
              movesLeft: normalizedUnit.movesleft,
              maxMoves: normalizedUnit.maxmoves,
              fuel: normalizedUnit.fuel,
              maxFuel: normalizedUnit.maxFuel,
              transportCapacity: normalizedUnit.transportCapacity,
              veteranLevel: normalizedUnit.veteran,
              homeCityId: normalizedUnit.homeCity ?? undefined,
              upkeep: {
                food: normalizedUnit.upkeep?.[0] ?? 0,
                shields: normalizedUnit.upkeep?.[1] ?? 0,
                gold: normalizedUnit.upkeep?.[2] ?? 0,
              },
              nationality: normalizedUnit.nationality,
              activityTarget: normalizedUnit.activityTarget,
              occupied: normalizedUnit.occupied,
              paradropped: normalizedUnit.paradropped,
              doneMoving: normalizedUnit.doneMoving,
              stay: normalizedUnit.stay,
              facing: normalizedUnit.facing,
              birthTurn: normalizedUnit.birthTurn,
              fortified: normalizedUnit.fortified,
              activity: normalizedUnit.activity,
              orders: normalizedUnit.orders,
              automation: normalizedUnit.automation,
              automationTask: normalizedUnit.automationTask,
              transportedBy: normalizedUnit.transportedBy,
              cargoUnits: normalizedUnit.cargoUnits,
              capabilities: normalizedUnit.capabilities,
              actionDecisionWant: normalizedUnit.actionDecisionWant,
            };

            // Check if unit position changed and clear cached paths if so
            if (
              existingUnit &&
              (existingUnit.x !== normalizedUnit.x || existingUnit.y !== normalizedUnit.y)
            ) {
              pathfindingService.clearUnitPaths(normalizedUnit.id);
            }

            updatedUnits[normalizedUnit.id] = newUnit;
          }

          useGameStore.setState({
            units: updatedUnits,
            hasReceivedUnitSnapshot:
              packet.data.fullSnapshot || useGameStore.getState().hasReceivedUnitSnapshot,
          });
        }
        break;

      case PacketType.UNIT_ATTACK_REPLY: {
        const combatResult = packet.data.combatResult;
        if (packet.data.success && combatResult) {
          const unit = useGameStore.getState().units[combatResult.defenderId];
          if (unit) {
            this.addPresentationEffect({
              id: `combat:${combatResult.attackerId}:${combatResult.defenderId}:${Date.now()}`,
              type: 'combat',
              x: unit.x,
              y: unit.y,
              style: 'explosion',
              correlationKey: `combat:${combatResult.attackerId}:${combatResult.defenderId}`,
              origin: 'reply',
            });
          }
        }
        break;
      }

      case PacketType.UNIT_MOVE_REPLY:
        clientLogger.debug('Unit move reply:', packet.data);
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
                  movesLeft: packet.data.movementLeft,
                },
              },
            });
          }
        } else {
          console.error('Unit move failed:', packet.data.message);
        }
        break;

      case PacketType.CITY_FOUND_REPLY:
        clientLogger.debug('City found reply:', packet.data);
        if (packet.data.success) {
          // City info will come via separate CITY_INFO packet
          console.log('City founded successfully:', packet.data.cityId);
        } else {
          console.error('City founding failed:', packet.data.message);
        }
        break;

      case PacketType.CITY_INFO: {
        clientLogger.debug('City info:', packet.data);
        const { cities } = useGameStore.getState();
        const city = this.normalizeCityData(packet.data);
        useGameStore.getState().updateGameState({
          cities: {
            ...cities,
            [city.id]: city,
          },
        });
        break;
      }

      case PacketType.RESEARCH_SET_REPLY:
        clientLogger.debug('Research set reply:', packet.data);
        if (packet.data.success && packet.data.availableTechs) {
          const availableTechs = packet.data.availableTechs as Array<{
            id: string;
            name: string;
            cost: number;
            requirements: string[];
            flags: string[];
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
        const technologyCatalogue = Array.isArray(packet.data.technologies)
          ? packet.data.technologies
          : [];
        const availableTechs = Array.isArray(packet.data.availableTechs)
          ? packet.data.availableTechs
          : [];
        const researchedTechIds = Array.isArray(packet.data.researchedTechs)
          ? packet.data.researchedTechs
          : [];
        useGameStore.getState().updateGameState({
          technologies: Object.fromEntries(
            technologyCatalogue.map(
              (tech: {
                id: string;
                name: string;
                cost: number;
                requirements: string[];
                flags: string[];
                description?: string;
              }) => [
                tech.id,
                {
                  ...tech,
                  discovered: researchedTechIds.includes(tech.id),
                },
              ]
            )
          ),
        });
        useGameStore.getState().updateResearchState({
          researchedTechs: new Set(researchedTechIds),
          availableTechs: new Set(availableTechs.map((tech: { id: string }) => tech.id)),
          futureTechs: packet.data.futureTechs ?? 0,
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
        clientLogger.debug('Server join reply:', packet.data);
        if (packet.data.accepted) {
          console.log('Successfully joined server as:', packet.data.playerId);
        } else {
          console.error('Server join failed:', packet.data.message);
        }
        break;

      case PacketType.CONNECT_MSG:
      case PacketType.SERVER_MESSAGE:
        clientLogger.debug('Connection message:', packet.data);
        if (packet.data.type === 'error') {
          console.error('Server error:', packet.data.message);
          useGameStore.getState().addNotification({ message: packet.data.message, tone: 'error' });
        }
        break;

      case PacketType.CHAT_MSG:
        clientLogger.debug('Chat message:', packet.data);
        useGameStore.getState().addChatMessage({
          sender: packet.data.sender ?? 'Unknown',
          message: packet.data.message ?? '',
          channel: packet.data.channel ?? 'all',
          recipient: packet.data.recipient,
          timestamp: packet.data.timestamp ?? Date.now(),
        });
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
          this.handleTurnProcessingFailure(packet.data.message || 'Failed to end turn');
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

  private normalizeUnitData(unitData: any): any {
    return {
      ...unitData,
      id: unitData.id,
      owner: unitData.owner ?? unitData.playerId,
      type: unitData.type ?? unitData.unitTypeId,
      movesleft: unitData.movesleft ?? unitData.movesLeft,
      maxmoves: unitData.maxmoves ?? unitData.maxMoves,
      veteran: unitData.veteran ?? unitData.veteranLevel,
      homeCity: unitData.homeCity ?? unitData.homecity ?? unitData.homeCityId,
      activityTarget: unitData.activityTarget ?? unitData.activity_target,
      doneMoving: unitData.doneMoving ?? unitData.done_moving,
      transportedBy: unitData.transportedBy ?? unitData.transported,
      cargoUnits: unitData.cargoUnits ?? unitData.cargo ?? [],
      birthTurn: unitData.birthTurn ?? unitData.birth_turn,
      maxFuel: unitData.maxFuel ?? unitData.max_fuel,
      transportCapacity: unitData.transportCapacity ?? unitData.transport_capacity,
      fortified: unitData.fortified ?? unitData.activity === 'fortified',
    };
  }

  private addPresentationEffect(effect: Omit<PresentationEffect, 'startedAt'>): void {
    const state = useGameStore.getState();
    const now = performance.now();
    const effects = state.presentationEffects ?? [];
    const exactDuplicateIndex = effects.findIndex(item => item.id === effect.id);
    const correlatedDuplicateIndex = effect.correlationKey
      ? effects.findIndex(
          item =>
            item.type === effect.type &&
            item.correlationKey === effect.correlationKey &&
            ((item.origin === 'server' && effect.origin === 'reply') ||
              (item.origin === 'reply' && effect.origin === 'server')) &&
            now - item.startedAt >= 0 &&
            now - item.startedAt < 500
        )
      : -1;
    const duplicateIndex =
      exactDuplicateIndex >= 0 ? exactDuplicateIndex : correlatedDuplicateIndex;
    if (duplicateIndex >= 0) {
      const existing = effects[duplicateIndex];
      const shouldMerge =
        correlatedDuplicateIndex >= 0 ||
        Boolean(effect.combatants?.length && !existing.combatants?.length);
      if (shouldMerge) {
        const serverEffect = effect.origin === 'server' ? effect : existing;
        const mergedEffects = [...effects];
        mergedEffects[duplicateIndex] = {
          ...existing,
          ...effect,
          id: serverEffect.id,
          startedAt: existing.startedAt,
          combatants: effect.combatants?.length ? effect.combatants : existing.combatants,
          origin: correlatedDuplicateIndex >= 0 ? 'correlated' : existing.origin,
        };
        state.updateGameState({ presentationEffects: mergedEffects });
      }
      return;
    }

    state.updateGameState({
      presentationEffects: [...effects, { ...effect, startedAt: now }].slice(-64),
    });
  }

  private getCombatCorrelationKey(
    combatants: PresentationCombatant[] | undefined
  ): string | undefined {
    const attacker = combatants?.find(combatant => combatant.role === 'attacker');
    const defender = combatants?.find(combatant => combatant.role === 'defender');
    return attacker && defender ? `combat:${attacker.id}:${defender.id}` : undefined;
  }

  private normalizePresentationCombatants(data: unknown): PresentationCombatant[] | undefined {
    if (!Array.isArray(data)) return undefined;

    const combatants = data.flatMap((value: any) => {
      if (
        !value ||
        typeof value.id !== 'string' ||
        (value.role !== 'attacker' && value.role !== 'defender') ||
        typeof value.playerId !== 'string' ||
        typeof value.unitTypeId !== 'string' ||
        typeof value.x !== 'number' ||
        typeof value.y !== 'number' ||
        typeof value.hpBefore !== 'number' ||
        typeof value.hpAfter !== 'number' ||
        typeof value.destroyed !== 'boolean'
      ) {
        return [];
      }
      return [
        {
          id: value.id,
          role: value.role,
          playerId: value.playerId,
          unitTypeId: value.unitTypeId,
          x: value.x,
          y: value.y,
          hpBefore: Math.max(0, value.hpBefore),
          hpAfter: Math.max(0, value.hpAfter),
          movesLeft: value.movesLeft,
          veteranLevel: value.veteranLevel,
          fortified: value.fortified,
          activity: value.activity,
          destroyed: value.destroyed,
        } satisfies PresentationCombatant,
      ];
    });
    return combatants.length > 0 ? combatants : undefined;
  }

  private normalizeCityData(cityData: any): any {
    const production =
      cityData.production ??
      (cityData.currentProduction
        ? {
            target: cityData.currentProduction,
            type: cityData.productionType ?? 'unit',
            progress: cityData.productionStock ?? 0,
            cost: cityData.productionCost ?? 0,
            turnsToComplete: cityData.turnsToComplete ?? 0,
            buyCost: cityData.buyCost ?? 0,
          }
        : undefined);

    return {
      ...cityData,
      size: cityData.size ?? cityData.population ?? 0,
      food: cityData.food ?? cityData.foodPerTurn ?? 0,
      shields: cityData.shields ?? cityData.productionPerTurn ?? 0,
      trade: cityData.trade ?? cityData.tradePerTurn ?? 0,
      history: cityData.history ?? cityData.culture ?? 0,
      foundedTurn: cityData.foundedTurn ?? cityData.founded,
      defenseStrength: cityData.defenseStrength,
      health: cityData.health ?? cityData.healthLevel,
      culturePerTurn: cityData.culturePerTurn ?? 0,
      presentUnits: cityData.presentUnits ?? cityData.units ?? [],
      supportedUnits: cityData.supportedUnits ?? [],
      workableTiles: cityData.workableTiles ?? cityData.workingTiles ?? [],
      production,
      worklist: cityData.worklist ?? [],
      tradeRoutes: cityData.tradeRoutes ?? [],
    };
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

    this.pendingMapSnapshot = this.mapSnapshots.begin(data);
    useGameStore.setState({
      hasReceivedUnitSnapshot: false,
      presentationEffects: [],
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
      const currentMap = this.pendingMapSnapshot ?? useGameStore.getState().map;
      const map = this.mapSnapshots.applyTile(currentMap, data);
      this.pendingMapSnapshot = null;

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

    const incremental = data.fullSnapshot === false;
    const currentMap = incremental
      ? useGameStore.getState().map
      : (this.pendingMapSnapshot ?? useGameStore.getState().map);
    const map = this.mapSnapshots.applyBatch(currentMap, data);
    if (!map) return;
    if (!incremental) this.pendingMapSnapshot = null;
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
    targetY?: number,
    declareWarIfNeeded = false,
    technologyId?: string,
    buildingId?: string
  ): Promise<ActionResult> {
    console.log('GameClient.executeUnitAction called:', {
      unitId,
      actionType,
      targetX,
      targetY,
      declareWarIfNeeded,
    });

    return new Promise((resolve, reject) => {
      if (!this.socket) {
        console.error('GameClient.executeUnitAction: Socket not connected');
        reject(new Error('Socket not connected'));
        return;
      }

      const actionPayload = {
        unitId,
        actionType,
        targetX,
        targetY,
        ...(declareWarIfNeeded ? { declareWarIfNeeded: true } : {}),
        ...(technologyId ? { technologyId } : {}),
        ...(buildingId ? { buildingId } : {}),
      };
      this.socket.emit('unit_action', actionPayload, (response: any) => {
        console.log('GameClient.executeUnitAction response:', response);
        if (response.success) {
          resolve(response.result ?? { success: true });
        } else {
          reject(new Error(response.error || 'Action failed'));
        }
      });
    });
  }

  async getUnitActionOptions(
    unitId: string,
    actionType: string,
    targetX: number,
    targetY: number
  ): Promise<{ id: string; label: string }[]> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'));
        return;
      }
      this.socket.emit(
        'unit_action_options',
        { unitId, actionType, targetX, targetY },
        (response: any) => {
          if (!response?.success) {
            reject(new Error(response?.error || 'Failed to load action options'));
            return;
          }
          const result = response.result;
          if (!result?.success) {
            reject(new Error(result?.message || 'No action options available'));
            return;
          }
          resolve(Array.isArray(result.options) ? result.options : []);
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

  /**
   * Requests one legal spaceship placement. Freeciv's stock client normally
   * submits these automatically as construction completes, but retaining the
   * request makes the authoritative protocol available to this client and to
   * alternative UI flows.
   */
  async placeSpaceshipPart(
    placement: SpaceshipPlacement
  ): Promise<Record<string, unknown> | undefined> {
    const data = await this.requestPacket(
      PacketType.SPACESHIP_PLACE,
      PacketType.SPACESHIP_PLACE_REPLY,
      { placement },
      reply => Boolean(reply.success),
      'Failed to place spaceship part'
    );
    const spaceshipState = data.spaceshipState;
    return spaceshipState && typeof spaceshipState === 'object' && !Array.isArray(spaceshipState)
      ? (spaceshipState as Record<string, unknown>)
      : undefined;
  }

  /** Requests an authoritative spaceship launch for the current player. */
  async launchSpaceship(): Promise<Record<string, unknown> | undefined> {
    const data = await this.requestPacket(
      PacketType.SPACESHIP_LAUNCH,
      PacketType.SPACESHIP_LAUNCH_REPLY,
      {},
      reply => Boolean(reply.success),
      'Failed to launch spaceship'
    );
    const spaceshipState = data.spaceshipState;
    return spaceshipState && typeof spaceshipState === 'object' && !Array.isArray(spaceshipState)
      ? (spaceshipState as Record<string, unknown>)
      : undefined;
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
    gameType?: 'single' | 'multiplayer';
    maxPlayers: number;
    mapSizingMode?: 'player' | 'fixed';
    nationSet?: string;
    selectedNation: string;
    aiLevel?: 'restricted' | 'novice' | 'easy' | 'normal' | 'hard' | 'cheating';
    barbarianRate?: number;
    researchPacing?: { scienceBox?: number; techPenalty?: number; techLeakPct?: number };
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
    const playerName = getOrCreateUsername();
    await this.authenticatePlayer(playerName);

    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to server'));
        return;
      }

      const createPacket: Packet = {
        type: PacketType.GAME_CREATE,
        data: {
          name: gameData.gameName,
          gameType: gameData.gameType || 'multiplayer',
          maxPlayers: gameData.maxPlayers,
          mapSizingMode: gameData.mapSizingMode || 'player',
          ruleset: 'civ2civ3',
          nationSet: gameData.nationSet,
          selectedNation: gameData.selectedNation,
          aiLevel: gameData.aiLevel,
          barbarianRate: gameData.barbarianRate,
          researchPacing: gameData.researchPacing,
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
            this.applyJoinedPlayer(replyPacket.data, gameData.selectedNation);
            const operation = this.session.begin({
              role: 'player',
              gameId: replyPacket.data.gameId,
              playerName,
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
            this.applyJoinedPlayer(response, selectedNation);
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
            // An observer is deliberately not attached to any player. Clear a
            // prior player identity when switching roles so map markers,
            // shields, selection, and owner-only controls use observer rules.
            useGameStore.getState().updateGameState({ currentPlayerId: '' });
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

  private applyJoinedPlayer(response: any, selectedNation: string): void {
    if (!response.playerId) return;
    const currentState = useGameStore.getState();
    const existingPlayers = currentState.players ?? {};
    const existingPlayer = existingPlayers[response.playerId];
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
          // The server selects the leader; the account username is never used here.
          name: response.leaderName ?? finalNation,
          nation: finalNation,
          color: response.assignedColor
            ? playerColorToHex(response.assignedColor)
            : (existingPlayer?.color ?? '#808080'),
          gold: existingPlayer?.gold ?? 50,
          goldPerTurn: existingPlayer?.goldPerTurn ?? 0,
          science: existingPlayer?.science ?? 0,
          sciencePerTurn: existingPlayer?.sciencePerTurn ?? 0,
          taxRate: existingPlayer?.taxRate ?? 40,
          luxuryRate: existingPlayer?.luxuryRate ?? 0,
          scienceRate: existingPlayer?.scienceRate ?? 60,
          score: existingPlayer?.score ?? 0,
          history: existingPlayer?.history ?? 0,
          culture: existingPlayer?.culture ?? 0,
          government: existingPlayer?.government ?? 'despotism',
          isHuman: true,
          isActive: existingPlayer?.isActive ?? true,
        },
      },
      governments: getMockGovernments(),
      phase: 'movement',
      // A reconnect snapshot may have already supplied the authoritative
      // turn. Keep it instead of reverting the HUD to the initial turn.
      turn: currentState.turn || 1,
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

  cancelDiplomaticPact(otherPlayerId: string): void {
    this.sendPacket(PacketType.DIPLOMACY_PACT_CANCEL, { otherPlayerId });
  }

  cancelSharedVision(otherPlayerId: string): void {
    this.sendPacket(PacketType.DIPLOMACY_VISION_CANCEL, { otherPlayerId });
  }

  sendChatMessage(
    message: string,
    channel: 'all' | 'team' | 'private' = 'all',
    recipient?: string
  ): void {
    const trimmed = message.trim();
    if (!trimmed) return;
    this.sendPacket(PacketType.CHAT_MSG_REQ, {
      message: trimmed.slice(0, 255),
      channel,
      ...(recipient ? { recipient } : {}),
    });
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

    if (data.error) {
      this.handleTurnProcessingFailure(data.label || 'Turn processing failed');
      return;
    }

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

  private handleTurnProcessingFailure(message: string): void {
    const gameStore = useGameStore.getState();
    gameStore.resetTurnProcessing();
    gameStore.addNotification({
      message: `Turn processing failed: ${message}`,
      tone: 'error',
    });
  }

  disconnect() {
    this.session.cancel();
    this.mapSnapshots.cancel();
    this.pendingMapSnapshot = null;
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
    return this.cityApi.getAvailableProductions(cityId);
  }

  async changeProduction(
    cityId: string,
    productionId: string,
    productionType: 'unit' | 'building' | 'wonder'
  ): Promise<void> {
    return this.cityApi.changeProduction(cityId, productionId, productionType);
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
    return this.cityApi.configureGovernor(cityId, config);
  }

  async setCityRallyPoint(
    cityId: string,
    rallyPoint: { x: number; y: number; persistent: boolean } | null
  ): Promise<void> {
    return this.cityApi.setRallyPoint(cityId, rallyPoint);
  }

  async optimizeCityCitizens(cityId: string): Promise<void> {
    return this.cityApi.optimizeCitizens(cityId);
  }

  async batchManageCities(cityIds: string[], action: CityBatchAction): Promise<CityBatchResult> {
    return this.cityApi.batchManage(cityIds, action);
  }

  async buyCityProduction(cityId: string): Promise<{
    goldSpent: number;
    completed: boolean;
    remainingGold?: number;
  }> {
    return this.cityApi.buyProduction(cityId);
  }

  async addCityWorklistItem(
    cityId: string,
    productionId: string,
    type: 'unit' | 'building' | 'wonder'
  ): Promise<void> {
    return this.cityApi.addWorklistItem(cityId, productionId, type);
  }

  async removeCityWorklistItem(cityId: string, index: number): Promise<void> {
    return this.cityApi.removeWorklistItem(cityId, index);
  }

  async reorderCityWorklist(cityId: string, fromIndex: number, toIndex: number): Promise<void> {
    return this.cityApi.reorderWorklist(cityId, fromIndex, toIndex);
  }

  async assignCityCitizen(cityId: string, x: number, y: number): Promise<void> {
    return this.cityApi.assignCitizen(cityId, x, y);
  }

  async convertCityWorkerToSpecialist(
    cityId: string,
    x: number,
    y: number,
    specialistType: number
  ): Promise<void> {
    return this.cityApi.workerToSpecialist(cityId, x, y, specialistType);
  }

  async convertCitySpecialistToTile(
    cityId: string,
    specialistType: number,
    x: number,
    y: number
  ): Promise<void> {
    return this.cityApi.specialistToTile(cityId, specialistType, x, y);
  }

  async changeCitySpecialist(cityId: string, fromType: number, toType: number): Promise<void> {
    return this.cityApi.changeSpecialist(cityId, fromType, toType);
  }

  async renameCity(cityId: string, name: string): Promise<void> {
    return this.cityApi.rename(cityId, name);
  }

  async sellCityBuilding(
    cityId: string,
    buildingId: string
  ): Promise<{ goldReceived: number; remainingGold?: number }> {
    return this.cityApi.sellBuilding(cityId, buildingId);
  }

  async disbandCity(cityId: string): Promise<void> {
    return this.cityApi.disband(cityId);
  }

  async getGovernmentState(): Promise<GovernmentState> {
    return this.runtimeControls.getGovernmentState();
  }

  async startRevolution(governmentId: string): Promise<string> {
    return this.runtimeControls.startRevolution(governmentId);
  }

  async getTaxRates(): Promise<{ tax: number; luxury: number; science: number }> {
    return this.runtimeControls.getTaxRates();
  }

  async setTaxRates(rates: {
    tax: number;
    luxury: number;
    science: number;
  }): Promise<{ tax: number; luxury: number; science: number }> {
    return this.runtimeControls.setTaxRates(rates);
  }

  async getHostControls(): Promise<{
    isHost: boolean;
    paused: boolean;
    turnTimeLimit: number;
  }> {
    return this.runtimeControls.getHostControls();
  }

  async setGamePaused(paused: boolean): Promise<void> {
    return this.runtimeControls.setGamePaused(paused);
  }

  async setTurnTimeLimit(turnTimeLimit: number): Promise<void> {
    return this.runtimeControls.setTurnTimeLimit(turnTimeLimit);
  }

  async setPlayerAIControl(
    playerId: string,
    isAI: boolean,
    options: { aiLevel?: string; controllerUserId?: string } = {}
  ): Promise<void> {
    return this.runtimeControls.setPlayerAIControl(playerId, isAI, options);
  }

  async getAdvisorRecommendations(): Promise<AdvisorRecommendations> {
    return this.runtimeControls.getAdvisorRecommendations();
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
