import { logger } from '@utils/logger';
import { DatabaseProvider } from '@database';
import { gameState } from '@database/redis';
import { gameTurns, games, players } from '@database/schema';
import { eq } from 'drizzle-orm';
import { Server as SocketServer } from 'socket.io';
// PacketType removed - handled by TurnPacketService
import { TurnProcessingService, type PlayerAction } from '@game/services/TurnProcessingService';
import { TurnCoordinationService } from '@game/services/TurnCoordinationService';
import { TurnPacketService } from '@game/services/TurnPacketService';
import type { UnitManager } from '@game/managers/UnitManager';
import type { CityManager } from '@game/managers/CityManager';
import type { ResearchManager } from '@game/managers/ResearchManager';
import type { BorderManager } from '@game/managers/BorderManager';
import type { VisibilityManager } from '@game/managers/VisibilityManager';

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

  // Service dependencies
  private turnProcessingService: TurnProcessingService;
  private turnCoordinationService: TurnCoordinationService;
  private turnPacketService: TurnPacketService;

  constructor(
    gameId: string,
    databaseProvider: DatabaseProvider,
    io: SocketServer,
    unitManager: UnitManager,
    cityManager: CityManager,
    researchManager: ResearchManager,
    borderManager: BorderManager,
    visibilityManager: VisibilityManager
  ) {
    this.gameId = gameId;
    this.databaseProvider = databaseProvider;
    this.io = io;

    // Initialize services
    this.turnProcessingService = new TurnProcessingService(
      gameId,
      unitManager,
      cityManager,
      researchManager
    );
    this.turnCoordinationService = new TurnCoordinationService(
      gameId,
      borderManager,
      visibilityManager,
      unitManager
    );
    this.turnPacketService = new TurnPacketService(io, gameId);
  }

  public async initializeTurn(playerIds: string[]): Promise<void> {
    logger.info('Initializing turn system', { gameId: this.gameId });

    this.currentTurn = 1;
    this.currentYear = -4000;
    this.turnStartTime = new Date();

    // Initialize player actions tracking
    for (const playerId of playerIds) {
      this.playerActions.set(playerId, []);
    }

    // Create initial turn record
    await this.createTurnRecord();

    // Notify players of turn start
    this.broadcastTurnStart();

    logger.info('Turn system initialized', {
      gameId: this.gameId,
      turn: this.currentTurn,
      year: this.currentYear,
    });
  }

  public async processTurn(): Promise<void> {
    logger.info('Processing turn', { gameId: this.gameId, turn: this.currentTurn });

    const startTime = Date.now();

    try {
      // Clear any existing timer
      if (this.turnTimer) {
        clearTimeout(this.turnTimer);
        this.turnTimer = null;
      }

      // Use TurnPacketService for coordinated processing steps
      const processingSteps = [
        { id: 'player-actions', label: 'Processing player actions...' },
        { id: 'city-production', label: 'Processing city production...' },
        { id: 'unit-actions', label: 'Processing unit actions...' },
        { id: 'research', label: 'Processing research...' },
        { id: 'random-events', label: 'Processing random events...' },
        { id: 'coordination', label: 'Coordinating post-turn updates...' },
        { id: 'statistics', label: 'Calculating statistics...' },
        { id: 'database-save', label: 'Saving turn data...' },
        { id: 'next-turn', label: 'Advancing to next turn...' },
      ];

      // Process each step with packet updates
      await this.turnPacketService.sendTurnProcessingSequence(
        processingSteps,
        async (stepId: string) => {
          switch (stepId) {
            case 'player-actions':
              await this.processPlayerActions();
              break;
            case 'city-production':
              await this.processCityProduction();
              break;
            case 'unit-actions':
              await this.processUnitActions();
              break;
            case 'research':
              await this.processResearch();
              break;
            case 'random-events':
              await this.processRandomEvents();
              break;
            case 'coordination':
              await this.coordinatePostTurnUpdates();
              break;
            case 'statistics': {
              const statistics = await this.calculateTurnStatistics(startTime);
              // Send statistics to players
              this.turnPacketService.sendTurnStatistics({
                turn: this.currentTurn,
                year: this.currentYear,
                ...statistics,
              });
              break;
            }
            case 'database-save': {
              const stats = await this.calculateTurnStatistics(startTime);
              await this.completeTurnRecord(stats);
              break;
            }
            case 'next-turn':
              await this.advanceToNextTurn();
              break;
          }
        }
      );

      // Calculate final statistics for logging
      const finalStats = await this.calculateTurnStatistics(startTime);
      logger.info('Turn processed successfully', {
        gameId: this.gameId,
        turn: this.currentTurn - 1,
        processingTime: finalStats.processingTimeMs,
      });
    } catch (error) {
      logger.error('Error processing turn', {
        gameId: this.gameId,
        turn: this.currentTurn,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  private async processPlayerActions(): Promise<void> {
    // Convert playerActions map to array for processing service
    const allActions: PlayerAction[] = [];
    for (const [playerId, actions] of this.playerActions) {
      allActions.push(
        ...actions.map(action => ({
          ...action,
          playerId,
          timestamp: action.timestamp || new Date(),
        }))
      );
    }

    // Delegate to TurnProcessingService
    const result = await this.turnProcessingService.processPlayerActions(allActions);

    // Log processing results
    logger.info('Player actions processed via service', {
      gameId: this.gameId,
      actionsProcessed: result.actionsProcessed,
      errors: result.errors.length,
    });

    // Store any errors as turn events
    for (const error of result.errors) {
      this.addTurnEvent('diplomacy', error.playerId, {
        type: 'action_error',
        action: error.action,
        error: error.error,
      });
    }

    // Clear processed actions
    this.playerActions.clear();
  }

  private async processCityProduction(): Promise<void> {
    logger.debug('Processing city production via service', { gameId: this.gameId });

    // Get all active player IDs
    const playerIds = Array.from(this.playerActions.keys());

    // Process city production for each player using the service
    for (const playerId of playerIds) {
      try {
        const citiesProcessed = await this.turnProcessingService.processCityProduction(playerId);
        logger.debug('City production processed for player', {
          gameId: this.gameId,
          playerId,
          citiesProcessed,
        });
      } catch (error) {
        logger.error('Error processing city production for player', {
          gameId: this.gameId,
          playerId,
          error: error instanceof Error ? error.message : error,
        });
      }
    }
  }

  private async processUnitActions(): Promise<void> {
    logger.debug('Processing unit actions via service', { gameId: this.gameId });

    // Get all active player IDs
    const playerIds = Array.from(this.playerActions.keys());

    // Process unit orders for each player using the service
    for (const playerId of playerIds) {
      try {
        const unitsProcessed = await this.turnProcessingService.processUnitOrders(playerId);
        logger.debug('Unit actions processed for player', {
          gameId: this.gameId,
          playerId,
          unitsProcessed,
        });
      } catch (error) {
        logger.error('Error processing unit actions for player', {
          gameId: this.gameId,
          playerId,
          error: error instanceof Error ? error.message : error,
        });
      }
    }
  }

  private async processResearch(): Promise<void> {
    logger.debug('Processing research via service', { gameId: this.gameId });

    // Get all active player IDs
    const playerIds = Array.from(this.playerActions.keys());

    // Process research for each player using the service
    for (const playerId of playerIds) {
      try {
        const techCompleted = await this.turnProcessingService.processResearch(playerId);
        if (techCompleted) {
          this.addTurnEvent('research_complete', playerId, {
            timestamp: new Date(),
          });
        }
        logger.debug('Research processed for player', {
          gameId: this.gameId,
          playerId,
          techCompleted,
        });
      } catch (error) {
        logger.error('Error processing research for player', {
          gameId: this.gameId,
          playerId,
          error: error instanceof Error ? error.message : error,
        });
      }
    }
  }

  private async processRandomEvents(): Promise<void> {
    // TODO: Implement random events in future phase
    // - Barbarian spawning
    // - Natural disasters
    // - Goody huts
    // - City revolts
    // For now, this is a placeholder that will be implemented in Phase 2

    logger.debug('Processing random events (placeholder)', { gameId: this.gameId });
  }

  /**
   * Coordinate post-turn updates using TurnCoordinationService
   */
  private async coordinatePostTurnUpdates(): Promise<void> {
    logger.debug('Coordinating post-turn updates', { gameId: this.gameId });

    // Get all active player IDs
    const playerIds = Array.from(this.playerActions.keys());

    try {
      const result = await this.turnCoordinationService.coordinatePostTurnUpdates(playerIds);

      logger.info('Post-turn coordination completed', {
        gameId: this.gameId,
        result,
      });

      // Store any coordination errors as turn events
      for (const error of result.errors) {
        this.addTurnEvent('diplomacy', error.playerId || 'system', {
          type: 'coordination_error',
          operation: error.operation,
          error: error.error,
        });
      }
    } catch (error) {
      logger.error('Error in post-turn coordination', {
        gameId: this.gameId,
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
      type: action.type,
      playerId,
      data: action.data || action,
      timestamp: new Date(),
    };

    this.playerActions.get(playerId)!.push(playerAction);

    logger.debug('Added player action', { gameId: this.gameId, playerId, actionType: action.type });
  }

  private addTurnEvent(type: TurnEvent['type'], playerId: string, data: any): void {
    this.turnEvents.push({
      type,
      playerId,
      data,
      timestamp: new Date(),
    });
  }

  private async calculateTurnStatistics(startTime: number): Promise<TurnStatistics> {
    // TODO: Calculate real statistics from database
    const processingTime = Date.now() - startTime;

    return {
      playersActive: this.playerActions.size,
      unitsTotal: 0, // TODO: Count from database
      citiesTotal: 0, // TODO: Count from database
      actionsProcessed: this.turnEvents.length,
      processingTimeMs: processingTime,
    };
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

  private async completeTurnRecord(statistics: TurnStatistics): Promise<void> {
    const endTime = new Date();
    const duration = this.turnStartTime ? endTime.getTime() - this.turnStartTime.getTime() : 0;

    await this.databaseProvider
      .getDatabase()
      .update(gameTurns)
      .set({
        endedAt: endTime,
        duration,
        events: this.turnEvents,
        playerActions: Object.fromEntries(this.playerActions),
        statistics,
      })
      .where(eq(gameTurns.gameId, this.gameId) && eq(gameTurns.turnNumber, this.currentTurn));

    logger.debug('Completed turn record', {
      gameId: this.gameId,
      turn: this.currentTurn,
      duration,
    });
  }

  private async advanceToNextTurn(): Promise<void> {
    this.currentTurn++;
    this.currentYear = this.calculateYearFromTurn(this.currentTurn);
    this.turnStartTime = new Date();
    this.turnEvents = [];

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

    logger.info('Advanced to next turn', {
      gameId: this.gameId,
      turn: this.currentTurn,
      year: this.currentYear,
    });
  }

  private calculateYearFromTurn(turn: number): number {
    // Civilization-style year progression
    if (turn <= 75) return -4000 + (turn - 1) * 40; // 40 years per turn (4000 BC - 1000 BC)
    if (turn <= 175) return -1000 + (turn - 75) * 20; // 20 years per turn (1000 BC - 1000 AD)
    if (turn <= 275) return 1000 + (turn - 175) * 10; // 10 years per turn (1000 AD - 2000 AD)
    return 2000 + (turn - 275) * 5; // 5 years per turn (2000 AD+)
  }

  private broadcastTurnStart(): void {
    // Use TurnPacketService for proper packet protocol
    this.turnPacketService.sendTurnStartSequence(
      this.currentTurn,
      this.currentYear,
      0 // fragments - will be enhanced in Phase 2
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

  public getTurnEvents(): TurnEvent[] {
    return [...this.turnEvents];
  }

  public startTurnTimer(timeLimit: number): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
    }

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
      logger.debug('Turn timer cleared', { gameId: this.gameId });
    }
  }
}
