/**
 * TurnPhaseService - Manages multi-phase turn processing
 *
 * This service implements the freeciv-style turn phases where different
 * game systems are processed in a specific order to ensure consistency
 * and proper game mechanics implementation.
 *
 * @reference freeciv/server/srv_main.c - begin_turn() phase processing
 * @reference freeciv-web/javascript/packhand.js - turn phase handling
 */

import { logger } from '@utils/logger';
import type { TurnProcessingService } from './TurnProcessingService';
import type { TurnCoordinationService } from './TurnCoordinationService';
import type { TurnPacketService } from './TurnPacketService';
import type { RandomEventsManager } from '@game/managers/RandomEventsManager';
import type { DisasterManager } from '@game/managers/DisasterManager';
import type { CultureManager } from '@game/managers/CultureManager';
import { GameEventService, GameEventType } from '@game/events/GameEventService';
import type { DatabaseProvider } from '@database';
import { turnPhases, NewTurnPhase } from '@database/schema/turn-phases';
import { and, eq } from 'drizzle-orm';
import { FreecivRandom, isFreecivRandomState } from '@game/random/FreecivRandom';
import { FreecivIdentityAllocator } from '@game/random/FreecivIdentityAllocator';

export enum TurnPhase {
  // Phase 1: Begin turn processing
  // @reference freeciv/server/srv_main.c begin_turn()
  PHASE_BEGIN_TURN = 'begin_turn',

  // Phase 2: Process player actions from previous turn
  // @reference freeciv/server/srv_main.c action processing
  PHASE_PLAYER_ACTIONS = 'player_actions',

  // Phase 3: Automated unit activities (GOTO, patrol, etc.)
  // @reference freeciv/server/srv_main.c:1394 random_movements()
  PHASE_UNIT_ACTIVITIES = 'unit_activities',

  // Phase 4: City production and growth
  // @reference freeciv/server/cityturn.c city_turn()
  PHASE_CITY_PRODUCTION = 'city_production',

  // Phase 5: Culture processing and accumulation
  // @reference freeciv/server/cityturn.c:3703 city_history_gain(), plrhand.c:3530 nation_history_gain()
  PHASE_CULTURE_PROCESSING = 'culture_processing',

  // Phase 6: Research and technology
  // @reference freeciv/server/techtools.c tech advancement
  PHASE_RESEARCH = 'research',

  // Phase 7: AI player actions
  // @reference freeciv/server/srv_main.c AI player processing
  PHASE_AI_ACTIONS = 'ai_actions',

  // Phase 8: Random events and barbarians
  // @reference freeciv/server/srv_main.c:1668 summon_barbarians(), 1684 check_disasters()
  PHASE_RANDOM_EVENTS = 'random_events',

  // Phase 9: Border calculation
  // @reference freeciv/server/srv_main.c:end_turn() map_calculate_borders()
  PHASE_BORDER_CALCULATION = 'border_calculation',

  // Phase 10: End turn cleanup
  // @reference freeciv/server/srv_main.c end_turn()
  PHASE_END_TURN = 'end_turn',

  // Phase 11: Statistics and save
  // @reference freeciv/server/srv_main.c turn advancement and save
  PHASE_SAVE_ADVANCE = 'save_advance',
}

export interface PhaseContext {
  gameId: string;
  turn: number;
  year: number;
  playerIds: string[];
  startTime: number;
  phaseStartTime: number;
}

export interface PhaseResult {
  phase: TurnPhase;
  success: boolean;
  duration: number;
  playersProcessed: number;
  itemsProcessed: number;
  errors: string[];
  data?: any;
}

export interface TurnPhaseResult {
  turn: number;
  year: number;
  totalDuration: number;
  phases: PhaseResult[];
  success: boolean;
  errors: string[];
}

export class TurnPhaseService {
  private gameId: string;
  private turnProcessingService: TurnProcessingService;
  private turnCoordinationService: TurnCoordinationService;
  private turnPacketService: TurnPacketService;
  private randomEventsManager?: RandomEventsManager;
  private disasterManager?: DisasterManager;
  private cultureManager?: CultureManager;
  private gameEventService: GameEventService;
  private aiProcessor?: () => Promise<number>;
  private workerAutomationProcessor?: () => Promise<number>;

  private currentPhase: TurnPhase | null = null;
  private phaseHistory: PhaseResult[] = [];
  private currentTurnId: string | null = null;

  constructor(
    gameId: string,
    turnProcessingService: TurnProcessingService,
    turnCoordinationService: TurnCoordinationService,
    turnPacketService: TurnPacketService,
    gameEventService: GameEventService,
    randomEventsManager?: RandomEventsManager,
    cultureManager?: CultureManager,
    disasterManager?: DisasterManager,
    private readonly databaseProvider?: DatabaseProvider,
    private readonly random?: FreecivRandom,
    private readonly identities?: FreecivIdentityAllocator
  ) {
    this.gameId = gameId;
    this.turnProcessingService = turnProcessingService;
    this.turnCoordinationService = turnCoordinationService;
    this.turnPacketService = turnPacketService;
    this.gameEventService = gameEventService;
    this.randomEventsManager = randomEventsManager;
    this.cultureManager = cultureManager;
    this.disasterManager = disasterManager;

    // Register built-in event handlers for turn processing
    this.registerBuiltInEventHandlers();
  }

  /**
   * Register built-in event handlers for turn processing
   * @reference freeciv/server/srv_main.c script hook registration
   */
  private registerBuiltInEventHandlers(): void {
    // Turn begin handler - logs turn start
    this.gameEventService.registerEventHandler({
      id: 'turn_begin_logger',
      eventType: GameEventType.TURN_BEGIN,
      priority: 1, // Low priority
      handler: async event => {
        logger.info('Turn processing begun', {
          gameId: this.gameId,
          turn: event.data.turn,
          year: event.data.year,
          playerCount: event.data.playerIds?.length || 0,
        });
        return true;
      },
      description: 'Logs turn begin events for monitoring',
    });

    // Turn end handler - logs turn completion
    this.gameEventService.registerEventHandler({
      id: 'turn_end_logger',
      eventType: GameEventType.TURN_END,
      priority: 1, // Low priority
      handler: async event => {
        logger.info('Turn processing completed', {
          gameId: this.gameId,
          turn: event.data.turn,
          year: event.data.year,
          duration: event.data.processingDuration,
          eventsProcessed: event.data.eventsProcessed,
          achievementsUnlocked: event.data.achievementsUnlocked,
        });
        return true;
      },
      description: 'Logs turn end events for monitoring',
    });

    // Phase change handler - tracks phase transitions
    this.gameEventService.registerEventHandler({
      id: 'phase_transition_tracker',
      eventType: GameEventType.PHASE_END,
      priority: 2, // Normal priority
      handler: async event => {
        logger.debug('Phase completed', {
          gameId: this.gameId,
          turn: event.data.turn,
          phase: event.data.phase,
          duration: event.data.duration,
          playersProcessed: event.data.playersProcessed,
          itemsProcessed: event.data.itemsProcessed,
        });
        return true;
      },
      description: 'Tracks phase transitions for performance monitoring',
    });
  }

  /**
   * Set the current turn ID for database tracking
   */
  setCurrentTurnId(turnId: string): void {
    this.currentTurnId = turnId;
  }

  setAIProcessor(processor: () => Promise<number>): void {
    this.aiProcessor = processor;
  }

  setWorkerAutomationProcessor(processor: () => Promise<number>): void {
    this.workerAutomationProcessor = processor;
  }

  /**
   * Create a new turn phase record in the database
   */
  private async getOrCreatePhaseRecord(
    phase: TurnPhase,
    phaseOrder: number
  ): Promise<{ id: string; completed?: PhaseResult }> {
    if (!this.currentTurnId) {
      throw new Error('Turn ID must be set before creating phase records');
    }

    if (!this.databaseProvider) throw new Error('Database provider is required for phase tracking');
    const database = this.databaseProvider.getDatabase();
    const [existing] = await database
      .select()
      .from(turnPhases)
      .where(and(eq(turnPhases.turnId, this.currentTurnId), eq(turnPhases.phase, phase)));
    if (existing) return this.resolveExistingPhaseRecord(database, existing, phase);

    const phaseRecord: NewTurnPhase = {
      gameId: this.gameId,
      turnId: this.currentTurnId,
      phase,
      phaseOrder,
      status: 'running',
      startedAt: new Date(),
      phaseData: {},
      playersProcessed: 0,
      unitsProcessed: 0,
      citiesProcessed: 0,
      actionsProcessed: 0,
    };

    const [inserted] = await database
      .insert(turnPhases)
      .values(phaseRecord)
      .onConflictDoNothing({
        target: [turnPhases.turnId, turnPhases.phase],
      })
      .returning({ id: turnPhases.id });
    if (inserted?.id) return { id: inserted.id };

    // Another worker won the unique checkpoint insert. Resolve that row through
    // the same completed/failed rules instead of executing an untracked phase.
    return this.getOrCreatePhaseRecord(phase, phaseOrder);
  }

  private async resolveExistingPhaseRecord(
    database: any,
    existing: any,
    phase: TurnPhase
  ): Promise<{ id: string; completed?: PhaseResult }> {
    if (existing.status === 'completed' && existing.success)
      return {
        id: existing.id,
        completed: {
          phase,
          success: true,
          duration: existing.duration ?? 0,
          playersProcessed: existing.playersProcessed,
          itemsProcessed: this.phaseItemsProcessed(existing),
          errors: [],
          data:
            existing.phaseData && typeof existing.phaseData === 'object' ? existing.phaseData : {},
        },
      };
    await database
      .update(turnPhases)
      .set({
        status: 'running',
        success: null,
        errorMessage: null,
        startedAt: new Date(),
        completedAt: null,
      })
      .where(eq(turnPhases.id, existing.id));
    return { id: existing.id };
  }

  /**
   * Update a phase record with execution results
   */
  private async updatePhaseRecord(
    phaseId: string,
    result: PhaseResult,
    startTime: Date,
    endTime: Date
  ): Promise<void> {
    if (!this.databaseProvider) throw new Error('Database provider is required for phase tracking');
    await this.databaseProvider
      .getDatabase()
      .update(turnPhases)
      .set(this.getPhaseUpdate(result, startTime, endTime))
      .where(eq(turnPhases.id, phaseId));
  }

  private getPhaseUpdate(result: PhaseResult, startTime: Date, endTime: Date): any {
    const counts = this.phaseCounts(result);
    const phaseData = {
      ...(result.data || {}),
      itemsProcessed: result.itemsProcessed,
      ...counts,
      ...this.authoritativeCheckpoint(result.success),
    };
    return {
      status: result.success ? 'completed' : 'failed',
      startedAt: startTime,
      completedAt: endTime,
      duration: result.duration,
      success: result.success,
      errorMessage: result.errors.join('; ') || null,
      phaseData,
      playersProcessed: result.playersProcessed,
      ...counts,
    };
  }

  private phaseItemsProcessed(phase: {
    phaseData?: unknown;
    actionsProcessed?: number;
    unitsProcessed?: number;
    citiesProcessed?: number;
  }): number {
    const phaseData = phase.phaseData;
    if (
      phaseData &&
      typeof phaseData === 'object' &&
      typeof (phaseData as { itemsProcessed?: unknown }).itemsProcessed === 'number'
    ) {
      return (phaseData as { itemsProcessed: number }).itemsProcessed;
    }
    return (
      (phase.actionsProcessed ?? 0) + (phase.unitsProcessed ?? 0) + (phase.citiesProcessed ?? 0)
    );
  }

  private phaseCounts(result: PhaseResult): {
    unitsProcessed: number;
    citiesProcessed: number;
    actionsProcessed: number;
  } {
    const data = result.data ?? {};
    const phaseUsesUnits = [TurnPhase.PHASE_BEGIN_TURN, TurnPhase.PHASE_UNIT_ACTIVITIES].includes(
      result.phase
    );
    const phaseUsesCities = result.phase === TurnPhase.PHASE_CITY_PRODUCTION;
    const phaseUsesActions = [TurnPhase.PHASE_PLAYER_ACTIONS, TurnPhase.PHASE_AI_ACTIONS].includes(
      result.phase
    );
    return {
      unitsProcessed:
        typeof data.unitsProcessed === 'number'
          ? data.unitsProcessed
          : phaseUsesUnits
            ? result.itemsProcessed
            : 0,
      citiesProcessed:
        typeof data.citiesProcessed === 'number'
          ? data.citiesProcessed
          : phaseUsesCities
            ? result.itemsProcessed
            : 0,
      actionsProcessed:
        typeof data.actionsProcessed === 'number'
          ? data.actionsProcessed
          : phaseUsesActions
            ? result.itemsProcessed
            : 0,
    };
  }

  private authoritativeCheckpoint(success: boolean): Record<string, unknown> {
    if (!success) return {};
    return {
      ...(this.random ? { randomState: this.random.getState() } : {}),
      ...(this.identities ? { identityNumber: this.identities.getState() } : {}),
    };
  }

  private restoreAuthoritativeCheckpoint(data: any): void {
    const randomState = data?.randomState;
    if (this.random && isFreecivRandomState(randomState)) this.random.setState(randomState);
    const identityNumber = data?.identityNumber;
    if (this.identities && Number.isInteger(identityNumber)) {
      this.identities.setState(identityNumber);
    }
  }

  /**
   * Execute complete multi-phase turn processing
   * @reference freeciv/server/srv_main.c begin_turn()
   */
  async executePhaseProcessing(
    turn: number,
    year: number,
    playerIds: string[]
  ): Promise<TurnPhaseResult> {
    const context: PhaseContext = {
      gameId: this.gameId,
      turn,
      year,
      playerIds,
      startTime: Date.now(),
      phaseStartTime: Date.now(),
    };

    const result: TurnPhaseResult = {
      turn,
      year,
      totalDuration: 0,
      phases: [],
      success: true,
      errors: [],
    };

    logger.info('Starting multi-phase turn processing', {
      gameId: this.gameId,
      turn,
      year,
      playerCount: playerIds.length,
    });

    // Emit turn begin event
    // @reference freeciv/server/srv_main.c script_server_signal_emit("turn_begin")
    this.gameEventService.emitEvent(GameEventType.TURN_BEGIN, {
      turn,
      year,
      playerIds,
    });

    // Define processing phases in freeciv-compliant order
    // @reference freeciv/server/srv_main.c begin_turn() and end_turn() sequence
    const phases = [
      TurnPhase.PHASE_BEGIN_TURN,
      TurnPhase.PHASE_PLAYER_ACTIONS,
      TurnPhase.PHASE_UNIT_ACTIVITIES,
      TurnPhase.PHASE_CITY_PRODUCTION,
      TurnPhase.PHASE_CULTURE_PROCESSING,
      TurnPhase.PHASE_RESEARCH,
      TurnPhase.PHASE_AI_ACTIONS,
      TurnPhase.PHASE_RANDOM_EVENTS,
      TurnPhase.PHASE_BORDER_CALCULATION,
      TurnPhase.PHASE_END_TURN,
      TurnPhase.PHASE_SAVE_ADVANCE,
    ];

    try {
      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i];
        context.phaseStartTime = Date.now();

        const phaseRecord = await this.getOrCreatePhaseRecord(phase, i + 1);
        if (phaseRecord.completed) {
          this.restoreAuthoritativeCheckpoint(phaseRecord.completed.data);
          result.phases.push(phaseRecord.completed);
          logger.info('Skipping durably completed turn phase', {
            gameId: this.gameId,
            turn,
            phase,
          });
          continue;
        }

        const phaseResult = await this.executePhase(phase, context, phaseRecord.id);
        result.phases.push(phaseResult);

        if (!phaseResult.success) {
          result.success = false;
          result.errors.push(`Phase ${phase} failed: ${phaseResult.errors.join(', ')}`);
          logger.error('Turn phase failed', {
            gameId: this.gameId,
            turn,
            phase,
            errors: phaseResult.errors,
          });
          // The begin-turn phase freezes clients before later phases run. If
          // any phase fails, the normal end-turn phase is skipped, so thaw
          // explicitly or clients can remain stuck in the processing overlay.
          this.turnPacketService.sendThawClientPacket('Turn processing failed');
          break;
        }

        logger.debug('Turn phase completed', {
          gameId: this.gameId,
          turn,
          phase,
          duration: phaseResult.duration,
          playersProcessed: phaseResult.playersProcessed,
        });
      }

      result.totalDuration = Date.now() - context.startTime;

      // Emit turn end event
      // @reference freeciv/server/srv_main.c script_server_signal_emit("turn_end")
      this.gameEventService.emitEvent(GameEventType.TURN_END, {
        turn,
        year,
        playerIds,
        processingDuration: result.totalDuration,
        phasesCompleted: result.phases.filter(p => p.success).length,
        eventsProcessed: 0,
        achievementsUnlocked: 0,
      });

      // Persist every event, including TURN_END, against this turn.
      const eventResult = await this.gameEventService.processQueuedEvents(turn, year);
      logger.debug('Turn events processed', {
        gameId: this.gameId,
        turn,
        ...eventResult,
      });

      logger.info('Multi-phase turn processing completed', {
        gameId: this.gameId,
        turn,
        success: result.success,
        totalDuration: result.totalDuration,
        phasesCompleted: result.phases.filter(p => p.success).length,
        eventsProcessed: eventResult.eventsProcessed,
        achievementsUnlocked: eventResult.achievementsUnlocked,
      });
    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));
      result.totalDuration = Date.now() - context.startTime;

      // A failure before PHASE_END_TURN still needs to release the client
      // freeze. This is also safe when the failure occurred before freezing.
      this.turnPacketService.sendThawClientPacket('Turn processing failed');

      logger.error('Critical error in turn phase processing', {
        gameId: this.gameId,
        turn,
        error: error instanceof Error ? error.message : error,
      });
    }

    return result;
  }

  /**
   * Execute a specific turn phase
   */
  private async executePhase(
    phase: TurnPhase,
    context: PhaseContext,
    phaseId?: string | null
  ): Promise<PhaseResult> {
    this.currentPhase = phase;

    const phaseResult: PhaseResult = {
      phase,
      success: false,
      duration: 0,
      playersProcessed: 0,
      itemsProcessed: 0,
      errors: [],
    };

    const phaseStartTime = Date.now();

    try {
      // Send phase start notification
      this.turnPacketService.sendProcessingStepPacket(phase, this.getPhaseLabel(phase), false);

      // Emit phase start event
      // @reference freeciv/server/srv_main.c phase-specific event hooks
      this.gameEventService.emitEvent(GameEventType.PHASE_START, {
        turn: context.turn,
        year: context.year,
        phase,
        phaseLabel: this.getPhaseLabel(phase),
      });

      await this.executePhaseHandler(phase, context, phaseResult);

      phaseResult.success = phaseResult.errors.length === 0;
      phaseResult.duration = Date.now() - phaseStartTime;

      // A completed checkpoint is authoritative. If it cannot be written, the
      // phase must fail visibly instead of allowing the turn to advance.
      if (phaseId) {
        await this.updatePhaseRecord(phaseId, phaseResult, new Date(phaseStartTime), new Date());
      }

      // Emit phase end event
      // @reference freeciv/server/srv_main.c phase completion event hooks
      this.gameEventService.emitEvent(GameEventType.PHASE_END, {
        turn: context.turn,
        year: context.year,
        phase,
        phaseLabel: this.getPhaseLabel(phase),
        duration: phaseResult.duration,
        playersProcessed: phaseResult.playersProcessed,
        itemsProcessed: phaseResult.itemsProcessed,
        success: true,
      });

      // Send phase completion notification
      this.turnPacketService.sendProcessingStepPacket(phase, this.getPhaseLabel(phase), true);
    } catch (error) {
      phaseResult.success = false;
      phaseResult.duration = Date.now() - phaseStartTime;
      phaseResult.errors.push(error instanceof Error ? error.message : String(error));

      // Update database record with failure
      if (phaseId) {
        try {
          await this.updatePhaseRecord(phaseId, phaseResult, new Date(phaseStartTime), new Date());
        } catch (dbError) {
          logger.warn('Failed to update failed phase database record', {
            gameId: this.gameId,
            turn: context.turn,
            phase,
            error: dbError instanceof Error ? dbError.message : dbError,
          });
        }
      }

      this.turnPacketService.sendTurnProcessingError(
        phase,
        error instanceof Error ? error.message : String(error)
      );
    }

    this.currentPhase = null;
    return phaseResult;
  }

  private async executePhaseHandler(
    phase: TurnPhase,
    context: PhaseContext,
    result: PhaseResult
  ): Promise<void> {
    const handlers: Partial<Record<TurnPhase, () => Promise<void>>> = {
      [TurnPhase.PHASE_BEGIN_TURN]: () => this.executeBeginTurnPhase(context, result),
      [TurnPhase.PHASE_PLAYER_ACTIONS]: () => this.executePlayerActionsPhase(context, result),
      [TurnPhase.PHASE_UNIT_ACTIVITIES]: () => this.executeUnitActivitiesPhase(context, result),
      [TurnPhase.PHASE_CITY_PRODUCTION]: () => this.executeCityProductionPhase(context, result),
      [TurnPhase.PHASE_CULTURE_PROCESSING]: () =>
        this.executeCultureProcessingPhase(context, result),
      [TurnPhase.PHASE_RESEARCH]: () => this.executeResearchPhase(context, result),
      [TurnPhase.PHASE_AI_ACTIONS]: () => this.executeAIActionsPhase(context, result),
      [TurnPhase.PHASE_RANDOM_EVENTS]: () => this.executeRandomEventsPhase(context, result),
      [TurnPhase.PHASE_BORDER_CALCULATION]: () =>
        this.executeBorderCalculationPhase(context, result),
      [TurnPhase.PHASE_END_TURN]: () => this.executeEndTurnPhase(context, result),
      [TurnPhase.PHASE_SAVE_ADVANCE]: () => this.executeSaveAdvancePhase(context, result),
    };
    const handler = handlers[phase];
    if (!handler) throw new Error(`Unknown phase: ${phase}`);
    await handler();
  }

  /**
   * Phase implementations
   */
  private async executeBeginTurnPhase(context: PhaseContext, result: PhaseResult): Promise<void> {
    // Combined begin turn setup and initialization (freeciv begin_turn())
    logger.debug('Executing begin turn phase', { gameId: context.gameId, turn: context.turn });

    // Reset phase history for new turn
    this.phaseHistory = [];

    // Send freeze client to prevent interactions during processing
    this.turnPacketService.sendFreezeClientPacket('Processing turn...');

    // Reset movement points for all units at the start of the turn
    // @reference freeciv/server/srv_main.c begin_turn() - unit movement point restoration
    let totalUnitsReset = 0;
    for (const playerId of context.playerIds) {
      try {
        const unitsReset = await this.turnProcessingService.resetPlayerUnitMovement(playerId);
        totalUnitsReset += unitsReset;
      } catch (error) {
        result.errors.push(`Movement reset failed for player ${playerId}: ${error}`);
      }
    }

    logger.debug('Unit movement points reset', {
      gameId: context.gameId,
      turn: context.turn,
      totalUnitsReset,
    });

    // Note: Turn start packets (NEW_YEAR, BEGIN_TURN) are sent by TurnManager after processing completes
    // This avoids race conditions with the turn overlay UI

    result.playersProcessed = context.playerIds.length;
    result.itemsProcessed = totalUnitsReset;
  }

  private async executePlayerActionsPhase(
    context: PhaseContext,
    result: PhaseResult
  ): Promise<void> {
    logger.debug('Processing player actions phase', { gameId: context.gameId });

    try {
      // Initialize action queues if not already done
      this.turnProcessingService.initializeActionQueues(context.playerIds);

      // Process all queued player actions from the current turn
      const actionResult = await this.turnProcessingService.processQueuedPlayerActions();

      result.playersProcessed = context.playerIds.length;
      result.itemsProcessed = actionResult.actionsProcessed;
      result.errors = actionResult.errors.map(e => `${e.playerId}: ${e.error}`);
      result.data = {
        actionsProcessed: actionResult.actionsProcessed,
        unitsProcessed: actionResult.unitsProcessed,
        citiesProcessed: actionResult.citiesProcessed,
        researchUpdated: actionResult.researchUpdated,
      };

      if (actionResult.errors.length > 0) {
        logger.warn('Player action errors occurred', {
          gameId: context.gameId,
          errorCount: actionResult.errors.length,
          errors: actionResult.errors,
        });
      }
    } catch (error) {
      logger.error('Error processing player actions phase', {
        gameId: context.gameId,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  private async executeUnitActivitiesPhase(
    context: PhaseContext,
    result: PhaseResult
  ): Promise<void> {
    logger.debug('Processing unit activities phase', { gameId: context.gameId });

    let totalUnitsProcessed = 0;
    for (const playerId of context.playerIds) {
      try {
        const unitsProcessed = await this.turnProcessingService.processUnitOrders(playerId);
        totalUnitsProcessed += unitsProcessed;
      } catch (error) {
        result.errors.push(`Unit processing failed for player ${playerId}: ${error}`);
      }
    }

    result.playersProcessed = context.playerIds.length;
    result.itemsProcessed = totalUnitsProcessed;
  }

  private async executeCityProductionPhase(
    context: PhaseContext,
    result: PhaseResult
  ): Promise<void> {
    logger.debug('Processing city production phase', { gameId: context.gameId });

    let totalCitiesProcessed = 0;
    const CITY_PRODUCTION_TIMEOUT = 60000; // 60 second timeout per player

    for (const playerId of context.playerIds) {
      const playerStartTime = Date.now();
      let timeout: ReturnType<typeof setTimeout> | undefined;

      try {
        // Create timeout promise
        const timeoutPromise = new Promise<number>((_, reject) => {
          timeout = setTimeout(() => {
            reject(
              new Error(
                `City production processing timed out for player ${playerId} after ${CITY_PRODUCTION_TIMEOUT}ms`
              )
            );
          }, CITY_PRODUCTION_TIMEOUT);
          timeout.unref?.();
        });

        // Race between processing and timeout
        const processingPromise = this.turnProcessingService.processCityProduction(
          playerId,
          context.turn
        );

        const citiesProcessed = await Promise.race([processingPromise, timeoutPromise]);
        totalCitiesProcessed += citiesProcessed;

        // Process economics after city production (following Freeciv pattern)
        // @reference freeciv/server/cityturn.c - economic calculations after city production
        try {
          const economicsProcessed = await this.turnProcessingService.processPlayerEconomics(
            playerId,
            context.turn
          );

          if (economicsProcessed) {
            logger.debug('Economics processed for player', {
              gameId: context.gameId,
              playerId,
              turn: context.turn,
            });
          }
        } catch (economicError) {
          logger.warn('Economic processing failed for player', {
            gameId: context.gameId,
            playerId,
            turn: context.turn,
            error: economicError instanceof Error ? economicError.message : economicError,
          });
          // Don't fail the entire turn for economic errors - they're not critical
        }

        const processingTime = Date.now() - playerStartTime;
        logger.debug('City production and economics completed for player', {
          gameId: context.gameId,
          playerId,
          citiesProcessed,
          processingTime,
        });
      } catch (error) {
        const processingTime = Date.now() - playerStartTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.error('City production failed for player', {
          gameId: context.gameId,
          playerId,
          processingTime,
          error: errorMessage,
        });

        result.errors.push(`City production failed for player ${playerId}: ${errorMessage}`);

        // Continue processing other players even if one fails
        continue;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    result.playersProcessed = context.playerIds.length;
    result.itemsProcessed = totalCitiesProcessed;
  }

  /**
   * Execute culture processing phase - accumulate city and player culture/history
   *
   * Direct port of freeciv culture system processing
   * Reference: freeciv/server/cityturn.c:3703 city_history_gain(), plrhand.c:3530 nation_history_gain()
   */
  private async executeCultureProcessingPhase(
    context: PhaseContext,
    result: PhaseResult
  ): Promise<void> {
    logger.debug('Processing culture phase', { gameId: context.gameId });

    if (!this.cultureManager) {
      logger.warn('CultureManager not configured, skipping culture processing phase');
      result.playersProcessed = context.playerIds.length;
      result.itemsProcessed = 0;
      return;
    }

    try {
      // Process culture gain for all cities and players in the game
      // This handles both city history gain and national history gain
      await this.cultureManager.processCultureGain(context.gameId);

      result.playersProcessed = context.playerIds.length;
      result.itemsProcessed = 1; // One processing operation for the entire game

      logger.debug('Culture processing completed', {
        gameId: context.gameId,
        turn: context.turn,
        playersProcessed: result.playersProcessed,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Culture processing failed', {
        gameId: context.gameId,
        turn: context.turn,
        error: errorMessage,
      });

      result.errors.push(`Culture processing failed: ${errorMessage}`);
      result.playersProcessed = context.playerIds.length;
      result.itemsProcessed = 0;
    }
  }

  private async executeResearchPhase(context: PhaseContext, result: PhaseResult): Promise<void> {
    logger.debug('Processing research phase', { gameId: context.gameId });

    let techsCompleted = 0;
    for (const playerId of context.playerIds) {
      try {
        const completed = await this.turnProcessingService.processResearch(playerId);
        if (completed) techsCompleted++;
      } catch (error) {
        result.errors.push(`Research processing failed for player ${playerId}: ${error}`);
      }
    }

    result.playersProcessed = context.playerIds.length;
    result.itemsProcessed = techsCompleted;
  }

  private async executeRandomEventsPhase(
    context: PhaseContext,
    result: PhaseResult
  ): Promise<void> {
    logger.debug('Processing random events phase', { gameId: context.gameId });

    if (!this.randomEventsManager && !this.disasterManager) {
      logger.debug('No random-event consumers configured, skipping random events phase');
      result.playersProcessed = context.playerIds.length;
      result.itemsProcessed = 0;
      return;
    }

    try {
      const eventsResult = this.randomEventsManager
        ? await this.randomEventsManager.processRandomEvents(
            context.turn,
            context.year,
            context.playerIds
          )
        : {
            totalEvents: 0,
            duration: 0,
            barbarianEvents: 0,
            disasterEvents: 0,
            unitMovements: 0,
            resourceChanges: 0,
            goodyHutDiscoveries: 0,
            results: [],
          };
      const disasters = this.disasterManager
        ? (
            await Promise.all(
              context.playerIds.map(playerId =>
                this.disasterManager!.checkPlayerDisasters(playerId, context.turn, context.year)
              )
            )
          ).flat()
        : [];
      const disasterResults = disasters.map(disaster => ({
        eventType: 'city_disaster',
        success: disaster.success,
        playersAffected: [] as string[],
        details: disaster,
        timestamp: disaster.timestamp,
      }));
      const totalEvents = eventsResult.totalEvents + disasters.length;

      result.playersProcessed = context.playerIds.length;
      result.itemsProcessed = totalEvents;
      result.data = {
        duration: eventsResult.duration,
        breakdown: {
          barbarianEvents: eventsResult.barbarianEvents,
          disasterEvents: eventsResult.disasterEvents + disasters.length,
          unitMovements: eventsResult.unitMovements,
          resourceChanges: eventsResult.resourceChanges,
          goodyHutDiscoveries: eventsResult.goodyHutDiscoveries,
        },
        results: [...eventsResult.results, ...disasterResults],
      };

      logger.info('Random events phase completed', {
        gameId: context.gameId,
        turn: context.turn,
        totalEvents,
        duration: eventsResult.duration,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error in random events phase', {
        gameId: context.gameId,
        turn: context.turn,
        error: errorMessage,
      });

      result.playersProcessed = context.playerIds.length;
      result.itemsProcessed = 0;
      throw error; // Re-throw to be handled by phase processing
    }
  }

  private async executeAIActionsPhase(context: PhaseContext, result: PhaseResult): Promise<void> {
    logger.debug('Processing AI actions through CivJS adapter', { gameId: context.gameId });
    const aiActions = this.aiProcessor ? await this.aiProcessor() : 0;
    // Freeciv runs the server-side autoworker agent after normal activity
    // progress. Human workers use the same planner/executor as AI workers but
    // run here so newly started work receives no extra progress tick.
    const workerActions = this.workerAutomationProcessor
      ? await this.workerAutomationProcessor()
      : 0;
    result.itemsProcessed = aiActions + workerActions;
    result.playersProcessed = result.itemsProcessed > 0 ? 1 : 0;
    result.data = { aiActions, workerActions };
  }

  private async executeBorderCalculationPhase(
    context: PhaseContext,
    result: PhaseResult
  ): Promise<void> {
    // Border recalculation - moved to correct freeciv timing (end_turn)
    logger.debug('Processing border calculation phase', { gameId: context.gameId });

    try {
      const coordinationResult = await this.turnCoordinationService.coordinatePostTurnUpdates(
        context.playerIds
      );

      result.playersProcessed = coordinationResult.playersProcessed.length;
      result.itemsProcessed = coordinationResult.bordersRecalculated ? 1 : 0;
      result.errors = coordinationResult.errors.map(e => e.error);
      result.data = { bordersRecalculated: coordinationResult.bordersRecalculated };
    } catch (error) {
      logger.error('Error in border calculation phase', {
        gameId: context.gameId,
        error: error instanceof Error ? error.message : error,
      });
      result.errors.push(`Border calculation failed: ${error}`);
    }
  }

  private async executeEndTurnPhase(context: PhaseContext, result: PhaseResult): Promise<void> {
    // End turn cleanup and finalization (freeciv end_turn())
    logger.debug('Processing end turn phase', { gameId: context.gameId });

    // Clear animation state for end of turn (freeciv-web compatibility)
    try {
      await this.turnCoordinationService.clearAnimationState();
    } catch (error) {
      logger.warn('Failed to clear animation state', {
        gameId: context.gameId,
        error: error instanceof Error ? error.message : error,
      });
    }

    // Calculate real turn statistics from game managers
    const basicStatistics = await this.turnCoordinationService.calculateTurnStatistics(
      context.turn,
      context.year,
      context.playerIds,
      this.phaseHistory.reduce((sum, phase) => sum + phase.itemsProcessed, 0),
      Date.now() - context.startTime
    );

    // Add turn and year to statistics for packet service
    const statistics = {
      turn: context.turn,
      year: context.year,
      ...basicStatistics,
    };

    this.turnPacketService.sendTurnStatistics(statistics);

    // Send END_TURN packet
    this.turnPacketService.sendEndTurnPacket(context.turn, context.year);

    // Thaw client to re-enable interactions
    logger.info('About to send THAW_CLIENT packet', {
      gameId: context.gameId,
      turn: context.turn,
    });
    this.turnPacketService.sendThawClientPacket('Turn processing complete');
    logger.info('THAW_CLIENT packet sent', {
      gameId: context.gameId,
      turn: context.turn,
    });

    result.playersProcessed = context.playerIds.length;
    result.itemsProcessed = 1; // One end turn processed
    result.data = statistics;
  }

  private async executeSaveAdvancePhase(context: PhaseContext, result: PhaseResult): Promise<void> {
    logger.debug('Processing save and advance phase', { gameId: context.gameId });

    // This phase handles database saving and turn advancement
    // The actual saving will be handled by TurnManager after phase processing completes

    logger.info('Turn phase processing completed', {
      gameId: context.gameId,
      turn: context.turn,
      year: context.year,
      totalDuration: Date.now() - context.startTime,
    });

    result.playersProcessed = context.playerIds.length;
    result.itemsProcessed = 1; // One save/advance operation queued
  }

  /**
   * Get human-readable label for a phase
   */
  private getPhaseLabel(phase: TurnPhase): string {
    const labels: Record<TurnPhase, string> = {
      [TurnPhase.PHASE_BEGIN_TURN]: 'Starting new turn...',
      [TurnPhase.PHASE_PLAYER_ACTIONS]: 'Processing player actions...',
      [TurnPhase.PHASE_UNIT_ACTIVITIES]: 'Processing unit activities...',
      [TurnPhase.PHASE_CITY_PRODUCTION]: 'Processing city production...',
      [TurnPhase.PHASE_CULTURE_PROCESSING]: 'Processing culture...',
      [TurnPhase.PHASE_RESEARCH]: 'Processing research...',
      [TurnPhase.PHASE_AI_ACTIONS]: 'Processing AI actions...',
      [TurnPhase.PHASE_RANDOM_EVENTS]: 'Processing random events...',
      [TurnPhase.PHASE_BORDER_CALCULATION]: 'Calculating borders...',
      [TurnPhase.PHASE_END_TURN]: 'Finalizing turn...',
      [TurnPhase.PHASE_SAVE_ADVANCE]: 'Saving and advancing...',
    };

    return labels[phase] || `Processing ${phase}...`;
  }

  /**
   * Get current processing phase
   */
  getCurrentPhase(): TurnPhase | null {
    return this.currentPhase;
  }

  /**
   * Get phase processing history
   */
  getPhaseHistory(): PhaseResult[] {
    return [...this.phaseHistory];
  }
}
