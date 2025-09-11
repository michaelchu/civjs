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

export enum TurnPhase {
  // Phase 0: Setup and preparation
  PHASE_SETUP = 'setup',

  // Phase 1: Begin turn processing
  PHASE_BEGIN_TURN = 'begin_turn',

  // Phase 2: Process player actions from previous turn
  PHASE_PLAYER_ACTIONS = 'player_actions',

  // Phase 3: Automated unit activities (GOTO, patrol, etc.)
  PHASE_UNIT_ACTIVITIES = 'unit_activities',

  // Phase 4: City production and growth
  PHASE_CITY_PRODUCTION = 'city_production',

  // Phase 5: Research and technology
  PHASE_RESEARCH = 'research',

  // Phase 6: Random events and barbarians
  PHASE_RANDOM_EVENTS = 'random_events',

  // Phase 7: AI player actions (future enhancement)
  PHASE_AI_ACTIONS = 'ai_actions',

  // Phase 8: Post-turn coordination
  PHASE_COORDINATION = 'coordination',

  // Phase 9: Statistics and cleanup
  PHASE_STATISTICS = 'statistics',

  // Phase 10: Save and advance
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

  private currentPhase: TurnPhase | null = null;
  private phaseHistory: PhaseResult[] = [];

  constructor(
    gameId: string,
    turnProcessingService: TurnProcessingService,
    turnCoordinationService: TurnCoordinationService,
    turnPacketService: TurnPacketService,
    randomEventsManager?: RandomEventsManager
  ) {
    this.gameId = gameId;
    this.turnProcessingService = turnProcessingService;
    this.turnCoordinationService = turnCoordinationService;
    this.turnPacketService = turnPacketService;
    this.randomEventsManager = randomEventsManager;
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

    // Define processing phases in order
    const phases = [
      TurnPhase.PHASE_SETUP,
      TurnPhase.PHASE_BEGIN_TURN,
      TurnPhase.PHASE_PLAYER_ACTIONS,
      TurnPhase.PHASE_UNIT_ACTIVITIES,
      TurnPhase.PHASE_CITY_PRODUCTION,
      TurnPhase.PHASE_RESEARCH,
      TurnPhase.PHASE_RANDOM_EVENTS,
      TurnPhase.PHASE_AI_ACTIONS,
      TurnPhase.PHASE_COORDINATION,
      TurnPhase.PHASE_STATISTICS,
      TurnPhase.PHASE_SAVE_ADVANCE,
    ];

    try {
      for (const phase of phases) {
        context.phaseStartTime = Date.now();

        const phaseResult = await this.executePhase(phase, context);
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

      logger.info('Multi-phase turn processing completed', {
        gameId: this.gameId,
        turn,
        success: result.success,
        totalDuration: result.totalDuration,
        phasesCompleted: result.phases.filter(p => p.success).length,
      });
    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));
      result.totalDuration = Date.now() - context.startTime;

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
  private async executePhase(phase: TurnPhase, context: PhaseContext): Promise<PhaseResult> {
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

      switch (phase) {
        case TurnPhase.PHASE_SETUP:
          await this.executeSetupPhase(context, phaseResult);
          break;

        case TurnPhase.PHASE_BEGIN_TURN:
          await this.executeBeginTurnPhase(context, phaseResult);
          break;

        case TurnPhase.PHASE_PLAYER_ACTIONS:
          await this.executePlayerActionsPhase(context, phaseResult);
          break;

        case TurnPhase.PHASE_UNIT_ACTIVITIES:
          await this.executeUnitActivitiesPhase(context, phaseResult);
          break;

        case TurnPhase.PHASE_CITY_PRODUCTION:
          await this.executeCityProductionPhase(context, phaseResult);
          break;

        case TurnPhase.PHASE_RESEARCH:
          await this.executeResearchPhase(context, phaseResult);
          break;

        case TurnPhase.PHASE_RANDOM_EVENTS:
          await this.executeRandomEventsPhase(context, phaseResult);
          break;

        case TurnPhase.PHASE_AI_ACTIONS:
          await this.executeAIActionsPhase(context, phaseResult);
          break;

        case TurnPhase.PHASE_COORDINATION:
          await this.executeCoordinationPhase(context, phaseResult);
          break;

        case TurnPhase.PHASE_STATISTICS:
          await this.executeStatisticsPhase(context, phaseResult);
          break;

        case TurnPhase.PHASE_SAVE_ADVANCE:
          await this.executeSaveAdvancePhase(context, phaseResult);
          break;

        default:
          throw new Error(`Unknown phase: ${phase}`);
      }

      phaseResult.success = true;
      phaseResult.duration = Date.now() - phaseStartTime;

      // Send phase completion notification
      this.turnPacketService.sendProcessingStepPacket(phase, this.getPhaseLabel(phase), true);
    } catch (error) {
      phaseResult.success = false;
      phaseResult.duration = Date.now() - phaseStartTime;
      phaseResult.errors.push(error instanceof Error ? error.message : String(error));

      this.turnPacketService.sendTurnProcessingError(
        phase,
        error instanceof Error ? error.message : String(error)
      );
    }

    this.currentPhase = null;
    return phaseResult;
  }

  /**
   * Phase implementations
   */
  private async executeSetupPhase(context: PhaseContext, result: PhaseResult): Promise<void> {
    // Prepare for turn processing
    logger.debug('Setting up turn processing', { gameId: context.gameId, turn: context.turn });

    // Reset phase history
    this.phaseHistory = [];

    // Send freeze client to prevent interactions during processing
    this.turnPacketService.sendFreezeClientPacket('Processing turn...');

    result.playersProcessed = context.playerIds.length;
  }

  private async executeBeginTurnPhase(context: PhaseContext, result: PhaseResult): Promise<void> {
    logger.debug('Executing begin turn phase', { gameId: context.gameId, turn: context.turn });

    // Send NEW_YEAR and BEGIN_TURN packets
    this.turnPacketService.sendTurnStartSequence(context.turn, context.year, 0);

    result.playersProcessed = context.playerIds.length;
  }

  private async executePlayerActionsPhase(
    context: PhaseContext,
    result: PhaseResult
  ): Promise<void> {
    logger.debug('Processing player actions phase', { gameId: context.gameId });

    // This would process queued player actions (already implemented in TurnProcessingService)
    // For now, we'll just log that this phase is working
    result.playersProcessed = context.playerIds.length;
    result.itemsProcessed = 0; // Will be enhanced when action queuing is implemented
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
    for (const playerId of context.playerIds) {
      try {
        const citiesProcessed = await this.turnProcessingService.processCityProduction(playerId);
        totalCitiesProcessed += citiesProcessed;
      } catch (error) {
        result.errors.push(`City production failed for player ${playerId}: ${error}`);
      }
    }

    result.playersProcessed = context.playerIds.length;
    result.itemsProcessed = totalCitiesProcessed;
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

    if (!this.randomEventsManager) {
      logger.debug('RandomEventsManager not configured, skipping random events phase');
      result.playersProcessed = context.playerIds.length;
      result.itemsProcessed = 0;
      return;
    }

    try {
      // Execute Phase 3 random events using the RandomEventsManager
      const eventsResult = await this.randomEventsManager.processRandomEvents(
        context.turn,
        context.year,
        context.playerIds
      );

      result.playersProcessed = context.playerIds.length;
      result.itemsProcessed = eventsResult.totalEvents;
      result.data = {
        duration: eventsResult.duration,
        breakdown: {
          barbarianEvents: eventsResult.barbarianEvents,
          disasterEvents: eventsResult.disasterEvents,
          unitMovements: eventsResult.unitMovements,
          resourceChanges: eventsResult.resourceChanges,
          goodyHutDiscoveries: eventsResult.goodyHutDiscoveries,
        },
        results: eventsResult.results,
      };

      logger.info('Random events phase completed', {
        gameId: context.gameId,
        turn: context.turn,
        totalEvents: eventsResult.totalEvents,
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
    logger.debug('Processing AI actions phase (placeholder)', { gameId: context.gameId });

    // Placeholder for AI player processing
    // This will be implemented when AI players are added
    result.playersProcessed = 0; // No AI players yet
    result.itemsProcessed = 0;
  }

  private async executeCoordinationPhase(
    context: PhaseContext,
    result: PhaseResult
  ): Promise<void> {
    logger.debug('Processing coordination phase', { gameId: context.gameId });

    const coordinationResult = await this.turnCoordinationService.coordinatePostTurnUpdates(
      context.playerIds
    );

    result.playersProcessed = coordinationResult.playersProcessed.length;
    result.itemsProcessed = coordinationResult.bordersRecalculated ? 1 : 0;
    result.errors = coordinationResult.errors.map(e => e.error);
    result.data = coordinationResult;
  }

  private async executeStatisticsPhase(context: PhaseContext, result: PhaseResult): Promise<void> {
    logger.debug('Processing statistics phase', { gameId: context.gameId });

    // Calculate and send turn statistics
    const statistics = {
      turn: context.turn,
      year: context.year,
      playersActive: context.playerIds.length,
      unitsTotal: 0, // TODO: Get from database
      citiesTotal: 0, // TODO: Get from database
      actionsProcessed: this.phaseHistory.reduce((sum, phase) => sum + phase.itemsProcessed, 0),
      processingTimeMs: Date.now() - context.startTime,
    };

    this.turnPacketService.sendTurnStatistics(statistics);

    result.playersProcessed = context.playerIds.length;
    result.itemsProcessed = 1; // One statistics report
    result.data = statistics;
  }

  private async executeSaveAdvancePhase(context: PhaseContext, result: PhaseResult): Promise<void> {
    logger.debug('Processing save and advance phase', { gameId: context.gameId });

    // This phase handles database saving and advancing to next turn
    // The actual implementation will be in TurnManager

    // Send END_TURN packet
    this.turnPacketService.sendEndTurnPacket(context.turn, context.year);

    // Thaw client to re-enable interactions
    this.turnPacketService.sendThawClientPacket('Turn processing complete');

    result.playersProcessed = context.playerIds.length;
    result.itemsProcessed = 1; // One save operation
  }

  /**
   * Get human-readable label for a phase
   */
  private getPhaseLabel(phase: TurnPhase): string {
    const labels: Record<TurnPhase, string> = {
      [TurnPhase.PHASE_SETUP]: 'Setting up turn processing...',
      [TurnPhase.PHASE_BEGIN_TURN]: 'Starting new turn...',
      [TurnPhase.PHASE_PLAYER_ACTIONS]: 'Processing player actions...',
      [TurnPhase.PHASE_UNIT_ACTIVITIES]: 'Processing unit activities...',
      [TurnPhase.PHASE_CITY_PRODUCTION]: 'Processing city production...',
      [TurnPhase.PHASE_RESEARCH]: 'Processing research...',
      [TurnPhase.PHASE_RANDOM_EVENTS]: 'Processing random events...',
      [TurnPhase.PHASE_AI_ACTIONS]: 'Processing AI actions...',
      [TurnPhase.PHASE_COORDINATION]: 'Coordinating updates...',
      [TurnPhase.PHASE_STATISTICS]: 'Calculating statistics...',
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
