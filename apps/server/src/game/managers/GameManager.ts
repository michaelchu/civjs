/* eslint-disable complexity */
import { eq, sql } from 'drizzle-orm';
import { Server as SocketServer } from 'socket.io';
import { DatabaseProvider, productionDatabaseProvider } from '@database';
import { gameState } from '@database/redis';
import { games, players } from '@database/schema';
import { logger } from '@utils/logger';

// Extracted managers following refactoring patterns
import { GameBroadcastManager } from '@game/orchestrators/GameBroadcastManager';
import { GameLifecycleManager } from '@game/orchestrators/GameLifecycleManager';
import { GameStateManager } from '@game/orchestrators/GameStateManager';
import { PlayerConnectionManager } from '@game/orchestrators/PlayerConnectionManager';
import { UnitManagementService } from '@game/services/UnitManagementService';
import { CityManagementService } from '@game/services/CityManagementService';
import { ResearchManagementService } from '@game/services/ResearchManagementService';
import { VisibilityMapService } from '@game/services/VisibilityMapService';
import { GameInstanceRecoveryService } from '@game/services/GameInstanceRecoveryService';
import type { NuclearPresentationEvent } from '@app-types/presentation';

// Keep existing imports for delegation
import { CityManager, type CityState } from '@game/managers/CityManager';
import { MapManager } from '@game/managers/MapManager';
import { PathfindingManager } from '@game/managers/PathfindingManager';
import { ResearchManager } from '@game/managers/ResearchManager';
import { TurnManager } from '@game/managers/TurnManager';
import { UnitManager, type Unit } from '@game/managers/UnitManager';
import { VisibilityManager } from '@game/managers/VisibilityManager';
import { BorderManager } from '@game/managers/BorderManager';
import { GovernmentManager } from '@game/managers/GovernmentManager';
import {
  DiplomacyManager,
  toDiplomacyReplayEvent,
  type DiplomacySnapshot,
  type TreatyClause,
  type TreatyProposal,
} from '@game/managers/DiplomacyManager';
import { FreecivAIOrchestrator } from '@game/services/AIOrchestrator';
import {
  createAIProfile,
  isSettableAILevel,
  type AILevel,
  type AITraits,
  type SettableAILevel,
} from '@game/ai/AIProfile';
import { assertAIState, createAIState } from '@game/ai/AIStateStore';
import { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';
import { FreecivAdvisorService, type AdvisorRecommendations } from '@game/services/AdvisorService';
import { EndGameService, type EndGameTelemetry } from '@game/services/EndGameService';
import { GameReplayService, type GameReplay } from '@game/services/GameReplayService';
import {
  NativeSaveService,
  type LoadedNativeSave,
  type NativeSaveArchive,
} from '@game/services/NativeSaveService';
import { ActionType, type ActionResult } from '@app-types/shared/actions';
import type { SpaceshipState } from '@game/services/SpaceshipService';
import type { ScenarioSetup } from '@game/services/ScenarioSetup';
import { GoldSpendingType } from '@game/systems/Economic/types/EconomicTypes';
import {
  calculateDiplomatBribeCost,
  calculateDiplomatInciteCost,
} from '@game/services/DiplomatActionEconomics';
import { rulesetUnitsService, type UnitType } from '@game/services/RulesetUnitsService';
import type { FreecivRandom } from '@game/random/FreecivRandom';
import type { FreecivIdentityAllocator } from '@game/random/FreecivIdentityAllocator';
import type { ResearchPacingSettings } from '@game/services/ResearchPacing';
import { processHumanWorkerAutomation } from '@game/automation/WorkerAutomationService';

// Freeciv dai_incident_simple() converts action badness into MAX_AI_LOVE / 35
// victim penalties. CivJS stores love on the same -1000..1000 scale.
// @reference reference/freeciv/ai/default/daidiplomacy.c:2000-2225
const AI_INCIDENT_SEVERITY: Partial<Record<ActionType, number>> = {
  [ActionType.STEAL_TECH]: 143,
  [ActionType.SABOTAGE_CITY]: 143,
  [ActionType.SABOTAGE_CITY_PRODUCTION]: 143,
  [ActionType.POISON_WATER]: 143,
  [ActionType.INCITE_CITY]: 286,
  [ActionType.BRIBE_UNIT]: 143,
  [ActionType.SABOTAGE_UNIT]: 86,
};

export type GameState = 'waiting' | 'starting' | 'active' | 'paused' | 'ended';
export type TurnPhase = 'movement' | 'production' | 'research' | 'diplomacy';

export interface TerrainSettings {
  generator: string;
  landmass: string;
  huts: number;
  temperature: number;
  wetness: number;
  rivers: number;
  resources: string;
  startpos?: number; // MapStartpos enum value for island generator routing
  topologyId?: number;
  wrapId?: number;
  scenarioId?: string;
}

export interface GameConfig {
  name: string;
  hostId: string;
  gameType?: 'single' | 'multiplayer';
  maxPlayers?: number;
  mapWidth?: number;
  mapHeight?: number;
  /** Optional seed for a reproducible generated map and AI validation replay. */
  mapSeed?: string;
  ruleset?: string;
  turnTimeLimit?: number;
  maxTurns?: number;
  victoryConditions?: string[];
  terrainSettings?: TerrainSettings;
  /** Default difficulty assigned to AI players created for this game. */
  aiLevel?: SettableAILevel;
  /** Freeciv-compatible global research cost and target-switching settings. */
  researchPacing?: Partial<ResearchPacingSettings>;
  /** Freeciv-compatible seed for the authoritative gameplay random stream. */
  randomSeed?: number;
  /** Selects timer and recovery behavior for application-owned simulations. */
  executionMode?: 'headless' | 'server';
  scenarioSetup?: ScenarioSetup;
  /** Optional barbarian frequency override for presets such as Quick Start. */
  barbarianRate?: number;
  /** Optional global warming/nuclear-winter settings. */
  climate?: {
    enabled?: boolean;
    warmingThreshold?: number;
    coolingThreshold?: number;
  };
}

export interface GameInstance {
  id: string;
  config: GameConfig;
  state: GameState;
  currentTurn: number;
  turnPhase: TurnPhase;
  players: Map<string, PlayerState>;
  turnManager: TurnManager;
  mapManager: MapManager;
  unitManager: UnitManager;
  visibilityManager: VisibilityManager;
  cityManager: CityManager;
  researchManager: ResearchManager;
  random: FreecivRandom;
  identities: FreecivIdentityAllocator;
  pathfindingManager: PathfindingManager;
  borderManager: BorderManager;
  governmentManager?: GovernmentManager;
  lastActivity: Date;
  pauseReason?: 'host' | 'disconnect';
  turnDeadlineAt?: Date | null;
  pausedTimerSeconds?: number | null;
}

export interface PlayerState {
  id: string;
  userId: string | null; // Can be null for AI players
  /** AI players are processed by the server and never submit END_TURN packets. */
  isAI?: boolean;
  aiLevel?: AILevel;
  aiTraits?: AITraits;
  aiState?: Record<string, unknown>;
  playerNumber: number;
  civilization: string;
  nation?: string;
  leaderName?: string;
  color?: { r: number; g: number; b: number };
  isAlive?: boolean;
  gold?: number;
  science?: number;
  technologies?: string[];
  goldPerTurn?: number;
  sciencePerTurn?: number;
  government?: string;
  history?: number;
  unitsBuilt?: number;
  unitsKilled?: number;
  unitsLost?: number;
  teamId?: string;
  hasConceded?: boolean;
  spaceshipState?: SpaceshipState;
  isReady: boolean;
  hasEndedTurn: boolean;
  isConnected: boolean;
  lastSeen: Date;
}

/**
 * GameManager - Refactored to use extracted service components as facade
 * Now acts as a facade coordinating:
 * - GameStateManager: Database operations and persistence
 * - PlayerConnectionManager: Player join/leave operations
 * - GameLifecycleManager: Game creation, start, end
 * - GameBroadcastManager: Socket.IO broadcasting
 */
export class GameManager {
  private static instance: GameManager;
  private io: SocketServer;
  private databaseProvider: DatabaseProvider;
  private games = new Map<string, GameInstance>();
  private playerToGame = new Map<string, string>();
  private sharedVisionByGame = new Map<string, Map<string, Set<string>>>();
  private hostilePlayersByGame = new Map<string, Map<string, Set<string>>>();
  private alliedPlayersByGame = new Map<string, Map<string, Set<string>>>();
  private endTurnLocks = new Map<string, Promise<unknown>>();
  private treatyPlayerLocks = new Map<string, Promise<unknown>>();

  // Extracted service components
  private gameStateManager!: GameStateManager;
  private playerConnectionManager!: PlayerConnectionManager;
  private gameLifecycleManager!: GameLifecycleManager;
  private gameBroadcastManager!: GameBroadcastManager;
  private unitManagementService!: UnitManagementService;
  private cityManagementService!: CityManagementService;
  private researchManagementService!: ResearchManagementService;
  private visibilityMapService!: VisibilityMapService;
  private gameInstanceRecoveryService!: GameInstanceRecoveryService;
  private diplomacyManager!: DiplomacyManager;
  private hostilityPolicy!: DiplomacyHostilityPolicy;
  private aiOrchestrator!: FreecivAIOrchestrator;
  private advisorService!: FreecivAdvisorService;
  private endGameService!: EndGameService;
  private replayService!: GameReplayService;
  private nativeSaveService!: NativeSaveService;

  private constructor(io: SocketServer, databaseProvider?: DatabaseProvider) {
    this.io = io;
    this.databaseProvider = databaseProvider || productionDatabaseProvider;
    this.initializeServices();
  }

  public static getInstance(io: SocketServer, databaseProvider?: DatabaseProvider): GameManager {
    if (!GameManager.instance) {
      GameManager.instance = new GameManager(io, databaseProvider);
    }
    return GameManager.instance;
  }

  /**
   * Initialize extracted service components following dependency injection pattern
   */
  private initializeServices(): void {
    // Initialize extracted managers with proper dependencies
    this.gameStateManager = new GameStateManager(logger, this.databaseProvider);
    this.gameBroadcastManager = new GameBroadcastManager(this.io);
    this.endGameService = new EndGameService(this.databaseProvider, this.io);
    this.replayService = new GameReplayService(this.databaseProvider);
    this.nativeSaveService = new NativeSaveService(this.replayService);

    this.playerConnectionManager = new PlayerConnectionManager(
      this.databaseProvider,
      this.broadcastToGame.bind(this),
      this.startGame.bind(this)
    );

    this.gameLifecycleManager = new GameLifecycleManager(
      this.io,
      this.databaseProvider,
      this.games,
      this.broadcastToGame.bind(this),
      this.persistMapDataToDatabase.bind(this),
      this.createStartingUnits.bind(this),
      this.foundCity.bind(this),
      this.gameBroadcastManager.broadcastMapData.bind(this.gameBroadcastManager),
      this.gameBroadcastManager
    );

    this.unitManagementService = new UnitManagementService(this.games, this.gameBroadcastManager);

    this.cityManagementService = new CityManagementService(
      this.games,
      this.broadcastToGame.bind(this),
      this.gameBroadcastManager.broadcastVisibilityState.bind(this.gameBroadcastManager)
    );

    this.researchManagementService = new ResearchManagementService(
      this.games,
      this.broadcastToGame.bind(this)
    );

    this.visibilityMapService = new VisibilityMapService(this.games);
    this.diplomacyManager = new DiplomacyManager(
      this.databaseProvider,
      gameId => this.games.get(gameId)?.currentTurn ?? 0,
      (gameId, playerId) =>
        new Set(
          this.games
            .get(gameId)
            ?.cityManager.getCitiesByPlayer(playerId)
            .flatMap(city => city.buildings) ?? []
        )
    );
    this.diplomacyManager.setTransferExecutor((gameId, proposerId, recipientId, clauses) =>
      this.executeTreatyTransfers(gameId, proposerId, recipientId, clauses)
    );
    this.diplomacyManager.setEventSink(event => {
      this.gameBroadcastManager.broadcastToGame(event.gameId, 'diplomacy_event', event);
      const game = this.games.get(event.gameId);
      if (game) {
        game.turnManager.recordDiplomacyEvent(toDiplomacyReplayEvent(event));
        this.aiOrchestrator.onDiplomacyEvent(event.gameId, game, event);
      }
    });
    this.hostilityPolicy = new DiplomacyHostilityPolicy(this.diplomacyManager);
    this.advisorService = new FreecivAdvisorService(this.hostilityPolicy);
    this.aiOrchestrator = new FreecivAIOrchestrator(
      this.diplomacyManager,
      this.hostilityPolicy,
      this.databaseProvider
    );

    this.gameInstanceRecoveryService = new GameInstanceRecoveryService(
      this.databaseProvider,
      this.games,
      this.playerToGame,
      this.io,
      this.foundCity.bind(this),
      this.requestPath.bind(this),
      this.broadcastToGame.bind(this),
      this.gameBroadcastManager
    );

    // Set cross-references
    this.gameBroadcastManager.setGamesReference(this.games);

    logger.info('GameManager services initialized successfully');
  }

  /**
   * Helper methods for extracted services
   */
  private async persistMapDataToDatabase(
    gameId: string,
    mapData: any,
    terrainSettings?: TerrainSettings
  ): Promise<void> {
    return this.gameStateManager.persistMapData(gameId, mapData, terrainSettings);
  }

  // requestPathForLifecycle removed - GameLifecycleManager now delegates to main requestPath method

  /**
   * Get games map reference for sharing with extracted services
   */
  public getGamesMap(): Map<string, GameInstance> {
    return this.games;
  }

  /**
   * Get playerToGame map reference (for testing)
   */
  public getPlayerToGameMap(): Map<string, string> {
    return this.playerToGame;
  }

  /**
   * Clear all games and player mappings (for testing)
   */
  public clearAllGames(): void {
    for (const gameInstance of this.games.values()) {
      gameInstance.turnManager?.clearTurnTimer?.();
    }
    this.games.clear();
    this.playerToGame.clear();
    this.sharedVisionByGame.clear();
    this.hostilePlayersByGame.clear();
    this.alliedPlayersByGame.clear();
    this.endTurnLocks.clear();
    this.treatyPlayerLocks.clear();
  }

  /**
   * Set game instance (for lifecycle manager)
   */
  public setGameInstance(gameId: string, gameInstance: GameInstance): void {
    this.games.set(gameId, gameInstance);
    // Sync player mappings
    for (const [playerId] of gameInstance.players) {
      this.playerToGame.set(playerId, gameId);
      this.playerConnectionManager.setPlayerToGame(playerId, gameId);
    }
  }

  /**
   * Create a new game - delegates to GameLifecycleManager
   */
  public async createGame(gameConfig: GameConfig): Promise<string> {
    return this.gameLifecycleManager.createGame(gameConfig);
  }

  /**
   * Join a game - delegates to PlayerConnectionManager
   */
  public async joinGame(
    gameId: string,
    userId: string,
    civilization?: string
  ): Promise<{
    playerId: string;
    assignedNation: string;
    assignedColor: import('../../utils/playerColors').PlayerColor;
    leaderName?: string;
  }> {
    const result = await this.playerConnectionManager.joinGame(gameId, userId, civilization);
    // Sync player-to-game mapping
    this.playerToGame.set(result.playerId, gameId);
    return result;
  }

  /**
   * Start a game - delegates to GameLifecycleManager
   */
  public async startGame(gameId: string, hostId: string): Promise<void> {
    await this.gameLifecycleManager.startGame(gameId, hostId);
    await this.configureMultiplayerInstance(gameId);
  }

  /**
   * Start an AI-only game without installing the normal wall-clock turn timer.
   * Headless execution still uses the same lifecycle initialization and turn
   * processing callbacks as a browser-backed game.
   */
  public async startHeadlessGame(gameId: string, hostId: string): Promise<void> {
    await this.gameLifecycleManager.startGame(gameId, hostId);
    await this.configureMultiplayerInstance(gameId, { startTurnTimer: false });
  }

  /** Add native AI players for an application-owned simulation setup. */
  public async ensureMinimumPlayers(gameId: string, minimumPlayers?: number): Promise<void> {
    await this.playerConnectionManager.ensureMinimumPlayers(gameId, minimumPlayers);
  }

  // Moved to GameBroadcastManager - this method is no longer used
  /*
  private broadcastMapData(gameId: string, mapData: any): void {
    const mapDataPacket = {
      gameId,
      width: mapData.width,
      height: mapData.height,
      startingPositions: mapData.startingPositions,
      seed: mapData.seed,
      generatedAt: mapData.generatedAt,
    };

    this.broadcastToGame(gameId, 'map-data', mapDataPacket);

    // Send data in EXACT freeciv-web format
    const gameInstance = this.games.get(gameId);
    if (gameInstance) {
      // Send map info in EXACT freeciv-web format (gets assigned to global map variable)
      const mapInfoPacket = {
        xsize: mapData.width,
        ysize: mapData.height,
        wrap_id: 0, // Flat earth
        topology_id: 0,
      };

      this.broadcastPacketToGame(gameId, PacketType.MAP_INFO, mapInfoPacket);

      // OPTIMIZED: Send tiles in batches to improve performance

      // Collect all tiles into an array
      const allTiles = [];
      for (let y = 0; y < mapData.height; y++) {
        for (let x = 0; x < mapData.width; x++) {
          const index = x + y * mapData.width;
          // Handle column-based tile array structure: mapData.tiles[x][y]
          const serverTile = mapData.tiles[x] && mapData.tiles[x][y];

          if (serverTile) {
            // Format tile in exact freeciv-web format
            const tileInfo = {
              tile: index, // This is the key - tile index used by freeciv-web
              x: x,
              y: y,
              terrain: serverTile.terrain,
              resource: serverTile.resource,
              elevation: serverTile.elevation || 0,
              riverMask: serverTile.riverMask || 0,
              known: 1, // TILE_KNOWN
              seen: 1,
              player: null,
              worked: null,
              extras: 0, // BitVector for extras
            };
            allTiles.push(tileInfo);
          }
        }
      }

      // Send tiles in batches of 100 to avoid overwhelming the client
      const BATCH_SIZE = 100;
      for (let i = 0; i < allTiles.length; i += BATCH_SIZE) {
        const batch = allTiles.slice(i, i + BATCH_SIZE);
        this.broadcastPacketToGame(gameId, PacketType.TILE_INFO, {
          tiles: batch,
          startIndex: i,
          endIndex: Math.min(i + BATCH_SIZE, allTiles.length),
          total: allTiles.length,
        });
      }

      logger.debug(
        `Sent ${allTiles.length} tiles in ${Math.ceil(allTiles.length / BATCH_SIZE)} batches`
      );
    }
  }
  */

  /**
   * Create starting units for all players at their starting positions
   * @reference freeciv/server/plrhand.c:player_init() - create_start_unit()
   * Each player starts with a settler (city founder) and a warrior (military unit)
   */
  private async createStartingUnits(
    gameId: string,
    mapData: any,
    unitManager: any,
    players: Map<string, PlayerState>
  ): Promise<void> {
    try {
      logger.info('Creating starting units for all players', { gameId });

      // Create starting units for each player
      for (const player of players.values()) {
        const startingPos = mapData.startingPositions.find(
          (pos: any) => pos.playerId === player.id
        );

        if (!startingPos) {
          logger.warn(`No starting position found for player ${player.id}`);
          continue;
        }

        try {
          // Create settler first (city founder)
          // @reference freeciv/server/plrhand.c - UTYF_CITYFOUNDATION flag
          const settler = await unitManager.createUnit(
            player.id,
            'settlers',
            startingPos.x,
            startingPos.y
          );

          // Create military unit (warrior) at same position
          // @reference freeciv/server/plrhand.c - initial military unit
          const warrior = await unitManager.createUnit(
            player.id,
            'warriors',
            startingPos.x,
            startingPos.y
          );

          logger.info(`Created starting units for player ${player.id}`, {
            gameId,
            playerId: player.id,
            position: `${startingPos.x},${startingPos.y}`,
            units: [settler.id, warrior.id],
          });

          // The player-scoped initial map sync emits these units after
          // visibility is calculated. Broadcasting here would disclose every
          // starting position to every player before that sync.
        } catch (error) {
          logger.error(`Failed to create starting units for player ${player.id}:`, error);
          // Continue with other players even if one fails
        }
      }

      logger.info('Starting units creation completed', { gameId });
    } catch (error) {
      logger.error('Failed to create starting units:', error);
      // Don't throw to avoid breaking game initialization
    }
  }

  /**
   * Recover game instance from database when not found in memory
   * This handles cases where the server restarted and game instances were lost
   */
  // Game recovery methods - delegates to GameInstanceRecoveryService
  public async recoverGameInstance(gameId: string): Promise<GameInstance | null> {
    const instance = await this.gameInstanceRecoveryService.recoverGameInstance(gameId);
    if (instance) await this.configureRecoveredInstance(gameId, instance);
    return instance;
  }

  public getDiplomacySnapshot(gameId: string, playerId: string): Promise<DiplomacySnapshot> {
    return this.diplomacyManager.getSnapshot(gameId, playerId);
  }

  public proposeTreaty(
    gameId: string,
    proposerId: string,
    recipientId: string,
    clauses: TreatyClause[],
    requestId?: string
  ): Promise<TreatyProposal> {
    return this.diplomacyManager.proposeTreaty(gameId, proposerId, recipientId, clauses, requestId);
  }

  public respondToTreaty(
    gameId: string,
    playerId: string,
    otherPlayerId: string,
    proposalId: string,
    accept: boolean
  ): Promise<TreatyProposal> {
    return this.diplomacyManager
      .respondToTreaty(gameId, playerId, otherPlayerId, proposalId, accept)
      .then(async proposal => {
        await this.refreshSharedVision(gameId);
        if (accept) {
          await this.games
            .get(gameId)
            ?.cityManager.updateTradeRoutesForDiplomacy(playerId, otherPlayerId);
        }
        return proposal;
      });
  }

  public cancelTreaty(
    gameId: string,
    playerId: string,
    otherPlayerId: string,
    proposalId: string
  ): Promise<TreatyProposal> {
    return this.diplomacyManager.cancelTreaty(gameId, playerId, otherPlayerId, proposalId);
  }

  public declareWar(gameId: string, playerId: string, otherPlayerId: string): Promise<void> {
    return this.diplomacyManager.declareWar(gameId, playerId, otherPlayerId).then(async () => {
      await this.refreshSharedVision(gameId);
      await this.games
        .get(gameId)
        ?.cityManager.updateTradeRoutesForDiplomacy(playerId, otherPlayerId);
    });
  }

  public cancelDiplomaticPact(
    gameId: string,
    playerId: string,
    otherPlayerId: string
  ): Promise<void> {
    return this.diplomacyManager.cancelPact(gameId, playerId, otherPlayerId).then(async () => {
      await this.refreshSharedVision(gameId);
      await this.games
        .get(gameId)
        ?.cityManager.updateTradeRoutesForDiplomacy(playerId, otherPlayerId);
    });
  }

  public cancelSharedVision(
    gameId: string,
    playerId: string,
    otherPlayerId: string
  ): Promise<void> {
    return this.diplomacyManager
      .cancelSharedVision(gameId, playerId, otherPlayerId)
      .then(() => this.refreshSharedVision(gameId));
  }

  public async executeDiplomatAction(
    gameId: string,
    playerId: string,
    unitId: string,
    actionType: ActionType,
    targetX: number,
    targetY: number,
    requestedTechnologyId?: string,
    requestedBuildingId?: string
  ): Promise<ActionResult> {
    const game = this.games.get(gameId);
    if (!game) return { success: false, message: 'Game not found' };
    const unit = game.unitManager.getUnit(unitId);
    const unitType = unit ? this.getGameUnitType(game, unit.unitTypeId) : undefined;
    const unitFlags = unitType?.flags ?? [];
    if (!unit || unit.playerId !== playerId || !unitFlags.includes('Diplomat')) {
      return { success: false, message: 'A diplomat or spy owned by the player is required' };
    }
    const topology = (game.mapManager as Partial<MapManager>).getTopology?.();
    const targetDistance =
      topology?.realDistance(unit.x, unit.y, targetX, targetY) ??
      Math.max(Math.abs(unit.x - targetX), Math.abs(unit.y - targetY));
    if (targetDistance > 1) {
      return { success: false, message: 'Target must be adjacent' };
    }
    if (unit.movementLeft < 1) {
      return { success: false, message: 'The diplomat has no movement remaining' };
    }

    const unitTargetActions = new Set([ActionType.BRIBE_UNIT, ActionType.SABOTAGE_UNIT]);
    if (unitTargetActions.has(actionType)) {
      return this.executeDiplomatUnitAction(
        gameId,
        playerId,
        unit,
        unitFlags,
        actionType,
        targetX,
        targetY
      );
    }

    const city = game.cityManager.getCityAt(targetX, targetY);
    if (!city || city.playerId === playerId) {
      return { success: false, message: 'An adjacent foreign city is required' };
    }
    const targetOwnerId = city.playerId;
    await this.diplomacyManager.establishContact(gameId, playerId, targetOwnerId);
    const relation = await this.getDiplomaticState(gameId, playerId, targetOwnerId);
    const theftCount = game.cityManager.getEspionageTheftCount?.(city.id, playerId) ?? 0;

    let result: ActionResult;
    let actorSurvives = unitFlags.includes('Spy');
    const attemptMission = async (): Promise<ActionResult | null> => {
      const defender = game.unitManager.getUnitsAt(targetX, targetY).find(candidate => {
        const candidateType = this.getGameUnitType(game, candidate.unitTypeId);
        return (
          candidate.playerId !== playerId &&
          (candidateType?.flags?.includes('Diplomat') ||
            candidateType?.flags?.includes('SuperSpy')) &&
          !candidate.transportedBy
        );
      });
      const resolution =
        theftCount > 0
          ? game.unitManager.resolveDiplomatAction?.(unit.id, actionType, defender?.id, theftCount)
          : game.unitManager.resolveDiplomatAction?.(unit.id, actionType, defender?.id);
      const resolved = resolution ?? {
        success: true,
        actorSurvives: unitFlags.includes('Spy'),
      };
      actorSurvives = resolved.actorSurvives;
      if (resolved.success) return null;
      await game.unitManager.removeUnit(unit.id);
      return {
        success: false,
        message: `The ${unitType!.name} was intercepted`,
        unitDestroyed: true,
      };
    };
    if (actionType === ActionType.ESTABLISH_EMBASSY) {
      const failure = await attemptMission();
      if (failure) return failure;
      await this.diplomacyManager.establishEmbassy(gameId, playerId, city.playerId);
      result = { success: true, message: `Embassy established in ${city.name}` };
    } else if (actionType === ActionType.INVESTIGATE_CITY) {
      const failure = await attemptMission();
      if (failure) return failure;
      result = {
        success: true,
        message: `${city.name}: size ${city.size}, ${city.buildings.length} improvements, ${city.productionPerTurn ?? 0} shields/turn`,
      };
    } else if (actionType === ActionType.STEAL_TECH) {
      const previousThefts = game.cityManager.getEspionageTheftCount?.(city.id, playerId) ?? 0;
      if (!unitFlags.includes('Spy') && previousThefts > 0) {
        return { success: false, message: 'This city has already been targeted by this diplomat' };
      }
      const known = new Set(game.researchManager.getResearchedTechs(playerId));
      const availableTechs = game.researchManager
        .getResearchedTechs(city.playerId)
        .filter(tech => !known.has(tech))
        .sort();
      if (requestedTechnologyId !== undefined && !availableTechs.includes(requestedTechnologyId)) {
        return { success: false, message: 'That technology is not available to steal' };
      }
      const stolenTech =
        requestedTechnologyId ?? availableTechs[game.random.next(availableTechs.length)];
      if (!stolenTech) return { success: false, message: 'No technology is available to steal' };
      const failure = await attemptMission();
      if (failure) return failure;
      await game.researchManager.grantTechnology(playerId, stolenTech);
      await game.cityManager.recordEspionageTheft?.(city.id, playerId);
      result = { success: true, message: `Stole ${stolenTech} from ${city.name}` };
    } else if (actionType === ActionType.SABOTAGE_CITY_PRODUCTION) {
      if (!unitFlags.includes('Spy')) {
        return { success: false, message: 'Only spies can sabotage city production' };
      }
      if (!city.currentProduction) {
        return { success: false, message: 'The target city has no active production' };
      }
      const failure = await attemptMission();
      if (failure) return failure;
      const production = await game.cityManager.sabotageCityProduction?.(city.id, playerId);
      if (!production)
        return { success: false, message: 'The target city has no active production' };
      await game.cityManager.recordEspionageTheft?.(city.id, playerId);
      this.gameBroadcastManager.broadcastCityData(gameId);
      result = { success: true, message: `Sabotaged production of ${production} in ${city.name}` };
    } else if (actionType === ActionType.SABOTAGE_CITY) {
      if (!unitFlags.includes('Spy')) {
        return { success: false, message: 'Only spies can sabotage a city' };
      }
      const eligibleBuildings =
        game.cityManager.getSabotageableBuildings?.(city.id) ??
        city.buildings.filter(building => building !== 'palace');
      if (eligibleBuildings.length === 0) {
        return { success: false, message: 'No eligible improvement to sabotage' };
      }
      const failure = await attemptMission();
      if (failure) return failure;
      if (requestedBuildingId !== undefined && !eligibleBuildings.includes(requestedBuildingId)) {
        return { success: false, message: 'That improvement is not present in the target city' };
      }
      const building = await game.cityManager.sabotageCityBuilding(
        city.id,
        playerId,
        requestedBuildingId
      );
      if (!building) return { success: false, message: 'No eligible improvement to sabotage' };
      await game.cityManager.recordEspionageTheft?.(city.id, playerId);
      this.gameBroadcastManager.broadcastCityData(gameId);
      result = { success: true, message: `Sabotaged ${building} in ${city.name}` };
    } else if (actionType === ActionType.POISON_WATER) {
      if (!unitFlags.includes('Spy')) {
        return { success: false, message: 'Only spies can poison a city' };
      }
      if (relation !== 'war') {
        return { success: false, message: 'Poisoning a city requires a state of war' };
      }
      if (city.size < 2) {
        return { success: false, message: 'Target city must have at least two citizens' };
      }
      const failure = await attemptMission();
      if (failure) return failure;
      await game.cityManager.poisonCity(city.id, playerId);
      this.gameBroadcastManager.broadcastCityData(gameId);
      result = { success: true, message: `Poisoned ${city.name}; its population fell by one` };
    } else if (actionType === ActionType.INCITE_CITY) {
      if (city.buildings.includes('palace')) {
        return { success: false, message: 'A capital cannot be incited' };
      }
      if (
        game.governmentManager?.getPlayerGovernment(city.playerId)?.currentGovernment ===
        'democracy'
      ) {
        return { success: false, message: 'Cities under Democracy cannot be incited' };
      }
      if (relation === 'alliance') {
        return { success: false, message: 'An allied city cannot be incited' };
      }
      const economicManager = game.turnManager.getEconomicManager();
      if (!economicManager) return { success: false, message: 'Treasury is unavailable' };
      const cost = await this.calculateInciteCost(game, city);
      const failure = await attemptMission();
      if (failure) return failure;
      const payment = await economicManager.spendPlayerGold(
        playerId,
        cost,
        `Incited a revolt in ${city.name}`,
        { cityId: city.id, turn: game.currentTurn },
        GoldSpendingType.DIPLOMACY
      );
      if (!payment.success) {
        return { success: false, message: `Inciting ${city.name} costs ${cost} gold` };
      }
      const formerOwnerId = city.playerId;
      if (city.size > 1) {
        await game.cityManager.poisonCity(city.id, playerId);
      }
      city.productionStock = 0;
      await game.cityManager.transferCity(city.id, playerId);
      const defectingUnits = game.unitManager
        .getPlayerUnits(formerOwnerId)
        .filter(
          candidate =>
            candidate.homeCityId === city.id &&
            game.mapManager.getDistance(candidate.x, candidate.y, city.x, city.y) <= 1
        );
      for (const defectingUnit of defectingUnits) {
        await game.unitManager.bribeUnit(defectingUnit.id, playerId, city.id);
        this.broadcastUnitInfo(gameId, defectingUnit);
      }
      const stolenTech = await this.stealFirstAvailableTechnology(game, playerId, formerOwnerId);
      this.gameBroadcastManager.broadcastCityData(gameId);
      result = {
        success: true,
        message: `Revolt incited in ${city.name} for ${cost} gold${stolenTech ? `; gained ${stolenTech}` : ''}`,
        cityId: city.id,
      };
    } else {
      return { success: false, message: 'Unsupported diplomat action' };
    }

    if (
      [
        ActionType.STEAL_TECH,
        ActionType.SABOTAGE_CITY,
        ActionType.SABOTAGE_CITY_PRODUCTION,
        ActionType.POISON_WATER,
        ActionType.INCITE_CITY,
      ].includes(actionType)
    ) {
      await this.diplomacyManager.recordIncident(
        gameId,
        playerId,
        targetOwnerId,
        AI_INCIDENT_SEVERITY[actionType] ?? 100
      );
    }
    if (!actorSurvives) {
      await game.unitManager.removeUnit(unit.id);
      result.unitDestroyed = true;
    } else {
      await game.unitManager.finishDiplomatMission(unit.id);
    }
    await this.refreshSharedVision(gameId);
    return result;
  }

  /**
   * Return the authoritative selectable targets for a city espionage action.
   * The client uses this to present the same target list that execution will
   * validate; no mission state is changed by this query.
   */
  public getDiplomatActionOptions(
    gameId: string,
    playerId: string,
    unitId: string,
    actionType: ActionType,
    targetX: number,
    targetY: number
  ): { success: boolean; options?: Array<{ id: string; label: string }>; message?: string } {
    const game = this.games.get(gameId);
    if (!game) return { success: false, message: 'Game not found' };
    if (actionType !== ActionType.STEAL_TECH && actionType !== ActionType.SABOTAGE_CITY) {
      return { success: false, message: 'This action has no selectable targets' };
    }
    const unit = game.unitManager.getUnit(unitId);
    const unitType = unit ? this.getGameUnitType(game, unit.unitTypeId) : undefined;
    if (!unit || unit.playerId !== playerId || !unitType?.flags?.includes('Diplomat')) {
      return { success: false, message: 'A diplomat or spy owned by the player is required' };
    }
    if (unit.movementLeft < 1) {
      return { success: false, message: 'The diplomat has no movement remaining' };
    }
    const topology = (game.mapManager as Partial<MapManager>).getTopology?.();
    const targetDistance =
      topology?.realDistance(unit.x, unit.y, targetX, targetY) ??
      Math.max(Math.abs(unit.x - targetX), Math.abs(unit.y - targetY));
    if (targetDistance > 1) return { success: false, message: 'Target must be adjacent' };

    const city = game.cityManager.getCityAt(targetX, targetY);
    if (!city || city.playerId === playerId) {
      return { success: false, message: 'An adjacent foreign city is required' };
    }
    if (actionType === ActionType.STEAL_TECH) {
      const theftCount = game.cityManager.getEspionageTheftCount?.(city.id, playerId) ?? 0;
      if (!unitType.flags.includes('Spy') && theftCount > 0) {
        return { success: false, message: 'This city has already been targeted by this diplomat' };
      }
      const known = new Set(game.researchManager.getResearchedTechs(playerId));
      const options = game.researchManager
        .getResearchedTechs(city.playerId)
        .filter(technologyId => !known.has(technologyId))
        .map(technologyId => ({ id: technologyId, label: technologyId }));
      return { success: true, options };
    }
    if (!unitType.flags?.includes('Spy')) {
      return { success: false, message: 'Only spies can sabotage a city' };
    }
    const eligibleBuildings =
      game.cityManager.getSabotageableBuildings?.(city.id) ??
      city.buildings.filter(buildingId => buildingId.toLowerCase() !== 'palace');
    return {
      success: true,
      options: eligibleBuildings.map(buildingId => ({ id: buildingId, label: buildingId })),
    };
  }

  private async executeDiplomatUnitAction(
    gameId: string,
    playerId: string,
    actor: Unit,
    actorFlags: string[],
    actionType: ActionType,
    targetX: number,
    targetY: number
  ): Promise<ActionResult> {
    const game = this.games.get(gameId)!;
    const targets = game.unitManager
      .getUnitsAt(targetX, targetY)
      .filter(candidate => candidate.id !== actor.id);
    if (targets.length !== 1 || targets[0]!.playerId === playerId) {
      return { success: false, message: 'An adjacent, single foreign unit is required' };
    }
    const target = targets[0]!;
    const targetType = this.getGameUnitType(game, target.unitTypeId);
    await this.diplomacyManager.establishContact(gameId, playerId, target.playerId);
    const relation = await this.getDiplomaticState(gameId, playerId, target.playerId);
    let result: ActionResult;
    let actorSurvives = actorFlags.includes('Spy');
    const attemptMission = async (): Promise<ActionResult | null> => {
      const resolution = game.unitManager.resolveDiplomatAction?.(
        actor.id,
        actionType,
        targetType?.flags?.includes('Diplomat') ? target.id : undefined
      ) ?? {
        success: true,
        actorSurvives: actorFlags.includes('Spy'),
      };
      actorSurvives = resolution.actorSurvives;
      if (resolution.success) return null;
      await game.unitManager.removeUnit(actor.id);
      return {
        success: false,
        message: `The ${this.getGameUnitType(game, actor.unitTypeId)?.name ?? actor.unitTypeId} was intercepted`,
        unitDestroyed: true,
      };
    };

    if (actionType === ActionType.BRIBE_UNIT) {
      if (targetType?.flags?.includes('Unbribable')) {
        return { success: false, message: 'That unit cannot be bribed' };
      }
      if (game.cityManager.getCityAt(targetX, targetY)) {
        return { success: false, message: 'Units in a city center cannot be bribed' };
      }
      if (relation === 'alliance') {
        return { success: false, message: 'An allied unit cannot be bribed' };
      }
      if (
        game.governmentManager?.getPlayerGovernment(target.playerId)?.currentGovernment ===
        'democracy'
      ) {
        return { success: false, message: 'Units under Democracy cannot be bribed' };
      }
      const economicManager = game.turnManager.getEconomicManager();
      if (!economicManager) return { success: false, message: 'Treasury is unavailable' };
      const ownerGold = await economicManager.getPlayerGold(target.playerId);
      const cost = this.calculateBribeCost(game, target, ownerGold);
      const failure = await attemptMission();
      if (failure) return failure;
      const payment = await economicManager.spendPlayerGold(
        playerId,
        cost,
        `Bribed ${target.unitTypeId}`,
        { unitId: target.id, turn: game.currentTurn },
        GoldSpendingType.DIPLOMACY
      );
      if (!payment.success) {
        return { success: false, message: `Bribing ${target.unitTypeId} costs ${cost} gold` };
      }
      await game.unitManager.bribeUnit(target.id, playerId, actor.homeCityId);
      this.broadcastUnitInfo(gameId, target);
      result = { success: true, message: `Bribed ${target.unitTypeId} for ${cost} gold` };
    } else {
      if (!actorFlags.includes('Spy')) {
        return { success: false, message: 'Only spies can sabotage a unit' };
      }
      if (relation !== 'war') {
        return { success: false, message: 'Sabotaging a unit requires a state of war' };
      }
      if (game.cityManager.getCityAt(targetX, targetY)) {
        return { success: false, message: 'Units in a city center cannot be sabotaged' };
      }
      if (target.health < 2) {
        return { success: false, message: 'Target must have at least two hit points' };
      }
      const failure = await attemptMission();
      if (failure) return failure;
      const sabotage = await game.unitManager.sabotageUnit(target.id);
      if (!sabotage.destroyed) this.broadcastUnitInfo(gameId, sabotage.unit!);
      result = {
        success: true,
        message: `Sabotaged ${target.unitTypeId}; remaining health ${sabotage.unit?.health ?? 0}`,
        targetDestroyed: sabotage.destroyed,
      };
    }

    await this.diplomacyManager.recordIncident(
      gameId,
      playerId,
      target.playerId,
      AI_INCIDENT_SEVERITY[actionType] ?? 100
    );
    if (!actorSurvives) {
      await game.unitManager.removeUnit(actor.id);
      result.unitDestroyed = true;
    } else {
      await game.unitManager.finishDiplomatMission(actor.id);
    }
    return result;
  }

  private async getDiplomaticState(
    gameId: string,
    playerId: string,
    otherPlayerId: string
  ): Promise<string> {
    const snapshot = await this.diplomacyManager.getSnapshot(gameId, playerId);
    return (
      snapshot.nations.find(nation => nation.id === otherPlayerId)?.relation.state ?? 'no_contact'
    );
  }

  private async executeTreatyTransfers(
    gameId: string,
    proposerId: string,
    recipientId: string,
    clauses: TreatyClause[]
  ): Promise<void | (() => Promise<void>)> {
    return this.withTreatyPlayerLocks(gameId, [proposerId, recipientId], () =>
      this.executeTreatyTransfersLocked(gameId, proposerId, recipientId, clauses)
    );
  }

  private async executeTreatyTransfersLocked(
    gameId: string,
    proposerId: string,
    recipientId: string,
    clauses: TreatyClause[]
  ): Promise<() => Promise<void>> {
    const game = this.games.get(gameId);
    if (!game) throw new Error('Game is not active');
    const rows = await this.databaseProvider.getDatabase().query.players.findMany({
      where: eq(players.gameId, gameId),
    });
    const playerRows = new Map(rows.map(player => [player.id, player]));
    if (!playerRows.has(proposerId) || !playerRows.has(recipientId)) {
      throw new Error('Treaty player not found');
    }
    const otherPlayer = (playerId: string) => (playerId === proposerId ? recipientId : proposerId);
    const materialClauses = clauses.map(clause => {
      const giverId = clause.giverId ?? proposerId;
      return { clause, giverId, receiverId: otherPlayer(giverId) };
    });
    const goldByGiver = new Map<string, number>();

    for (const { clause, giverId, receiverId } of materialClauses) {
      if (clause.type === 'technology') {
        if (!game.researchManager.getResearchedTechs(giverId).includes(clause.techId)) {
          throw new Error('Treaty giver does not know the offered technology');
        }
        if (game.researchManager.getResearchedTechs(receiverId).includes(clause.techId)) {
          throw new Error('Treaty recipient already knows the offered technology');
        }
      }
      if (clause.type === 'gold') {
        goldByGiver.set(giverId, (goldByGiver.get(giverId) ?? 0) + clause.amount);
      }
      if (clause.type === 'city' && game.cityManager.getCity(clause.cityId)?.playerId !== giverId) {
        throw new Error('Treaty giver does not own the offered city');
      }
    }
    for (const [giverId, amount] of goldByGiver) {
      if ((playerRows.get(giverId)?.gold ?? -1) < amount) {
        throw new Error('Treaty giver cannot afford the offered gold');
      }
    }

    const transferredCities: Array<{ cityId: string; originalOwnerId: string }> = [];
    const grantedTechnologies: Array<{ playerId: string; techId: string }> = [];
    const exploredSnapshots = new Map<string, Set<string>>();
    const goldTransfers: Array<{ giverId: string; receiverId: string; amount: number }> = [];
    let goldPersisted = false;
    const rollback = async () => {
      for (const [playerId, explored] of exploredSnapshots) {
        game.visibilityManager.replaceExploredTiles(playerId, explored);
      }
      for (const transfer of [...grantedTechnologies].reverse()) {
        await game.researchManager.revokeGrantedTechnology(transfer.playerId, transfer.techId);
      }
      for (const transfer of [...transferredCities].reverse()) {
        await game.cityManager.transferCity(transfer.cityId, transfer.originalOwnerId);
      }
      if (goldPersisted) {
        await this.persistGoldTreatyTransfers(
          goldTransfers.map(transfer => ({
            giverId: transfer.receiverId,
            receiverId: transfer.giverId,
            amount: transfer.amount,
          }))
        );
      }
      game.visibilityManager.updateAllPlayersVisibility([proposerId, recipientId]);
      this.gameBroadcastManager.broadcastVisibilityState(gameId);
    };

    try {
      for (const { clause, giverId, receiverId } of materialClauses) {
        if (clause.type === 'city') {
          if (!(await game.cityManager.transferCity(clause.cityId, receiverId))) {
            throw new Error('Offered city could not be transferred');
          }
          transferredCities.push({ cityId: clause.cityId, originalOwnerId: giverId });
        } else if (clause.type === 'technology') {
          if (!(await game.researchManager.grantTechnology(receiverId, clause.techId))) {
            throw new Error('Offered technology could not be transferred');
          }
          grantedTechnologies.push({ playerId: receiverId, techId: clause.techId });
        } else if (clause.type === 'gold') {
          goldTransfers.push({ giverId, receiverId, amount: clause.amount });
        } else if (clause.type === 'map' || clause.type === 'seamap') {
          if (!exploredSnapshots.has(receiverId)) {
            exploredSnapshots.set(
              receiverId,
              new Set(game.visibilityManager.getExploredTiles(receiverId))
            );
          }
          const explored = game.visibilityManager.getExploredTiles(giverId);
          const granted =
            clause.type === 'map'
              ? explored
              : [...explored].filter(tileKey => {
                  const [x, y] = tileKey.split(',').map(Number);
                  return ['ocean', 'coast', 'deep_ocean', 'lake'].includes(
                    game.mapManager.getTile(x, y)?.terrain ?? ''
                  );
                });
          game.visibilityManager.grantExploredTiles(receiverId, granted);
        }
      }
      await this.persistGoldTreatyTransfers(goldTransfers);
      goldPersisted = true;
    } catch (error) {
      await rollback();
      throw error;
    }
    game.visibilityManager.updateAllPlayersVisibility([proposerId, recipientId]);
    this.gameBroadcastManager.broadcastVisibilityState(gameId);
    return rollback;
  }

  private async persistGoldTreatyTransfers(
    transfers: Array<{ giverId: string; receiverId: string; amount: number }>
  ): Promise<void> {
    if (transfers.length === 0) return;
    const db = this.databaseProvider.getDatabase();
    const persist = async (executor: typeof db) => {
      for (const transfer of transfers) {
        await executor
          .update(players)
          .set({ gold: sql`${players.gold} - ${transfer.amount}` })
          .where(eq(players.id, transfer.giverId));
        await executor
          .update(players)
          .set({ gold: sql`${players.gold} + ${transfer.amount}` })
          .where(eq(players.id, transfer.receiverId));
      }
    };
    if (typeof (db as any).transaction === 'function') {
      await (db as any).transaction((transaction: typeof db) => persist(transaction));
    } else {
      await persist(db);
    }
  }

  private async withTreatyPlayerLocks<T>(
    gameId: string,
    playerIds: string[],
    operation: () => Promise<T>
  ): Promise<T> {
    const keys = [...new Set(playerIds)].sort().map(playerId => `${gameId}:${playerId}`);
    const previous = keys.map(key => this.treatyPlayerLocks.get(key) ?? Promise.resolve());
    const ready = Promise.all(previous.map(lock => lock.catch(() => undefined)));
    const next = ready.then(operation).finally(() => {
      for (const key of keys) {
        if (this.treatyPlayerLocks.get(key) === next) this.treatyPlayerLocks.delete(key);
      }
    });
    for (const key of keys) this.treatyPlayerLocks.set(key, next);
    return next;
  }

  /**
   * @reference reference/freeciv/common/unit.c:2371-2471 unit_bribe_cost()
   */
  private calculateBribeCost(game: GameInstance, target: Unit, ownerGold: number): number {
    return calculateDiplomatBribeCost(game, target, ownerGold);
  }

  /**
   * Available CivJS state is applied to the classic incite formula: treasury,
   * local units, improvements, stability, city size, and capital distance.
   * @reference reference/freeciv/server/cityturn.c:3556-3630
   * @reference reference/freeciv/data/classic/game.ruleset:208-216
   */
  private async calculateInciteCost(game: GameInstance, city: CityState): Promise<number> {
    return calculateDiplomatInciteCost(game, city);
  }

  private async stealFirstAvailableTechnology(
    game: GameInstance,
    playerId: string,
    targetPlayerId: string
  ): Promise<string | undefined> {
    const known = new Set(game.researchManager.getResearchedTechs(playerId));
    const technology = game.researchManager
      .getResearchedTechs(targetPlayerId)
      .filter(tech => !known.has(tech))
      .sort()[0];
    if (technology) await game.researchManager.grantTechnology(playerId, technology);
    return technology;
  }

  private async configureMultiplayerInstance(
    gameId: string,
    { startTurnTimer = true }: { startTurnTimer?: boolean } = {}
  ): Promise<void> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) return;
    gameInstance.unitManager.setHostilityProvider((attackerPlayerId, defenderPlayerId) =>
      this.hostilityPolicy.canAttack(gameId, attackerPlayerId, defenderPlayerId)
    );
    gameInstance.unitManager.setContactProvider(async (firstPlayerId, secondPlayerId) => {
      await this.diplomacyManager.establishContact(gameId, firstPlayerId, secondPlayerId);
      await this.refreshSharedVision(gameId);
    });
    gameInstance.unitManager.setHostilePlayersProvider(
      playerId => this.hostilePlayersByGame.get(gameId)?.get(playerId) ?? new Set()
    );
    gameInstance.cityManager.setTileOccupancyProvider((city, tile) => {
      const hostilePlayers = this.hostilePlayersByGame.get(gameId)?.get(city.playerId);
      if (!hostilePlayers?.size) return false;
      return gameInstance.unitManager.getUnitsAt(tile.x, tile.y).some(unit => {
        const unitType = gameInstance.unitManager.getUnitType(unit.unitTypeId);
        return hostilePlayers.has(unit.playerId) && !unitType?.flags?.includes('DoesntOccupyTile');
      });
    });
    gameInstance.cityManager.refreshAllTileOccupancy();
    gameInstance.unitManager.setAlliedPlayersProvider(
      playerId => this.alliedPlayersByGame.get(gameId)?.get(playerId) ?? new Set()
    );
    const economicManager = gameInstance.turnManager.getEconomicManager();
    gameInstance.cityManager.setTradeProviders(
      async (playerId, amount) =>
        economicManager
          ? economicManager.addPlayerGold(playerId, amount, 'Caravan trade bonus')
          : false,
      async (playerId, amount) => {
        await gameInstance.researchManager.addResearchPoints(playerId, amount);
      },
      (playerId, otherPlayerId) => this.getDiplomaticState(gameId, playerId, otherPlayerId)
    );
    gameInstance.visibilityManager.setSharedVisionProvider(
      playerId => this.sharedVisionByGame.get(gameId)?.get(playerId) ?? new Set()
    );
    gameInstance.researchManager.setScienceCostProvider(playerId => {
      const player = gameInstance.players.get(playerId);
      return player?.isAI ? createAIProfile(player.aiLevel, player.aiTraits).scienceCost : 100;
    });
    const gameEventService = gameInstance.turnManager.getGameEventService();
    gameInstance.researchManager.setTechnologyCompletionObserver((playerId, techId, source) => {
      gameEventService.recordTechnologyCompleted(playerId, techId, source);
    });
    gameInstance.cityManager.setGameplayEventObserver(event => {
      switch (event.type) {
        case 'founded':
          gameEventService.recordCityFounded(event.city);
          break;
        case 'growth':
          gameEventService.recordCityGrowth(event.city, event.oldSize);
          break;
        case 'production_completed':
          gameEventService.recordCityProductionCompleted(event.city, event.item);
          break;
        case 'trade_route_established':
          gameEventService.recordTradeRouteEstablished(
            event.sourceCity,
            event.partnerCity,
            event.route
          );
          break;
      }
    });
    gameInstance.unitManager.setCombatObserver(event => {
      gameEventService.recordCombatOccurred(event);
    });
    gameInstance.unitManager.setUnitLifecycleObserver(event => {
      gameEventService.recordUnitLifecycle(event);
      if (event.type === 'moved') {
        gameInstance.cityManager.refreshTileOccupancy(event.previousX, event.previousY);
      }
      gameInstance.cityManager.refreshTileOccupancy(event.unit.x, event.unit.y);
      if (event.type === 'created' || event.type === 'moved' || event.type === 'owner_changed') {
        void gameInstance.unitManager.wakeSentriesForUnit(event.unit);
      }
      this.aiOrchestrator.onUnitLifecycle(gameId, gameInstance, event);
    });
    gameInstance.unitManager.setDiplomatActionExecutor(
      (playerId, unitId, actionType, targetX, targetY) =>
        this.executeDiplomatAction(gameId, playerId, unitId, actionType, targetX, targetY)
    );
    gameInstance.cityManager.setCallbacks({
      onCityDestroyed: async city => {
        this.aiOrchestrator.onCityInvalidated(gameId, gameInstance, city.id);
        await gameInstance.turnManager.evaluateEndGameNow();
      },
      onCityCaptured: city => this.aiOrchestrator.onCityInvalidated(gameId, gameInstance, city.id),
    });
    gameInstance.turnManager.setAIProcessor(() =>
      this.aiOrchestrator.processTurn(gameId, gameInstance)
    );
    gameInstance.turnManager.setWorkerAutomationProcessor(() =>
      processHumanWorkerAutomation(gameInstance, this.hostilityPolicy)
    );
    let endGameTelemetry: EndGameTelemetry | null = null;
    gameInstance.turnManager.setDiplomacyProcessor(async () => {
      const events = await this.diplomacyManager.processTurn(gameId);
      for (const event of events) {
        if (event.type === 'armistice_completed') {
          await this.removeIllegalPeaceUnits(gameId, event.playerIds[0], event.playerIds[1]);
        }
      }
      await this.refreshSharedVision(gameId);
      for (const firstPlayerId of gameInstance.players.keys()) {
        for (const secondPlayerId of gameInstance.players.keys()) {
          if (firstPlayerId >= secondPlayerId) continue;
          await gameInstance.cityManager.updateTradeRoutesForDiplomacy(
            firstPlayerId,
            secondPlayerId
          );
        }
      }
    });
    gameInstance.turnManager.setReplaySnapshotProvider(async () => ({
      map: gameInstance.mapManager.getMapData(),
      players: Array.from(gameInstance.players.values()).map(player => ({
        id: player.id,
        teamId: player.teamId,
        isAlive: player.isAlive,
        hasConceded: player.hasConceded,
        history: player.history,
        unitsBuilt: player.unitsBuilt ?? 0,
        unitsKilled: player.unitsKilled ?? 0,
        unitsLost: player.unitsLost ?? 0,
        spaceshipState: player.spaceshipState,
      })),
      diplomacy: await this.diplomacyManager.getReplaySnapshot(gameId),
      aiDiplomacy: getAIDiplomacyReplaySnapshot(gameInstance),
      diplomacyEvents: gameInstance.turnManager.getTurnDiplomacyEvents(),
      eventTelemetry: gameEventService.getTelemetryDiagnostics(),
      endGame: endGameTelemetry,
    }));
    gameInstance.turnManager.setEndGameEvaluator(async (turn, year) => {
      const evaluation = await this.endGameService.evaluate({
        gameId,
        turn,
        year,
        victoryConditions: gameInstance.config.victoryConditions ?? ['conquest'],
        // Barbarians are runtime unit owners, but do not participate in
        // ordinary-player victory standings.
        playerIds: Array.from(gameInstance.players.values())
          .filter(
            player =>
              player.nation !== 'barbarian' &&
              !player.civilization?.toLowerCase().startsWith('barbarian')
          )
          .map(player => player.id),
        cityManager: gameInstance.cityManager,
        unitManager: gameInstance.unitManager,
        researchManager: gameInstance.researchManager,
        cultureManager: gameInstance.turnManager.getCultureManager(),
        diplomacyManager: this.diplomacyManager,
        rulesetName: gameInstance.config.ruleset,
        maxTurns: gameInstance.config.maxTurns,
        spaceshipStateSink: (playerId, state) => {
          const player = gameInstance.players.get(playerId);
          if (player) player.spaceshipState = state;
        },
        telemetrySink: telemetry => {
          endGameTelemetry = telemetry;
        },
      });
      if (!evaluation.ended) return false;
      gameInstance.state = 'ended';
      gameInstance.lastActivity = new Date();
      gameInstance.turnManager.clearTurnTimer();
      return true;
    });
    gameInstance.turnManager.setTurnAdvancedCallback(async turn => {
      gameInstance.currentTurn = turn;
      for (const player of gameInstance.players.values()) player.hasEndedTurn = false;
      await this.gameBroadcastManager.broadcastPlayerInfo(gameId);
      if (startTurnTimer && gameInstance.state === 'active') {
        gameInstance.turnManager.startTurnTimer(gameInstance.config.turnTimeLimit ?? 300);
      }
    });
    await this.refreshSharedVision(gameId);
    if (startTurnTimer && gameInstance.state === 'active') {
      gameInstance.turnManager.restoreTurnTimer(
        gameInstance.turnDeadlineAt,
        gameInstance.pausedTimerSeconds,
        gameInstance.config.turnTimeLimit ?? 300
      );
      gameInstance.turnDeadlineAt = null;
      gameInstance.pausedTimerSeconds = null;
    }
  }

  private async refreshSharedVision(gameId: string): Promise<void> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) return;
    const sharedVision = new Map<string, Set<string>>();
    const hostilePlayers = new Map<string, Set<string>>();
    const alliedPlayers = new Map<string, Set<string>>();
    for (const playerId of gameInstance.players.keys()) {
      const snapshot = await this.diplomacyManager.getSnapshot(gameId, playerId);
      sharedVision.set(
        playerId,
        new Set(
          snapshot.nations
            .filter(nation => nation.relation.sharedVision)
            .map(nation => nation.id)
            .concat(
              snapshot.nations
                .filter(
                  nation => nation.relation.state === 'alliance' || nation.relation.state === 'team'
                )
                .map(nation => nation.id)
            )
        )
      );
      hostilePlayers.set(
        playerId,
        new Set(
          snapshot.nations
            .filter(nation => nation.relation.state === 'war')
            .map(nation => nation.id)
        )
      );
      alliedPlayers.set(
        playerId,
        new Set(
          snapshot.nations
            .filter(
              nation => nation.relation.state === 'alliance' || nation.relation.state === 'team'
            )
            .map(nation => nation.id)
        )
      );
    }
    this.sharedVisionByGame.set(gameId, sharedVision);
    this.hostilePlayersByGame.set(gameId, hostilePlayers);
    this.alliedPlayersByGame.set(gameId, alliedPlayers);
    gameInstance.visibilityManager.updateAllPlayersVisibility([...gameInstance.players.keys()]);
  }

  private async removeIllegalPeaceUnits(
    gameId: string,
    firstPlayerId: string,
    secondPlayerId: string
  ): Promise<void> {
    const game = this.games.get(gameId);
    if (!game) return;
    const pair = new Set([firstPlayerId, secondPlayerId]);
    for (const unit of [...game.unitManager.getAllUnits().values()]) {
      if (!pair.has(unit.playerId)) continue;
      const tileOwner = game.mapManager.getTile(unit.x, unit.y)?.owner;
      const otherPlayerId = unit.playerId === firstPlayerId ? secondPlayerId : firstPlayerId;
      const unitType = this.getGameUnitType(game, unit.unitTypeId);
      if (tileOwner !== otherPlayerId || unitType?.flags?.includes('NonMil')) continue;
      await game.unitManager.removeUnit(unit.id);
    }
  }

  private getGameUnitType(game: GameInstance, unitTypeId: string): UnitType | undefined {
    const unitManager = game.unitManager as GameInstance['unitManager'] & {
      getUnitType?: (id: string) => UnitType | undefined;
    };
    return (
      unitManager.getUnitType?.(unitTypeId) ??
      rulesetUnitsService.getUnitType(unitTypeId, game.config?.ruleset ?? 'civ2civ3')
    );
  }

  public async getGame(gameId: string): Promise<any | null> {
    return await this.getGameById(gameId);
  }

  public async getGameReplay(gameId: string, throughTurn?: number): Promise<GameReplay | null> {
    return this.replayService.getReplay(gameId, throughTurn);
  }

  public async reconstructGameAtTurn(gameId: string, turn: number): Promise<unknown | null> {
    return this.replayService.reconstructAtTurn(gameId, turn);
  }

  public async exportNativeSave(
    gameId: string,
    throughTurn?: number
  ): Promise<NativeSaveArchive | null> {
    return this.nativeSaveService.export(gameId, throughTurn);
  }

  /**
   * Validate and decode a portable archive. Mounting it as a live game remains
   * an explicit administrative operation so an upload cannot overwrite an
   * active authoritative game by accident.
   */
  public loadNativeSave(archive: unknown): LoadedNativeSave {
    return this.nativeSaveService.load(archive);
  }

  public getGameInstance(gameId: string): GameInstance | null {
    return this.games.get(gameId) || null;
  }

  public getAllGameInstances(): GameInstance[] {
    return this.gameLifecycleManager.getAllGameInstances();
  }

  public async loadGame(gameId: string): Promise<GameInstance | null> {
    const instance = await this.gameInstanceRecoveryService.loadGame(gameId);
    if (instance) await this.configureRecoveredInstance(gameId, instance);
    return instance;
  }

  private async configureRecoveredInstance(gameId: string, instance: GameInstance): Promise<void> {
    const isHeadless = instance.config.executionMode === 'headless';
    if (isHeadless && instance.state === 'active') {
      instance.state = 'paused';
      instance.turnManager.clearTurnTimer();
      await this.databaseProvider
        .getDatabase()
        .update(games)
        .set({
          status: 'paused',
          gameState: sql`jsonb_set(coalesce(${games.gameState}, '{}'::jsonb), '{simulation,runState}', '"paused"'::jsonb, true)`,
        })
        .where(eq(games.id, gameId));
    }
    await this.configureMultiplayerInstance(gameId, { startTurnTimer: !isHeadless });
  }

  public getActiveGameInstances(): GameInstance[] {
    return this.gameLifecycleManager.getActiveGameInstances();
  }

  public async getGameByPlayerId(playerId: string): Promise<any | null> {
    try {
      const player = await this.databaseProvider.getDatabase().query.players.findFirst({
        where: eq(players.id, playerId),
        with: {
          game: {
            with: {
              host: {
                columns: {
                  username: true,
                },
              },
              players: true,
            },
          },
        },
      });

      if (!player?.game) return null;

      const game = player.game;
      return {
        id: game.id,
        name: game.name,
        hostName: game.host?.username || 'Unknown',
        status: game.status,
        currentPlayers: game.players?.length || 0,
        maxPlayers: game.maxPlayers,
        currentTurn: game.currentTurn,
        mapSize: `${game.mapWidth}x${game.mapHeight}`,
        createdAt: game.createdAt.toISOString(),
        canJoin: game.status === 'waiting' && (game.players?.length || 0) < game.maxPlayers,
        players: game.players || [],
      };
    } catch (error) {
      logger.error('Error fetching game by player ID:', error);
      return null;
    }
  }

  public async getPlayerById(playerId: string): Promise<any | null> {
    try {
      const player = await this.databaseProvider.getDatabase().query.players.findFirst({
        where: eq(players.id, playerId),
      });
      return player;
    } catch (error) {
      logger.error('Failed to get player by ID:', error);
      return null;
    }
  }

  public async getAllGames(): Promise<any[]> {
    return await this.getAllGamesFromDatabase(null);
  }

  public async getActiveGames(): Promise<any[]> {
    return await this.getAllGamesFromDatabase(null);
  }

  public async getAllGamesFromDatabase(userId?: string | null): Promise<any[]> {
    try {
      const dbGames = await this.databaseProvider.getDatabase().query.games.findMany({
        where: (games, { inArray }) =>
          inArray(games.status, ['waiting', 'running', 'active', 'paused', 'ended']),
        with: {
          host: {
            columns: {
              username: true,
            },
          },
          players: true,
        },
        orderBy: (games, { desc }) => desc(games.createdAt),
      });

      return dbGames.map(game => {
        // Use connected player count for running/active games, database count for waiting games
        const isRunning = game.status === 'running' || game.status === 'active';
        const connectedCount = isRunning ? this.getConnectedPlayerCount(game.id) : 0;
        const currentPlayers = isRunning ? connectedCount : game.players?.length || 0;

        // Check if the current user is already a player in this game
        const isExistingPlayer = userId && game.players?.some(p => p.userId === userId);

        // User can join if:
        // 1. Game is waiting and has space, OR
        // 2. User is already a player in a game that has not finished
        const canJoin =
          game.status !== 'ended' &&
          (isExistingPlayer ||
            (game.status === 'waiting' && (game.players?.length || 0) < game.maxPlayers));

        return {
          id: game.id,
          name: game.name,
          hostName: game.host?.username || 'Unknown',
          status: game.status === 'ended' ? 'finished' : game.status,
          currentPlayers: currentPlayers,
          maxPlayers: game.maxPlayers,
          currentTurn: game.currentTurn,
          mapSize: `${game.mapWidth}x${game.mapHeight}`,
          createdAt: game.createdAt.toISOString(),
          canJoin: canJoin,
          players: game.players || [],
        };
      });
    } catch (error) {
      logger.error('Error fetching games from database:', error);
      return [];
    }
  }

  public async getGameListForLobby(userId?: string | null): Promise<any[]> {
    // All games come from database now - single source of truth
    return await this.getAllGamesFromDatabase(userId);
  }

  public async getGameById(gameId: string): Promise<any | null> {
    try {
      const game = await this.databaseProvider.getDatabase().query.games.findFirst({
        where: eq(games.id, gameId),
        with: {
          host: {
            columns: {
              username: true,
            },
          },
          players: true,
        },
      });

      if (!game) return null;

      return {
        id: game.id,
        name: game.name,
        hostName: game.host?.username || 'Unknown',
        status: game.status,
        currentPlayers: game.players?.length || 0,
        maxPlayers: game.maxPlayers,
        currentTurn: game.currentTurn,
        mapSize: `${game.mapWidth}x${game.mapHeight}`,
        createdAt: game.createdAt.toISOString(),
        canJoin: game.status === 'waiting' && (game.players?.length || 0) < game.maxPlayers,
        players: game.players || [],
        endGameReport: game.endGameReport,
      };
    } catch (error) {
      logger.error('Error fetching game by ID from database:', error);
      return null;
    }
  }

  /**
   * Update player connection - delegates to PlayerConnectionManager
   */
  public async updatePlayerConnection(playerId: string, isConnected: boolean): Promise<void> {
    // Update local game instance state
    const gameId = this.playerToGame.get(playerId);
    if (!gameId) {
      // Delegate to connection manager
      return this.playerConnectionManager.updatePlayerConnection(playerId, isConnected);
    }

    let gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      if (isConnected) {
        const persistedGame = await this.getGame(gameId);
        if (persistedGame && ['active', 'paused'].includes(persistedGame.status)) {
          gameInstance = (await this.recoverGameInstance(gameId)) ?? undefined;
        }
      }
      if (!gameInstance) {
        return this.playerConnectionManager.updatePlayerConnection(playerId, isConnected);
      }
    }

    const player = gameInstance.players.get(playerId);
    if (!player) {
      // Delegate to connection manager
      return this.playerConnectionManager.updatePlayerConnection(playerId, isConnected);
    }

    // Update player connection state
    this.updatePlayerConnectionState(player, isConnected);

    // Handle game pause if needed
    if (!isConnected) await this.handlePlayerDisconnection(gameInstance, gameId);
    else await this.handlePlayerReconnection(gameInstance, gameId);

    // Delegate to connection manager
    return this.playerConnectionManager.updatePlayerConnection(playerId, isConnected);
  }

  /**
   * Update player connection state and timestamp
   */
  private updatePlayerConnectionState(player: any, isConnected: boolean): void {
    player.isConnected = isConnected;
    player.lastSeen = new Date();
  }

  /**
   * Handle game pause when player disconnects
   */
  private async handlePlayerDisconnection(
    gameInstance: GameInstance,
    gameId: string
  ): Promise<void> {
    if (gameInstance.state !== 'active') {
      return;
    }

    const humanPlayers = Array.from(gameInstance.players.values()).filter(
      player => !player.isAI && player.userId !== null
    );
    const allDisconnected =
      humanPlayers.length > 0 && humanPlayers.every(player => !player.isConnected);

    if (allDisconnected) {
      gameInstance.state = 'paused';
      gameInstance.turnManager.pauseTurnTimer();
      await this.databaseProvider
        .getDatabase()
        .update(games)
        .set({ status: 'paused', pausedAt: new Date(), pauseReason: 'disconnect' })
        .where(eq(games.id, gameId));
      gameInstance.pauseReason = 'disconnect';
      logger.info('Game paused - all players disconnected', { gameId });
    }
  }

  private async handlePlayerReconnection(
    gameInstance: GameInstance,
    gameId: string
  ): Promise<void> {
    if (gameInstance.state !== 'paused' || gameInstance.pauseReason !== 'disconnect') return;
    gameInstance.state = 'active';
    gameInstance.pauseReason = undefined;
    await this.databaseProvider
      .getDatabase()
      .update(games)
      .set({ status: 'active', pausedAt: null, pauseReason: null })
      .where(eq(games.id, gameId));
    gameInstance.turnManager.resumeTurnTimer(gameInstance.config.turnTimeLimit ?? 300);
    logger.info('Game resumed after player reconnect', { gameId });
  }

  public endTurn(playerId: string): Promise<boolean> {
    const gameId = this.playerToGame.get(playerId);
    if (!gameId) {
      return Promise.reject(new Error('Player not in any game'));
    }
    return this.withEndTurnLock(gameId, () => this.endTurnLocked(gameId, playerId));
  }

  private withEndTurnLock<T>(gameId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.endTurnLocks.get(gameId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(operation)
      .finally(() => {
        if (this.endTurnLocks.get(gameId) === next) this.endTurnLocks.delete(gameId);
      });
    this.endTurnLocks.set(gameId, next);
    return next;
  }

  public async concedeGame(playerId: string): Promise<boolean> {
    const gameId = this.playerToGame.get(playerId);
    if (!gameId) throw new Error('Player is not in a game');
    const gameInstance = this.games.get(gameId);
    if (!gameInstance || gameInstance.state !== 'active') throw new Error('Game is not active');
    const player = gameInstance.players.get(playerId);
    if (!player) throw new Error('Player not found in game');
    if (player.hasConceded) return false;

    player.hasConceded = true;
    player.isAlive = false;
    await this.databaseProvider
      .getDatabase()
      .update(players)
      .set({ hasConceded: true, isAlive: false, eliminatedAt: new Date() })
      .where(eq(players.id, playerId));
    return gameInstance.turnManager.evaluateEndGameNow();
  }

  private async endTurnLocked(gameId: string, playerId: string): Promise<boolean> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    if (gameInstance.state !== 'active') {
      throw new Error('Game is not active');
    }

    const player = gameInstance.players.get(playerId);
    if (!player) {
      throw new Error('Player not found in game');
    }

    if (player.hasEndedTurn) {
      return false; // Already ended turn
    }

    player.hasEndedTurn = true;
    await this.databaseProvider
      .getDatabase()
      .update(players)
      .set({ hasEndedTurn: true, lastActionAt: new Date() })
      .where(eq(players.id, playerId));
    logger.info('Player ended turn', { gameId, playerId, turn: gameInstance.currentTurn });

    // Check if all players have ended their turn
    const allPlayersReady = Array.from(gameInstance.players.values())
      // Disconnected humans retain their place until the authoritative timeout.
      .filter(p => !p.isAI && p.userId !== null)
      .every(p => p.hasEndedTurn);

    if (allPlayersReady) {
      // Process the turn using the comprehensive TurnManager system
      // This now handles all aspects: movement reset, unit orders, city production, research, etc.
      await gameInstance.turnManager.processTurn();
      // @reference reference/freeciv/server/srv_main.c:1155-1185,1607-1623
      // TurnManager is the authoritative turn processor. Keep the game
      // instance synchronized so broadcasts, reconnects, and recovery observe
      // the same turn that was persisted by TurnManager.
      gameInstance.currentTurn = gameInstance.turnManager.getCurrentTurn();

      // Reset player turn status for next turn
      for (const player of gameInstance.players.values()) {
        player.hasEndedTurn = false;
      }

      return true; // Turn advanced
    }

    return false; // Waiting for other players
  }

  // Unit management methods - delegates to UnitManagementService
  public async createUnit(
    gameId: string,
    playerId: string,
    unitType: string,
    x: number,
    y: number
  ): Promise<string> {
    return this.unitManagementService.createUnit(gameId, playerId, unitType, x, y);
  }

  public async moveUnit(
    gameId: string,
    playerId: string,
    unitId: string,
    x: number,
    y: number
  ): Promise<boolean> {
    return this.unitManagementService.moveUnit(gameId, playerId, unitId, x, y);
  }

  public async attackUnit(
    gameId: string,
    playerId: string,
    attackerUnitId: string,
    defenderUnitId: string
  ) {
    return this.unitManagementService.attackUnit(gameId, playerId, attackerUnitId, defenderUnitId);
  }

  public async fortifyUnit(gameId: string, playerId: string, unitId: string): Promise<void> {
    return this.unitManagementService.fortifyUnit(gameId, playerId, unitId);
  }

  public getPlayerUnits(gameId: string, playerId: string) {
    return this.unitManagementService.getPlayerUnits(gameId, playerId);
  }

  public getVisibleUnits(gameId: string, playerId: string, visibleTiles?: Set<string>) {
    return this.unitManagementService.getVisibleUnits(gameId, playerId, visibleTiles);
  }

  // Visibility and map methods - delegates to VisibilityMapService
  public getPlayerMapView(gameId: string, playerId: string) {
    return this.visibilityMapService.getPlayerMapView(gameId, playerId);
  }

  public getTileVisibility(gameId: string, playerId: string, x: number, y: number) {
    return this.visibilityMapService.getTileVisibility(gameId, playerId, x, y);
  }

  public updatePlayerVisibility(gameId: string, playerId: string): void {
    this.visibilityMapService.updatePlayerVisibility(gameId, playerId);
  }

  public getMapData(gameId: string) {
    return this.visibilityMapService.getMapData(gameId);
  }

  public getPlayerVisibleTiles(gameId: string, playerId: string) {
    return this.visibilityMapService.getPlayerVisibleTiles(gameId, playerId);
  }

  // City management methods - delegates to CityManagementService
  public async foundCity(
    gameId: string,
    playerId: string,
    name: string,
    x: number,
    y: number,
    unit?: any
  ): Promise<string> {
    return this.cityManagementService.foundCity(gameId, playerId, name, x, y, unit);
  }

  public async setCityProduction(
    gameId: string,
    playerId: string,
    cityId: string,
    production: string,
    type: 'unit' | 'building'
  ): Promise<void> {
    return this.cityManagementService.setCityProduction(gameId, playerId, cityId, production, type);
  }

  public getPlayerCities(gameId: string, playerId: string) {
    return this.cityManagementService.getPlayerCities(gameId, playerId);
  }

  public getCity(gameId: string, cityId: string) {
    return this.cityManagementService.getCity(gameId, cityId);
  }

  // Research management methods - delegates to ResearchManagementService
  public async setPlayerResearch(gameId: string, playerId: string, techId: string): Promise<void> {
    return this.researchManagementService.setPlayerResearch(gameId, playerId, techId);
  }

  public async setResearchGoal(gameId: string, playerId: string, techId: string): Promise<void> {
    return this.researchManagementService.setResearchGoal(gameId, playerId, techId);
  }

  public getPlayerResearch(gameId: string, playerId: string) {
    return this.researchManagementService.getPlayerResearch(gameId, playerId);
  }

  public getAvailableTechnologies(gameId: string, playerId: string) {
    return this.researchManagementService.getAvailableTechnologies(gameId, playerId);
  }

  public getResearchProgress(gameId: string, playerId: string) {
    return this.researchManagementService.getResearchProgress(gameId, playerId);
  }

  public async processResearchTurn(gameId: string): Promise<void> {
    return this.researchManagementService.processResearchTurn(gameId);
  }

  public broadcastUnitInfo(gameId: string, unit: Unit): void {
    this.gameBroadcastManager.broadcastUnitInfo(gameId, unit);
  }

  public broadcastUnitDestroyed(gameId: string, unit: Unit): void {
    this.gameBroadcastManager.broadcastUnitDestroyed(gameId, unit);
  }

  public broadcastNuclearExplosion(gameId: string, event: NuclearPresentationEvent): void {
    this.gameBroadcastManager.broadcastNuclearExplosion(gameId, event);
  }

  public broadcastCityData(gameId: string): void {
    this.gameBroadcastManager.broadcastCityData(gameId);
  }

  public syncGameStateToPlayer(gameId: string, playerId: string): void {
    this.gameBroadcastManager.syncGameStateToPlayer(gameId, playerId);
  }

  public setDebugVisibility(gameId: string, playerId: string, enabled: boolean): boolean {
    return this.gameBroadcastManager.setDebugVisibility(gameId, playerId, enabled);
  }

  /**
   * Get count of connected players for a game
   */
  private getConnectedPlayerCount(gameId: string): number {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) return 0;

    return Array.from(gameInstance.players.values()).filter(p => p.isConnected).length;
  }

  /**
   * Broadcast to game - delegates to GameBroadcastManager
   */
  private broadcastToGame(gameId: string, event: string, data: any): void {
    this.gameBroadcastManager.broadcastToGame(gameId, event, data);
  }

  /**
   * Delete game - delegates to GameLifecycleManager
   */
  public async deleteGame(gameId: string, userId?: string): Promise<void> {
    const gameInstance = this.games.get(gameId);

    // Verify authorization and remove the persisted game before mutating
    // local tracking. This keeps a rejected delete from disrupting a game.
    await this.gameLifecycleManager.deleteGame(gameId, userId);

    // Clean up local tracking
    if (gameInstance) {
      gameInstance.turnManager.clearTurnTimer();
      // Remove from player mappings
      for (const player of gameInstance.players.values()) {
        this.playerToGame.delete(player.id);
        this.playerConnectionManager.removePlayer(player.id);
      }
      this.games.delete(gameId);
    }
    this.sharedVisionByGame.delete(gameId);
    this.hostilePlayersByGame.delete(gameId);
    this.alliedPlayersByGame.delete(gameId);
    this.endTurnLocks.delete(gameId);
  }

  public async setGamePaused(gameId: string, userId: string, paused: boolean): Promise<void> {
    const game = await this.databaseProvider.getDatabase().query.games.findFirst({
      where: eq(games.id, gameId),
    });
    if (!game) throw new Error('Game not found');
    if (game.hostId !== userId) throw new Error('Only the host can pause or resume the game');
    if (!['active', 'paused'].includes(game.status)) {
      throw new Error('Game cannot be paused or resumed in its current state');
    }
    let instance = this.games.get(gameId);
    if (!instance) instance = (await this.recoverGameInstance(gameId)) ?? undefined;
    if (!instance) throw new Error('Unable to load game');

    instance.state = paused ? 'paused' : 'active';
    instance.pauseReason = paused ? 'host' : undefined;
    if (paused) instance.turnManager.pauseTurnTimer();
    else instance.turnManager.resumeTurnTimer(instance.config.turnTimeLimit ?? 300);
    const remainingSeconds = instance.turnManager.getRemainingTurnSeconds();
    await this.databaseProvider
      .getDatabase()
      .update(games)
      .set({
        status: paused ? 'paused' : 'active',
        pausedAt: paused ? new Date() : null,
        pauseReason: paused ? 'host' : null,
        turnDeadlineAt: paused ? null : new Date(Date.now() + (remainingSeconds ?? 0) * 1000),
        pausedTimerSeconds: paused ? remainingSeconds : null,
      })
      .where(eq(games.id, gameId));
    this.broadcastToGame(gameId, 'game-control-changed', { paused });
  }

  public async setTurnTimeLimit(
    gameId: string,
    userId: string,
    turnTimeLimit: number
  ): Promise<void> {
    if (!Number.isInteger(turnTimeLimit) || turnTimeLimit < 10 || turnTimeLimit > 3600) {
      throw new Error('Turn time limit must be between 10 and 3600 seconds');
    }
    const game = await this.databaseProvider.getDatabase().query.games.findFirst({
      where: eq(games.id, gameId),
    });
    if (!game) throw new Error('Game not found');
    if (game.hostId !== userId) throw new Error('Only the host can change the turn timer');
    await this.databaseProvider
      .getDatabase()
      .update(games)
      .set({ turnTimeLimit })
      .where(eq(games.id, gameId));
    const instance = this.games.get(gameId);
    if (instance) {
      instance.config.turnTimeLimit = turnTimeLimit;
      if (instance.state === 'active') instance.turnManager.startTurnTimer(turnTimeLimit);
    }
    this.broadcastToGame(gameId, 'game-control-changed', { turnTimeLimit });
  }

  /**
   * Transfer a civilization between human and native AI control.
   *
   * AI takeover starts with a fresh native strategic state; returning control
   * to a human likewise discards AI-only assignments rather than preserving a
   * compatibility snapshot. Turning the last outstanding human over to the AI
   * immediately releases the authoritative turn barrier.
   *
   * @reference reference/freeciv/server/commands.c:aitoggle_command
   * @reference reference/freeciv/ai/default/classicai.c
   */
  public async setPlayerAIControl(
    gameId: string,
    requesterUserId: string,
    playerId: string,
    isAI: boolean,
    options: { aiLevel?: SettableAILevel; controllerUserId?: string } = {}
  ): Promise<void> {
    const persistedGame = await this.databaseProvider.getDatabase().query.games.findFirst({
      where: eq(games.id, gameId),
    });
    if (!persistedGame) throw new Error('Game not found');
    if (persistedGame.hostId !== requesterUserId) {
      throw new Error('Only the host can transfer player control');
    }
    let game = this.games.get(gameId);
    if (!game) game = (await this.recoverGameInstance(gameId)) ?? undefined;
    if (!game) throw new Error('Unable to load game');
    await this.withEndTurnLock(gameId, () =>
      this.setPlayerAIControlLocked(gameId, requesterUserId, playerId, isAI, options, game)
    );
  }

  private async setPlayerAIControlLocked(
    gameId: string,
    requesterUserId: string,
    playerId: string,
    isAI: boolean,
    options: { aiLevel?: SettableAILevel; controllerUserId?: string },
    game: GameInstance
  ): Promise<void> {
    if (!['waiting', 'active', 'paused'].includes(game.state)) {
      throw new Error('Player control cannot be changed in the current game state');
    }
    const player = game.players.get(playerId);
    if (!player) throw new Error('Player not found in game');
    if (player.isAlive === false || player.hasConceded) {
      throw new Error('Eliminated players cannot change control');
    }

    const aiLevel = isSettableAILevel(options.aiLevel)
      ? options.aiLevel
      : isSettableAILevel(player.aiLevel)
        ? player.aiLevel
        : isSettableAILevel(game.config.aiLevel)
          ? game.config.aiLevel
          : 'easy';
    const controllerUserId = isAI ? player.userId : (options.controllerUserId ?? player.userId);
    if (!isAI && !controllerUserId) {
      throw new Error('Human control requires a controller user');
    }
    if (
      !isAI &&
      Array.from(game.players.values()).some(
        candidate =>
          candidate.id !== playerId && !candidate.isAI && candidate.userId === controllerUserId
      )
    ) {
      throw new Error('Controller already owns another civilization in this game');
    }

    const aiState = createAIState();
    await game.unitManager?.clearPlayerAutomation?.(playerId);
    player.isAI = isAI;
    player.aiLevel = aiLevel;
    player.aiState = aiState as unknown as Record<string, unknown>;
    player.userId = controllerUserId ?? null;
    player.hasEndedTurn = false;
    player.isConnected = !isAI && controllerUserId === requesterUserId;
    await this.databaseProvider
      .getDatabase()
      .update(players)
      .set({
        isAI,
        aiLevel,
        aiState,
        userId: controllerUserId ?? null,
        hasEndedTurn: false,
        connectionStatus: player.isConnected ? 'connected' : 'disconnected',
        lastActionAt: new Date(),
      })
      .where(eq(players.id, playerId));

    this.broadcastToGame(gameId, 'player-control-changed', {
      playerId,
      isAI,
      aiLevel,
    });

    if (
      isAI &&
      game.state === 'active' &&
      Array.from(game.players.values())
        .filter(candidate => !candidate.isAI && candidate.userId !== null)
        .every(candidate => candidate.hasEndedTurn)
    ) {
      await game.turnManager.processTurn();
      game.currentTurn = game.turnManager.getCurrentTurn();
      for (const candidate of game.players.values()) candidate.hasEndedTurn = false;
    }
  }

  public async getAdvisorRecommendations(
    gameId: string,
    userId: string
  ): Promise<AdvisorRecommendations> {
    let game = this.games.get(gameId);
    if (!game) game = (await this.recoverGameInstance(gameId)) ?? undefined;
    if (!game) throw new Error('Unable to load game');
    const player = Array.from(game.players.values()).find(
      candidate => candidate.userId === userId && !candidate.isAI
    );
    if (!player) throw new Error('No human civilization is controlled by this user');
    return this.advisorService.getRecommendations(game, player.id);
  }

  public async cleanupInactiveGames(): Promise<void> {
    const now = new Date();
    const inactiveThreshold = 30 * 60 * 1000; // 30 minutes

    for (const [gameId, gameInstance] of this.games) {
      if (now.getTime() - gameInstance.lastActivity.getTime() > inactiveThreshold) {
        if (
          gameInstance.state === 'waiting' ||
          (gameInstance.state === 'paused' &&
            Array.from(gameInstance.players.values()).every(p => !p.isConnected))
        ) {
          logger.info('Cleaning up inactive game', { gameId });

          // Remove from maps
          for (const player of gameInstance.players.values()) {
            this.playerToGame.delete(player.id);
          }

          // Cleanup managers
          gameInstance.turnManager.clearTurnTimer();
          gameInstance.visibilityManager.cleanup();
          gameInstance.cityManager.cleanup();

          this.games.delete(gameId);
          this.sharedVisionByGame.delete(gameId);
          this.hostilePlayersByGame.delete(gameId);
          this.alliedPlayersByGame.delete(gameId);
          this.endTurnLocks.delete(gameId);

          // Update database
          await this.databaseProvider
            .getDatabase()
            .update(games)
            .set({
              status: 'ended',
              endedAt: new Date(),
            })
            .where(eq(games.id, gameId));

          // Clear Redis cache
          await gameState.clearGameState(gameId);
        }
      }
    }
  }

  /**
   * Emit production completion event to all players in the game
   */
  public emitProductionCompleted(
    gameId: string,
    cityId: string,
    productionType: 'unit' | 'building' | 'wonder',
    productionId: string,
    newUnitId?: string
  ): void {
    logger.info('Production completed', {
      gameId,
      cityId,
      productionType,
      productionId,
      newUnitId,
    });

    // Emit to all players in the game
    this.io.to(`game:${gameId}`).emit('production:completed', {
      cityId,
      productionType,
      productionId,
      newUnitId,
    });
  }

  /**
   * Handle pathfinding request from client
   */
  public async requestPath(
    playerId: string,
    unitId: string,
    targetX: number,
    targetY: number
  ): Promise<{ success: boolean; path?: any; error?: string }> {
    try {
      const gameId = this.playerToGame.get(playerId);
      if (!gameId) {
        return { success: false, error: 'Player not in any game' };
      }

      const gameInstance = this.games.get(gameId);
      if (!gameInstance) {
        return { success: false, error: 'Game not found' };
      }

      if (gameInstance.state !== 'active') {
        return { success: false, error: 'Game is not active' };
      }

      // Get the unit
      const unit = await gameInstance.unitManager.getUnit(unitId);
      if (!unit) {
        return { success: false, error: 'Unit not found' };
      }

      // Verify unit ownership
      if (unit.playerId !== playerId) {
        return { success: false, error: 'Unit does not belong to player' };
      }

      // Request pathfinding
      const pathResult = await gameInstance.pathfindingManager.findPath(unit, targetX, targetY);

      logger.info('Pathfinding request completed', {
        gameId,
        playerId,
        unitId,
        from: { x: unit.x, y: unit.y },
        to: { x: targetX, y: targetY },
        pathFound: pathResult.valid,
        pathLength: pathResult.path.length,
      });

      // Handle the case where pathResult might have unexpected structure
      const tiles = Array.isArray(pathResult.path) ? pathResult.path : [];
      const isValid = pathResult.valid && tiles.length > 0;
      const error = isValid
        ? undefined
        : await this.getPathFailureReason(gameInstance, unit, targetX, targetY);

      return {
        success: isValid,
        path: isValid
          ? {
              unitId,
              targetX,
              targetY,
              tiles: tiles,
              totalCost: pathResult.totalCost || 0,
              estimatedTurns: pathResult.estimatedTurns || 0,
              valid: isValid,
            }
          : undefined,
        error,
      };
    } catch (error) {
      logger.error('Error processing pathfinding request', {
        playerId,
        unitId,
        targetX,
        targetY,
        error: error instanceof Error ? error.message : String(error),
      });

      return { success: false, error: 'Internal server error' };
    }
  }

  private async getPathFailureReason(
    game: GameInstance,
    unit: Unit,
    targetX: number,
    targetY: number
  ): Promise<string> {
    const unitType = this.getGameUnitType(game, unit.unitTypeId);
    const isMilitary = !unitType?.flags?.includes('NonMil') && (unitType?.attack ?? 0) > 0;
    if (!isMilitary) return 'No valid path found';

    const city = game.cityManager.getCityAt(targetX, targetY);
    const targetUnit = game.unitManager
      .getUnitsAt(targetX, targetY)
      .find(candidate => candidate.playerId !== unit.playerId);
    const targetOwner = city?.playerId ?? targetUnit?.playerId;
    if (!targetOwner || targetOwner === unit.playerId) return 'No valid path found';

    const relation = await this.getDiplomaticState(game.id, unit.playerId, targetOwner);
    if (relation === 'war' || relation === 'alliance' || relation === 'team') {
      return 'No valid path found';
    }
    return city
      ? 'Cannot attack unless you declare war first.'
      : `Cannot invade unless you break peace with ${targetOwner} first.`;
  }

  /** Return the authoritative movement range for a player's unit. */
  public async requestMovementRange(
    playerId: string,
    unitId: string
  ): Promise<{
    success: boolean;
    unitId: string;
    movementLeft?: number;
    tiles?: Array<{ x: number; y: number; remainingMovement: number }>;
    error?: string;
  }> {
    try {
      const gameId = this.playerToGame.get(playerId);
      if (!gameId) return { success: false, unitId, error: 'Player not in any game' };

      const gameInstance = this.games.get(gameId);
      if (!gameInstance) return { success: false, unitId, error: 'Game not found' };
      if (gameInstance.state !== 'active') {
        return { success: false, unitId, error: 'Game is not active' };
      }

      const unit = await gameInstance.unitManager.getUnit(unitId);
      if (!unit) return { success: false, unitId, error: 'Unit not found' };
      if (unit.playerId !== playerId) {
        return { success: false, unitId, error: 'Unit does not belong to player' };
      }

      const tiles = gameInstance.pathfindingManager.findAccessibleTiles(unit);
      return { success: true, unitId, movementLeft: unit.movementLeft, tiles };
    } catch (error) {
      logger.error('Error processing movement-range request', {
        playerId,
        unitId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, unitId, error: 'Internal server error' };
    }
  }
}

function getAIDiplomacyReplaySnapshot(game: GameInstance) {
  return Array.from(game.players.values())
    .filter(player => player.isAI)
    .sort(
      (first, second) =>
        first.playerNumber - second.playerNumber || first.id.localeCompare(second.id)
    )
    .map(player => {
      const state = assertAIState(player.aiState);
      return {
        playerId: player.id,
        relations: Object.fromEntries(
          Object.entries(state.diplomacy)
            .sort(([firstId], [secondId]) => firstId.localeCompare(secondId))
            .map(([playerId, memory]) => [
              playerId,
              {
                love: memory.love,
                warDesire: memory.warDesire,
                countdown: memory.countdown,
                ...(memory.lastContactTurn === undefined
                  ? {}
                  : { lastContactTurn: memory.lastContactTurn }),
                ...(memory.warCountdown === undefined ? {} : { warCountdown: memory.warCountdown }),
              },
            ])
        ),
      };
    });
}
