import { logger } from '@utils/logger';
import { DatabaseProvider } from '@database';
import { gameState } from '@database/redis';
import { gameTurns, games, players } from '@database/schema';
import { and, eq } from 'drizzle-orm';
import { Server as SocketServer } from 'socket.io';
// PacketType removed - handled by TurnPacketService
import { TurnProcessingService, type PlayerAction } from '@game/services/TurnProcessingService';
import { TurnCoordinationService } from '@game/services/TurnCoordinationService';
import { TurnPacketService } from '@game/services/TurnPacketService';
import { TurnPhaseService } from '@game/services/TurnPhaseService';
import { GameEventService } from '@game/services/GameEventService';
import { CalendarService } from '@game/services/CalendarService';
import type { UnitManager } from '@game/managers/UnitManager';
import type { CityManager } from '@game/managers/CityManager';
import type { ResearchManager } from '@game/managers/ResearchManager';
import type { BorderManager } from '@game/managers/BorderManager';
import type { VisibilityManager } from '@game/managers/VisibilityManager';
import type { CultureManager } from '@game/managers/CultureManager';
import type { GameBroadcastManager } from '@game/orchestrators/GameBroadcastManager';
import type { EconomicManager } from '@game/systems/Economic/EconomicManager';
import type { GovernmentManager } from '@game/managers/GovernmentManager';
import { EffectsManager } from '@game/managers/EffectsManager';

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
  createTurnRecord?: boolean;
  broadcastTurnStart?: boolean;
}

export class TurnManager {
  private gameId: string;
  private databaseProvider: DatabaseProvider;
  private io: SocketServer;
  private currentTurn: number = 0;
  private currentYear: number = -4000; // Starting year like Civilization
  private turnEvents: TurnEvent[] = [];
  private playerActions: Map<string, PlayerAction[]> = new Map();
  private turnStartTime: Date | null = null;
  private turnTimer: NodeJS.Timeout | null = null;
  private turnDeadline: number | null = null;
  private pausedTimerSeconds: number | null = null;
  private processingPromise: Promise<void> | null = null;
  private onTurnAdvanced?: (turn: number) => void | Promise<void>;
  private endGameEvaluator?: (turn: number, year: number) => Promise<boolean>;

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
    effectsManager: EffectsManager = new EffectsManager()
  ) {
    this.gameId = gameId;
    this.databaseProvider = databaseProvider;
    this.io = io;
    this.cultureManager = cultureManager;
    this.economicManager = economicManager;
    this.governmentManager = governmentManager;
    this.cityManager = cityManager;

    // Initialize services
    this.turnProcessingService = new TurnProcessingService(
      gameId,
      unitManager,
      cityManager,
      researchManager,
      economicManager,
      effectsManager
    );
    this.turnCoordinationService = new TurnCoordinationService(
      gameId,
      borderManager,
      visibilityManager,
      unitManager,
      cityManager
    );
    this.turnPacketService = new TurnPacketService(io, gameId);
    this.gameEventService = new GameEventService(gameId, broadcastManager);
    this.broadcastManager = broadcastManager;
    this.turnPhaseService = new TurnPhaseService(
      gameId,
      this.turnProcessingService,
      this.turnCoordinationService,
      this.turnPacketService,
      this.gameEventService,
      undefined, // randomEventsManager - not passed yet
      this.cultureManager
    );

    // Initialize calendar service with default configuration
    // Can be enhanced to support different calendar types in game settings
    this.calendarService = new CalendarService(CalendarService.createDefaultConfig());
  }

  public async initializeTurn(
    playerIds: string[],
    {
      currentTurn = 1,
      createTurnRecord = true,
      broadcastTurnStart = true,
    }: TurnInitializationOptions = {}
  ): Promise<void> {
    logger.info('Initializing turn system', { gameId: this.gameId });

    this.currentTurn = currentTurn;
    // Reconstruct the calendar when restoring an existing game so packets and
    // future turn processing continue from the persisted turn rather than turn 1.
    for (let turn = 2; turn <= this.currentTurn; turn += 1) {
      this.calendarService.advanceYear({
        turnYears: this.getYearIncrementForTurn(turn),
        turnFragments: 0,
        slowDownTimeline: 0,
      });
    }
    this.currentYear = this.calendarService.getState().year;
    this.turnStartTime = new Date();

    // Initialize player actions tracking
    for (const playerId of playerIds) {
      this.playerActions.set(playerId, []);
    }

    if (createTurnRecord) {
      await this.createTurnRecord();
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

  public processTurn(): Promise<void> {
    if (this.processingPromise) return this.processingPromise;
    this.processingPromise = this.processTurnInternal().finally(() => {
      this.processingPromise = null;
    });
    return this.processingPromise;
  }

  private async processTurnInternal(): Promise<void> {
    logger.info('Processing turn', { gameId: this.gameId, turn: this.currentTurn });

    try {
      // Clear any existing timer
      if (this.turnTimer) {
        clearTimeout(this.turnTimer);
        this.turnTimer = null;
      }

      // Get active player IDs
      const playerIds = Array.from(this.playerActions.keys());

      // Use the new TurnPhaseService for comprehensive multi-phase processing
      const phaseResult = await this.turnPhaseService.executePhaseProcessing(
        this.currentTurn,
        this.currentYear,
        playerIds
      );

      if (phaseResult.success) {
        logger.info('Turn processed successfully via phase service', {
          gameId: this.gameId,
          turn: this.currentTurn,
          totalDuration: phaseResult.totalDuration,
          phasesCompleted: phaseResult.phases.filter(p => p.success).length,
        });

        await this.processGovernmentTurns(playerIds);

        await this.completeTurnRecord(phaseResult);
        if (await this.endGameEvaluator?.(this.currentTurn, this.currentYear)) {
          this.clearTurnTimer();
          return;
        }

        // Advance to next turn after successful processing
        await this.advanceToNextTurn();

        await this.broadcastCultureData(playerIds);

        // Broadcast updated city data to all players with current production rates
        this.broadcastManager.broadcastCityData(this.gameId);
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
    }
  }

  public addPlayerAction(playerId: string, action: any): void {
    if (!this.playerActions.has(playerId)) {
      this.playerActions.set(playerId, []);
    }

    const playerAction: PlayerAction = {
      id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: action.type,
      playerId,
      priority: action.priority || 5, // Default priority
      data: action.data || action,
      timestamp: new Date(),
      dependencies: action.dependencies,
      status: 'queued' as const,
    };

    this.playerActions.get(playerId)!.push(playerAction);

    logger.debug('Added player action', { gameId: this.gameId, playerId, actionType: action.type });
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
      for (const city of this.cityManager.getPlayerCities(playerId)) {
        this.cityManager.refreshCityWithGovernmentEffects(city.id);
      }
    }
  }

  private async createTurnRecord(): Promise<void> {
    const turnData = {
      gameId: this.gameId,
      turnNumber: this.currentTurn,
      year: this.currentYear,
      startedAt: this.turnStartTime!,
      events: [],
      playerActions: {},
      statistics: {},
    };

    await this.databaseProvider.getDatabase().insert(gameTurns).values(turnData);
    logger.debug('Created turn record', { gameId: this.gameId, turn: this.currentTurn });
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
    await this.databaseProvider
      .getDatabase()
      .update(gameTurns)
      .set({
        events: this.turnEvents,
        playerActions: actions,
        statistics,
        stateSnapshot: {
          version: 1,
          turn: this.currentTurn,
          year: this.currentYear,
        },
        endedAt: new Date(),
        duration: Math.max(0, Math.round(phaseResult.totalDuration / 1000)),
      })
      .where(and(eq(gameTurns.gameId, this.gameId), eq(gameTurns.turnNumber, this.currentTurn)));
  }

  private async advanceToNextTurn(): Promise<void> {
    this.currentTurn++;

    // Use CalendarService for freeciv-compliant year calculation
    // TODO: Get actual world bonuses from effects system when implemented
    this.calendarService.advanceYear({
      turnYears: this.getYearIncrementForTurn(this.currentTurn),
      turnFragments: 0, // No fragments for default config
      slowDownTimeline: 0, // No slowdown effect active
    });
    this.currentYear = this.calendarService.getState().year;

    this.turnStartTime = new Date();
    this.turnEvents = [];
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
      })
      .where(eq(games.id, this.gameId));

    // Update Redis cache
    await gameState.setGameState(this.gameId, {
      currentTurn: this.currentTurn,
      year: this.currentYear,
      turnStartedAt: this.turnStartTime,
    });

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

  private getYearIncrementForTurn(turn: number): number {
    // Civilization-style year progression - return increment per turn, not absolute year
    if (turn <= 75) return 40; // 40 years per turn (4000 BC - 1000 BC)
    if (turn <= 175) return 20; // 20 years per turn (1000 BC - 1000 AD)
    if (turn <= 275) return 10; // 10 years per turn (1000 AD - 2000 AD)
    return 5; // 5 years per turn (2000 AD+)
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

  public startTurnTimer(timeLimit: number): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
    }
    if (timeLimit <= 0) return;

    this.turnDeadline = Date.now() + timeLimit * 1000;
    this.pausedTimerSeconds = null;
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
      this.turnTimer = null;
      this.turnDeadline = null;
      logger.debug('Turn timer cleared', { gameId: this.gameId });
    }
  }

  public pauseTurnTimer(): void {
    if (!this.turnTimer || !this.turnDeadline) return;
    const remainingSeconds = Math.max(1, Math.ceil((this.turnDeadline - Date.now()) / 1000));
    clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnDeadline = null;
    this.pausedTimerSeconds = remainingSeconds;
  }

  public resumeTurnTimer(defaultTimeLimit: number): void {
    const remainingSeconds = this.pausedTimerSeconds ?? defaultTimeLimit;
    this.startTurnTimer(remainingSeconds);
  }

  public setTurnAdvancedCallback(callback: (turn: number) => void | Promise<void>): void {
    this.onTurnAdvanced = callback;
  }

  public setEndGameEvaluator(evaluator: (turn: number, year: number) => Promise<boolean>): void {
    this.endGameEvaluator = evaluator;
  }

  /**
   * Get current turn processing phase (Phase 2 enhancement)
   */
  public getCurrentPhase(): string | null {
    return this.turnPhaseService.getCurrentPhase();
  }

  public setAIProcessor(processor: () => Promise<number>): void {
    this.turnPhaseService.setAIProcessor(processor);
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
