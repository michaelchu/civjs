/**
 * @module server/game/managers/TurnManager
 * Coordinates authoritative Turn Manager game state.
 */
import { logger } from '@utils/logger';
import { DatabaseProvider } from '@database';
import { gameTurns, games, players, turnActions } from '@database/schema';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { Server as SocketServer } from 'socket.io';
// PacketType removed - handled by TurnPacketService
import { TurnProcessingService, type PlayerAction } from '@game/services/TurnProcessingService';
import { TurnCoordinationService } from '@game/services/TurnCoordinationService';
import { TurnPacketService } from '@game/services/TurnPacketService';
import { TurnPhaseService } from '@game/services/TurnPhaseService';
import { GameEventService } from '@game/events/GameEventService';
import { CalendarService } from '@game/services/CalendarService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { UnitManager } from '@game/managers/UnitManager';
import type { CityManager } from '@game/managers/CityManager';
import type { ResearchManager } from '@game/managers/ResearchManager';
import type { BorderManager } from '@game/managers/BorderManager';
import type { VisibilityManager } from '@game/managers/VisibilityManager';
import type { CultureManager } from '@game/managers/CultureManager';
import { DisasterManager } from '@game/managers/DisasterManager';
import { BarbarianManager } from '@game/managers/BarbarianManager';
import { RandomEventsManager } from '@game/managers/RandomEventsManager';
import type { GameBroadcastManager } from '@game/orchestrators/GameBroadcastManager';
import type { EconomicManager } from '@game/systems/Economic/EconomicManager';
import type { GovernmentManager } from '@game/managers/GovernmentManager';
import type { DiplomacyReplayEvent } from '@game/managers/DiplomacyManager';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
import { DEFAULT_RULESET } from '@shared/data/rulesets/defaultRuleset';
import { FreecivRandom, generateFreecivGameSeed } from '@game/random/FreecivRandom';
import { FreecivIdentityAllocator } from '@game/random/FreecivIdentityAllocator';
import {
  ClimateManager,
  type ClimateSettings,
  type ClimateState,
} from '@game/services/ClimateManager';

export interface TurnEvent {
  type: 'unit_move' | 'city_production' | 'research_complete' | 'diplomacy' | 'combat';
  playerId: string;
  data: any;
  timestamp: Date;
}

export interface TurnStatistics {
  playersActive: number;
  unitsTotal: number;
  citiesTotal: number;
  actionsProcessed: number;
  processingTimeMs: number;
}

export interface TurnInitializationOptions {
  currentTurn?: number;
  currentYear?: number;
  createTurnRecord?: boolean;
  broadcastTurnStart?: boolean;
}

function getBarbarianRulesetConfig(
  rulesetName: string,
  barbarianRateOverride?: number
): { rate: number; onsetTurn: number; allowHutBarbarians: boolean } {
  const settings = (
    rulesetLoader.loadGameRulesRuleset(rulesetName).settings.set as
      Array<{ name: string; value: unknown }> | undefined
  )?.reduce<Record<string, unknown>>((values, entry) => {
    values[entry.name] = entry.value;
    return values;
  }, {});
  const configuredRate = settings?.barbarians;
  const configuredMode = String(configuredRate ?? 'NORMAL').toUpperCase();
  const namedRates: Record<string, number> = {
    DISABLED: 0,
    HUTS_ONLY: 0,
    NORMAL: 2,
    FREQUENT: 3,
    HORDES: 4,
  };
  const rate =
    typeof configuredRate === 'number'
      ? Math.max(0, Math.min(4, Math.floor(configuredRate)))
      : (namedRates[configuredMode] ?? 2);
  const onsetTurn = typeof settings?.onsetbarbs === 'number' ? settings.onsetbarbs : 60;
  return {
    rate:
      barbarianRateOverride === undefined
        ? rate
        : Math.max(0, Math.min(4, Math.floor(barbarianRateOverride))),
    onsetTurn,
    allowHutBarbarians: configuredMode !== 'DISABLED',
  };
}

export class TurnManager {
  private gameId: string;
  private databaseProvider: DatabaseProvider;
  private io: SocketServer;
  private currentTurn: number = 0;
  private currentYear: number = -4000; // Starting year like Civilization
  private turnEvents: TurnEvent[] = [];
  private turnDiplomacyEvents: DiplomacyReplayEvent[] = [];
  private playerActions: Map<string, PlayerAction[]> = new Map();
  private turnStartTime: Date | null = null;
  private turnTimer: NodeJS.Timeout | null = null;
  private turnDeadline: number | null = null;
  private pausedTimerSeconds: number | null = null;
  private processingPromise: Promise<void> | null = null;
  private processingSignal: AbortSignal | undefined;
  private timerPersistencePromise: Promise<void> = Promise.resolve();
  private onTurnAdvanced?: (turn: number) => void | Promise<void>;
  private endGameEvaluator?: (turn: number, year: number) => Promise<boolean>;
  private replaySnapshotProvider?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  private diplomacyProcessor?: () => Promise<void>;
  private readonly processingOwner = randomUUID();

  // Service dependencies
  private turnProcessingService: TurnProcessingService;
  private turnCoordinationService: TurnCoordinationService;
  private turnPacketService: TurnPacketService;
  private gameEventService: GameEventService;
  private turnPhaseService: TurnPhaseService;
  private calendarService: CalendarService;
  private broadcastManager: GameBroadcastManager;
  private cultureManager: CultureManager;
  private economicManager?: EconomicManager;
  private governmentManager?: GovernmentManager;
  private cityManager: CityManager;
  private unitManager: UnitManager;
  private researchManager: ResearchManager;
  private effectsManager: EffectsManager;
  private visibilityManager: VisibilityManager;
  private climateManager?: ClimateManager;
  private lastClimateState?: ClimateState;

  constructor(
    gameId: string,
    databaseProvider: DatabaseProvider,
    io: SocketServer,
    unitManager: UnitManager,
    cityManager: CityManager,
    researchManager: ResearchManager,
    borderManager: BorderManager,
    visibilityManager: VisibilityManager,
    cultureManager: CultureManager,
    broadcastManager: GameBroadcastManager,
    economicManager?: EconomicManager,
    governmentManager?: GovernmentManager,
    effectsManager: EffectsManager = new EffectsManager(),
    rulesetName: string = DEFAULT_RULESET,
    private readonly random: FreecivRandom = new FreecivRandom(generateFreecivGameSeed()),
    private readonly identities: FreecivIdentityAllocator = new FreecivIdentityAllocator(),
    barbarianRateOverride?: number,
    climateSettings: ClimateSettings = {},
    private readonly runtimePlayers?: Map<string, any>
  ) {
    this.gameId = gameId;
    this.databaseProvider = databaseProvider;
    this.io = io;
    this.cultureManager = cultureManager;
    this.economicManager = economicManager;
    this.governmentManager = governmentManager;
    this.cityManager = cityManager;
    this.unitManager = unitManager;
    this.researchManager = researchManager;
    this.effectsManager = effectsManager;
    this.visibilityManager = visibilityManager;

    // Initialize services
    this.turnProcessingService = new TurnProcessingService(
      gameId,
      unitManager,
      cityManager,
      researchManager,
      economicManager,
      effectsManager,
      (action, errorMessage) => this.persistActionStatus(action, errorMessage)
    );
    this.turnCoordinationService = new TurnCoordinationService(
      gameId,
      borderManager,
      visibilityManager,
      unitManager,
      cityManager
    );
    this.turnPacketService = new TurnPacketService(io, gameId);
    this.gameEventService = new GameEventService(gameId, broadcastManager, databaseProvider);
    this.gameEventService.setPlayerStatsProvider(playerId => ({
      playerId,
      citiesCount: this.cityManager.getPlayerCities(playerId).length,
      unitsCount: this.unitManager.getPlayerUnits(playerId).length,
      technologiesCount: this.researchManager.getResearchedTechs(playerId).length,
      score: 0,
      turn: this.currentTurn,
    }));
    this.broadcastManager = broadcastManager;
    const mapManager =
      typeof (unitManager as any).getMapManager === 'function'
        ? (unitManager as any).getMapManager()
        : {
            getMapData: () => null,
            getTile: () => null,
            getNeighbors: () => [],
            getDistance: (x1: number, y1: number, x2: number, y2: number) =>
              Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
          };
    const disasterManager = new DisasterManager(
      gameId,
      DisasterManager.createRulesetConfig(rulesetName),
      cityManager,
      databaseProvider,
      economicManager,
      random,
      mapManager,
      rulesetName
    );
    const {
      rate: barbarianRate,
      onsetTurn: onsetBarbarian,
      allowHutBarbarians,
    } = getBarbarianRulesetConfig(rulesetName, barbarianRateOverride);
    if (
      typeof mapManager?.getMapData === 'function' &&
      typeof mapManager?.updateTileProperty === 'function'
    ) {
      this.climateManager = new ClimateManager(
        gameId,
        mapManager,
        databaseProvider,
        rulesetName,
        climateSettings,
        (changedGameId, mapData) => this.broadcastManager.broadcastMapData(changedGameId, mapData),
        (changedGameId, event, transformedTiles) =>
          this.io.to(`game:${changedGameId}`).emit('climate_event', {
            gameId: changedGameId,
            event,
            transformedTiles,
          })
      );
    }
    const barbarianManager = new BarbarianManager(
      gameId,
      {
        rate: barbarianRate,
        onsetTurn: onsetBarbarian,
        landBarbarianChance: 100,
        seaBarbarianChance: 100,
        minDistanceFromCity: 3,
        maxDistanceFromCity: 8,
        unitsPerSpawn: { min: 2, max: 4 },
        leaderChance: 100,
        allowHutBarbarians,
      },
      unitManager,
      mapManager,
      broadcastManager,
      databaseProvider,
      random,
      undefined,
      player => this.registerRuntimePlayer(player)
    );
    unitManager.setHutBarbarianProvider?.((_playerId, x, y) =>
      barbarianManager.unleashBarbariansAt(x, y)
    );
    const randomEventsManager = new RandomEventsManager(
      gameId,
      {
        barbarianRate,
        onsetBarbarian,
        disastersEnabled: false,
        disasterFrequency: 0,
        randomMovementsEnabled: true,
        resourceChangesEnabled: false,
        resourceChangeFrequency: 0,
        goodyHutsEnabled: false,
        barbarianHutChance: 0,
      },
      barbarianManager,
      disasterManager,
      unitManager,
      mapManager,
      broadcastManager
    );
    this.turnPhaseService = new TurnPhaseService(
      gameId,
      this.turnProcessingService,
      this.turnCoordinationService,
      this.turnPacketService,
      this.gameEventService,
      randomEventsManager,
      this.cultureManager,
      disasterManager,
      databaseProvider,
      random,
      identities
    );

    this.calendarService = new CalendarService(
      CalendarService.createRulesetConfig(rulesetLoader.getCalendarRules(rulesetName))
    );
  }

  /** Register a player created after turn initialization for future phases. */
  public registerPlayer(playerId: string): void {
    if (this.playerActions.has(playerId)) return;
    this.playerActions.set(playerId, []);
    this.turnProcessingService.initializeActionQueues([playerId]);
  }

  /** Register dynamically-created barbarian owners in the live game state. */
  private registerRuntimePlayer(player: typeof players.$inferSelect): void {
    if (this.runtimePlayers && !this.runtimePlayers.has(player.id)) {
      this.runtimePlayers.set(player.id, {
        id: player.id,
        userId: player.userId,
        isAI: player.isAI,
        aiLevel: player.aiLevel,
        aiTraits: player.aiTraits,
        aiState: player.aiState,
        playerNumber: player.playerNumber,
        civilization: player.civilization,
        nation: player.nation,
        leaderName: player.leaderName,
        color: player.color,
        isAlive: player.isAlive,
        gold: player.gold,
        science: player.science,
        government: player.government,
        history: player.history ?? 0,
        unitsBuilt: player.unitsBuilt ?? 0,
        unitsKilled: player.unitsKilled ?? 0,
        unitsLost: player.unitsLost ?? 0,
        teamId: player.teamId ?? undefined,
        hasConceded: player.hasConceded ?? false,
        spaceshipState: player.spaceshipState,
        isReady: player.isReady,
        hasEndedTurn: player.hasEndedTurn,
        isConnected: player.connectionStatus === 'connected',
        lastSeen: new Date(),
      });
    }
    this.registerPlayer(player.id);
  }

  public async initializeTurn(
    playerIds: string[],
    {
      currentTurn = 1,
      currentYear,
      createTurnRecord = true,
      broadcastTurnStart = true,
    }: TurnInitializationOptions = {}
  ): Promise<void> {
    logger.info('Initializing turn system', { gameId: this.gameId });

    this.currentTurn = currentTurn;
    // Reconstruct the calendar when restoring an existing game so packets and
    // future turn processing continue from the persisted turn rather than turn 1.
    if (currentYear === undefined) {
      for (let turn = 2; turn <= this.currentTurn; turn += 1) {
        this.calendarService.advanceYear(this.getTimelineBonuses(playerIds));
      }
      this.currentYear = this.calendarService.getState().year;
    } else {
      const calendarState = this.calendarService.getState();
      this.calendarService.setState({ ...calendarState, year: currentYear });
      this.currentYear = currentYear;
    }
    this.turnStartTime = new Date();

    // Initialize player actions tracking
    for (const playerId of playerIds) {
      this.playerActions.set(playerId, []);
    }
    this.turnProcessingService.initializeActionQueues(playerIds);

    if (createTurnRecord) await this.createTurnRecord();
    else {
      await this.restoreOrCreateTurnRecord();
      await this.restorePendingActions();
    }

    if (broadcastTurnStart) {
      this.broadcastTurnStart();
    }

    logger.info('Turn system initialized', {
      gameId: this.gameId,
      turn: this.currentTurn,
      year: this.currentYear,
    });
  }

  public processTurn(signal?: AbortSignal): Promise<void> {
    if (this.processingPromise) {
      if (!signal || signal === this.processingSignal) return this.processingPromise;
      return Promise.reject(
        new Error('Cannot join an in-progress turn with a different abort signal')
      );
    }
    this.processingSignal = signal;
    this.processingPromise = this.processTurnInternal(signal).finally(() => {
      this.processingPromise = null;
      this.processingSignal = undefined;
    });
    return this.processingPromise;
  }

  private async processTurnInternal(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    logger.info('Processing turn', { gameId: this.gameId, turn: this.currentTurn });

    const processingTurn = this.currentTurn;
    if (!(await this.claimTurnProcessingLease(processingTurn))) {
      throw new Error(`Turn ${processingTurn} is already being processed`);
    }
    const leaseHeartbeat = setInterval(() => {
      void this.renewTurnProcessingLease(processingTurn);
    }, 30_000);
    leaseHeartbeat.unref();

    try {
      // Clear any existing timer
      if (this.turnTimer) {
        clearTimeout(this.turnTimer);
        this.turnTimer = null;
      }
      this.turnDeadline = null;
      this.persistTimerState(null, null);
      this.turnDiplomacyEvents = [];

      // Get active player IDs
      const playerIds = Array.from(this.playerActions.keys());

      // Use the new TurnPhaseService for comprehensive multi-phase processing
      const phaseResult = await this.turnPhaseService.executePhaseProcessing(
        this.currentTurn,
        this.currentYear,
        playerIds
      );
      signal?.throwIfAborted();

      if (phaseResult.success) {
        logger.info('Turn processed successfully via phase service', {
          gameId: this.gameId,
          turn: this.currentTurn,
          totalDuration: phaseResult.totalDuration,
          phasesCompleted: phaseResult.phases.filter(p => p.success).length,
        });

        await this.processGovernmentTurns(playerIds);
        signal?.throwIfAborted();
        await this.diplomacyProcessor?.();
        signal?.throwIfAborted();
        const climateResult = await this.climateManager?.processTurn();
        signal?.throwIfAborted();
        this.lastClimateState = climateResult?.state ?? this.lastClimateState;
        if (climateResult?.warmingApplied || climateResult?.coolingApplied) {
          this.cityManager.refreshAllTileOccupancy?.();
          this.visibilityManager.updateAllPlayersVisibility(playerIds);
        }

        signal?.throwIfAborted();
        const gameEnded =
          (await this.endGameEvaluator?.(this.currentTurn, this.currentYear)) ?? false;
        // Government, diplomacy, climate, and end-game evaluation can also
        // produce authoritative events after the phase service flushes its
        // queue. Persist those events before finalizing or advancing the turn.
        await this.gameEventService.processQueuedEvents(this.currentTurn, this.currentYear);
        await this.completeTurnRecord(phaseResult);
        if (gameEnded) {
          this.clearTurnTimer();
          return;
        }

        // Advance to next turn after successful processing
        await this.advanceToNextTurn();

        await this.broadcastCultureData(playerIds);

        // Production, growth, research reveals, visibility, units, and borders
        // are all part of the cached player projection. One incremental pass
        // replaces the old full city broadcast plus full playermap snapshot.
        this.broadcastManager.broadcastVisibilityDelta?.(this.gameId, true);
      } else {
        logger.error('Turn processing failed', {
          gameId: this.gameId,
          turn: this.currentTurn,
          errors: phaseResult.errors,
          failedPhases: phaseResult.phases.filter(p => !p.success).map(p => p.phase),
        });
        throw new Error(`Turn processing failed: ${phaseResult.errors.join(', ')}`);
      }
    } catch (error) {
      logger.error('Error processing turn', {
        gameId: this.gameId,
        turn: this.currentTurn,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    } finally {
      clearInterval(leaseHeartbeat);
      await this.releaseTurnProcessingLease(processingTurn);
    }
  }

  private async claimTurnProcessingLease(turn: number): Promise<boolean> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + 90_000);
    const claimed = await this.databaseProvider
      .getDatabase()
      .update(gameTurns)
      .set({
        processingOwner: this.processingOwner,
        processingLeaseExpiresAt: leaseExpiresAt,
      })
      .where(
        and(
          eq(gameTurns.gameId, this.gameId),
          eq(gameTurns.turnNumber, turn),
          or(
            isNull(gameTurns.processingOwner),
            lt(gameTurns.processingLeaseExpiresAt, now),
            eq(gameTurns.processingOwner, this.processingOwner)
          )
        )
      )
      .returning({ id: gameTurns.id });
    return claimed.length === 1;
  }

  private async renewTurnProcessingLease(turn: number): Promise<void> {
    try {
      await this.databaseProvider
        .getDatabase()
        .update(gameTurns)
        .set({ processingLeaseExpiresAt: new Date(Date.now() + 90_000) })
        .where(
          and(
            eq(gameTurns.gameId, this.gameId),
            eq(gameTurns.turnNumber, turn),
            eq(gameTurns.processingOwner, this.processingOwner)
          )
        );
    } catch (error) {
      logger.error('Failed to renew turn processing lease', {
        gameId: this.gameId,
        turn,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private async releaseTurnProcessingLease(turn: number): Promise<void> {
    try {
      await this.databaseProvider
        .getDatabase()
        .update(gameTurns)
        .set({
          processingOwner: null,
          processingLeaseExpiresAt: null,
        })
        .where(
          and(
            eq(gameTurns.gameId, this.gameId),
            eq(gameTurns.turnNumber, turn),
            eq(gameTurns.processingOwner, this.processingOwner)
          )
        );
    } catch (error) {
      logger.warn('Failed to release turn processing lease', {
        gameId: this.gameId,
        turn,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  public async addPlayerAction(playerId: string, action: any): Promise<string> {
    if (!this.playerActions.has(playerId)) {
      this.playerActions.set(playerId, []);
      this.turnProcessingService.initializeActionQueues([playerId]);
    }

    const playerAction: PlayerAction = {
      id:
        action.id ??
        action.requestId ??
        `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: action.type,
      playerId,
      priority: action.priority || 5, // Default priority
      data: action.data || action,
      timestamp: new Date(),
      dependencies: action.dependencies,
      status: 'queued' as const,
    };

    const inserted = await this.databaseProvider
      .getDatabase()
      .insert(turnActions)
      .values({
        id: playerAction.id,
        gameId: this.gameId,
        playerId,
        turnNumber: this.currentTurn,
        actionType: playerAction.type,
        priority: playerAction.priority,
        payload: playerAction.data,
        dependencies: playerAction.dependencies ?? [],
        status: playerAction.status,
        createdAt: playerAction.timestamp,
        updatedAt: playerAction.timestamp,
      })
      .onConflictDoNothing({
        target: [turnActions.gameId, turnActions.turnNumber, turnActions.id],
      })
      .returning({ id: turnActions.id });

    // A stable request ID makes client retries idempotent. Once its durable row
    // exists, do not enqueue the same action a second time.
    if (inserted.length === 0) return playerAction.id;

    this.playerActions.get(playerId)!.push(playerAction);
    this.turnProcessingService.queuePlayerAction(playerAction);

    logger.debug('Added player action', { gameId: this.gameId, playerId, actionType: action.type });
    return playerAction.id;
  }

  private async restorePendingActions(): Promise<void> {
    const persisted = await this.databaseProvider
      .getDatabase()
      .select()
      .from(turnActions)
      .where(
        and(
          eq(turnActions.gameId, this.gameId),
          eq(turnActions.turnNumber, this.currentTurn),
          inArray(turnActions.status, ['queued', 'processing'])
        )
      );

    for (const record of persisted) {
      const action: PlayerAction = {
        id: record.id,
        type: record.actionType as PlayerAction['type'],
        playerId: record.playerId,
        priority: record.priority,
        data: record.payload,
        dependencies: Array.isArray(record.dependencies)
          ? record.dependencies.filter((value): value is string => typeof value === 'string')
          : undefined,
        timestamp: record.createdAt,
        // A process death during execution retries from the durable queued boundary.
        status: 'queued',
      };
      if (!this.playerActions.has(record.playerId)) {
        this.playerActions.set(record.playerId, []);
        this.turnProcessingService.initializeActionQueues([record.playerId]);
      }
      this.playerActions.get(record.playerId)!.push(action);
      this.turnProcessingService.queuePlayerAction(action);
      if (record.status === 'processing') await this.persistActionStatus(action);
    }
  }

  private async persistActionStatus(action: PlayerAction, errorMessage?: string): Promise<void> {
    await this.databaseProvider
      .getDatabase()
      .update(turnActions)
      .set({
        status: action.status,
        errorMessage: errorMessage ?? null,
        updatedAt: new Date(),
        completedAt: ['completed', 'failed', 'cancelled'].includes(action.status)
          ? new Date()
          : null,
      })
      .where(
        and(
          eq(turnActions.gameId, this.gameId),
          eq(turnActions.turnNumber, this.currentTurn),
          eq(turnActions.id, action.id)
        )
      );
  }

  public getCultureManager(): CultureManager {
    return this.cultureManager;
  }

  private async broadcastCultureData(playerIds: string[]): Promise<void> {
    const cultureEntries = await Promise.all(
      playerIds.map(async playerId => {
        const culture = await this.cultureManager.getPlayerCultureInfo(playerId, this.gameId);
        return [
          playerId,
          { history: culture.nationalHistory, totalCulture: culture.totalCulture },
        ] as const;
      })
    );

    this.io.to(`game:${this.gameId}`).emit('culture_updated', {
      gameId: this.gameId,
      players: Object.fromEntries(cultureEntries),
    });
  }

  private async processGovernmentTurns(playerIds: string[]): Promise<void> {
    if (!this.governmentManager) return;
    for (const playerId of playerIds) {
      const completedGovernment = await this.governmentManager.processRevolutionTurn(playerId);
      if (!completedGovernment) continue;
      const runtimePlayer = this.runtimePlayers?.get(playerId);
      if (runtimePlayer) runtimePlayer.government = completedGovernment;
      for (const city of this.cityManager.getPlayerCities(playerId)) {
        this.cityManager.refreshCityWithGovernmentEffects(city.id);
      }
    }
  }

  private setCurrentTurnRecord(turnId: string): void {
    this.turnPhaseService.setCurrentTurnId(turnId);
    this.gameEventService.setCurrentTurnContext(turnId, this.currentTurn, this.currentYear);
  }

  private async restoreOrCreateTurnRecord(): Promise<void> {
    const database = this.databaseProvider.getDatabase();
    const [existing] = await database
      .select({ id: gameTurns.id })
      .from(gameTurns)
      .where(and(eq(gameTurns.gameId, this.gameId), eq(gameTurns.turnNumber, this.currentTurn)));
    if (existing?.id) {
      this.setCurrentTurnRecord(existing.id);
      return;
    }
    await this.createTurnRecord();
  }

  private async createTurnRecord(): Promise<string> {
    const turnData = {
      gameId: this.gameId,
      turnNumber: this.currentTurn,
      year: this.currentYear,
      startedAt: this.turnStartTime!,
      events: [],
      playerActions: {},
      statistics: {},
    };

    const [record] = await this.databaseProvider
      .getDatabase()
      .insert(gameTurns)
      .values(turnData)
      .onConflictDoNothing({
        target: [gameTurns.gameId, gameTurns.turnNumber],
      })
      .returning({ id: gameTurns.id });
    let turnId = record?.id;
    if (!turnId) {
      const [existing] = await this.databaseProvider
        .getDatabase()
        .select({ id: gameTurns.id })
        .from(gameTurns)
        .where(and(eq(gameTurns.gameId, this.gameId), eq(gameTurns.turnNumber, this.currentTurn)));
      turnId = existing?.id;
    }
    if (!turnId) throw new Error('Failed to create authoritative turn record');
    this.setCurrentTurnRecord(turnId);
    logger.debug('Created turn record', { gameId: this.gameId, turn: this.currentTurn });
    return turnId;
  }

  private async completeTurnRecord(phaseResult: {
    totalDuration: number;
    phases: Array<{ phase: string; success: boolean; itemsProcessed: number }>;
  }): Promise<void> {
    const actions = Object.fromEntries(
      Array.from(this.playerActions.entries()).map(([playerId, queuedActions]) => [
        playerId,
        queuedActions,
      ])
    );
    const statistics = {
      processingTimeMs: phaseResult.totalDuration,
      phases: phaseResult.phases.map(phase => ({
        phase: phase.phase,
        success: phase.success,
        itemsProcessed: phase.itemsProcessed,
      })),
    };
    const allUnits = await this.unitManager.getAllUnits();
    const units = allUnits instanceof Map ? Array.from(allUnits.values()) : allUnits;
    const stateSnapshot = {
      version: 2,
      turn: this.currentTurn,
      year: this.currentYear,
      calendar: this.calendarService.getState(),
      cities: this.cityManager.getAllCities(),
      units,
      randomState: this.random.getState(),
      identityNumber: this.identities.getState(),
      research: Object.fromEntries(
        Array.from(this.playerActions.keys()).map(playerId => {
          const research = this.researchManager.getPlayerResearch(playerId);
          return [
            playerId,
            research
              ? {
                  ...research,
                  researchedTechs: Array.from(research.researchedTechs),
                }
              : null,
          ];
        })
      ),
      ...(await this.replaySnapshotProvider?.()),
    };
    await this.databaseProvider
      .getDatabase()
      .update(gameTurns)
      .set({
        events: this.turnEvents,
        playerActions: actions,
        statistics,
        stateSnapshot,
        endedAt: new Date(),
        duration: Math.max(0, Math.round(phaseResult.totalDuration / 1000)),
      })
      .where(and(eq(gameTurns.gameId, this.gameId), eq(gameTurns.turnNumber, this.currentTurn)));
  }

  private async advanceToNextTurn(): Promise<void> {
    this.currentTurn++;

    // Use CalendarService for freeciv-compliant year calculation
    // TODO: Get actual world bonuses from effects system when implemented
    this.calendarService.advanceYear(this.getTimelineBonuses([...this.playerActions.keys()]));
    this.currentYear = this.calendarService.getState().year;

    this.turnStartTime = new Date();
    this.turnEvents = [];
    this.turnDiplomacyEvents = [];
    for (const playerId of this.playerActions.keys()) {
      this.playerActions.set(playerId, []);
    }

    // Reset player turn status
    await this.databaseProvider
      .getDatabase()
      .update(players)
      .set({ hasEndedTurn: false })
      .where(eq(players.gameId, this.gameId));

    // Update game turn counter
    await this.databaseProvider
      .getDatabase()
      .update(games)
      .set({
        currentTurn: this.currentTurn,
        turnStartedAt: this.turnStartTime,
        gameState: sql`coalesce(${games.gameState}, '{}'::jsonb) || ${JSON.stringify({
          randomState: this.random.getState(),
          identityNumber: this.identities.getState(),
        })}::jsonb`,
      })
      .where(eq(games.id, this.gameId));

    // Create new turn record
    await this.createTurnRecord();

    // Notify players
    this.broadcastTurnStart();
    await this.onTurnAdvanced?.(this.currentTurn);

    logger.info('Advanced to next turn', {
      gameId: this.gameId,
      turn: this.currentTurn,
      year: this.currentYear,
    });
  }

  private getTimelineBonuses(playerIds: string[]): {
    turnYears: number;
    turnFragments: number;
    slowDownTimeline: number;
  } {
    const playerTechs = new Set(
      playerIds.flatMap(playerId => this.researchManager.getResearchedTechs?.(playerId) ?? [])
    );
    const context = {
      currentYear: this.calendarService.getState().year,
      playerTechs,
    };
    return {
      turnYears: this.effectsManager.calculateEffect(EffectType.TURN_YEARS, context).value,
      turnFragments: this.effectsManager.calculateEffect(EffectType.TURN_FRAGMENTS, context).value,
      slowDownTimeline: this.effectsManager.calculateEffect(EffectType.SLOW_DOWN_TIMELINE, context)
        .value,
    };
  }

  private broadcastTurnStart(): void {
    // Use TurnPacketService for proper packet protocol with calendar fragment support
    const calendarState = this.calendarService.getState();
    this.turnPacketService.sendTurnStartSequence(
      this.currentTurn,
      this.currentYear,
      calendarState.fragmentCount // fragments from CalendarService
    );

    // Keep legacy emit for backward compatibility
    this.io.emit('turn-started', {
      gameId: this.gameId,
      turn: this.currentTurn,
      year: this.currentYear,
      startTime: this.turnStartTime,
    });
  }

  public getCurrentTurn(): number {
    return this.currentTurn;
  }

  public getCurrentYear(): number {
    return this.currentYear;
  }

  public getGameEventService(): GameEventService {
    return this.gameEventService;
  }

  public getCalendarService(): CalendarService {
    return this.calendarService;
  }

  public getFormattedCalendar(): string {
    return this.calendarService.formatCalendar();
  }

  public getTurnEvents(): TurnEvent[] {
    return [...this.turnEvents];
  }

  public recordDiplomacyEvent(event: DiplomacyReplayEvent): void {
    const key = JSON.stringify(event);
    if (this.turnDiplomacyEvents.some(existing => JSON.stringify(existing) === key)) return;
    this.turnDiplomacyEvents.push(event);
  }

  public getTurnDiplomacyEvents(): DiplomacyReplayEvent[] {
    return this.turnDiplomacyEvents.map(event => ({
      ...event,
      playerIds: [event.playerIds[0], event.playerIds[1]],
    }));
  }

  public startTurnTimer(timeLimit: number): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
    }
    if (timeLimit <= 0) return;

    this.turnDeadline = Date.now() + timeLimit * 1000;
    this.pausedTimerSeconds = null;
    this.persistTimerState(new Date(this.turnDeadline), null);
    this.turnTimer = setTimeout(async () => {
      logger.info('Turn time limit reached, auto-processing turn', {
        gameId: this.gameId,
        turn: this.currentTurn,
      });

      try {
        await this.processTurn();
      } catch (error) {
        logger.error('Error in auto turn processing', {
          gameId: this.gameId,
          error: error instanceof Error ? error.message : error,
        });
      }
    }, timeLimit * 1000);

    logger.debug('Turn timer started', { gameId: this.gameId, timeLimit });
  }

  public clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      logger.debug('Turn timer cleared', { gameId: this.gameId });
    }
    this.turnTimer = null;
    this.turnDeadline = null;
    this.pausedTimerSeconds = null;
    this.persistTimerState(null, null);
  }

  public pauseTurnTimer(): void {
    if (!this.turnTimer || !this.turnDeadline) return;
    const remainingSeconds = Math.max(1, Math.ceil((this.turnDeadline - Date.now()) / 1000));
    clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnDeadline = null;
    this.pausedTimerSeconds = remainingSeconds;
    this.persistTimerState(null, remainingSeconds);
  }

  public resumeTurnTimer(defaultTimeLimit: number): void {
    const remainingSeconds = this.pausedTimerSeconds ?? defaultTimeLimit;
    this.startTurnTimer(remainingSeconds);
  }

  public restoreTurnTimer(
    deadline: Date | string | null | undefined,
    pausedSeconds: number | null | undefined,
    defaultTimeLimit: number
  ): void {
    if (pausedSeconds && pausedSeconds > 0) {
      this.pausedTimerSeconds = pausedSeconds;
      return;
    }
    if (!deadline) {
      this.startTurnTimer(defaultTimeLimit);
      return;
    }
    const remainingSeconds = Math.max(
      1,
      Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000)
    );
    this.startTurnTimer(remainingSeconds);
  }

  public getRemainingTurnSeconds(): number | null {
    if (this.pausedTimerSeconds !== null) return this.pausedTimerSeconds;
    if (this.turnDeadline === null) return null;
    return Math.max(1, Math.ceil((this.turnDeadline - Date.now()) / 1000));
  }

  private persistTimerState(deadline: Date | null, pausedSeconds: number | null): void {
    this.timerPersistencePromise = this.timerPersistencePromise
      .then(async () => {
        await this.databaseProvider
          .getDatabase()
          .update(games)
          .set({ turnDeadlineAt: deadline, pausedTimerSeconds: pausedSeconds })
          .where(eq(games.id, this.gameId));
      })
      .catch(error => {
        logger.warn('Failed to persist turn timer state', {
          gameId: this.gameId,
          error: error instanceof Error ? error.message : error,
        });
      });
  }

  public setTurnAdvancedCallback(callback: (turn: number) => void | Promise<void>): void {
    this.onTurnAdvanced = callback;
  }

  public setDiplomacyProcessor(callback: () => Promise<void>): void {
    this.diplomacyProcessor = callback;
  }

  public setEndGameEvaluator(evaluator: (turn: number, year: number) => Promise<boolean>): void {
    this.endGameEvaluator = evaluator;
  }

  public setReplaySnapshotProvider(
    provider: () => Record<string, unknown> | Promise<Record<string, unknown>>
  ): void {
    this.replaySnapshotProvider = provider;
  }

  public async evaluateEndGameNow(): Promise<boolean> {
    return (await this.endGameEvaluator?.(this.currentTurn, this.currentYear)) ?? false;
  }

  /**
   * Get current turn processing phase (Phase 2 enhancement)
   */
  public getCurrentPhase(): string | null {
    return this.turnPhaseService.getCurrentPhase();
  }

  public getClimateState(): ClimateState | undefined {
    return this.lastClimateState ? { ...this.lastClimateState } : undefined;
  }

  public setAIProcessor(processor: () => Promise<number>): void {
    this.turnPhaseService.setAIProcessor(processor);
  }

  public setWorkerAutomationProcessor(processor: () => Promise<number>): void {
    this.turnPhaseService.setWorkerAutomationProcessor(processor);
  }

  /**
   * Get economic manager for economic operations
   */
  public getEconomicManager(): EconomicManager | undefined {
    return this.economicManager;
  }

  /**
   * Get turn phase processing history (Phase 2 enhancement)
   */
  public getPhaseHistory(): any[] {
    return this.turnPhaseService.getPhaseHistory();
  }
}
