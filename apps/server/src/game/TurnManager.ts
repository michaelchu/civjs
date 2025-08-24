/* eslint-disable @typescript-eslint/no-explicit-any */
import { logger } from '../utils/logger';
import { db } from '../database';
import { gameState } from '../database/redis';
import { gameTurns, games, players } from '../database/schema';
import { eq } from 'drizzle-orm';
import { Server as SocketServer } from 'socket.io';

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
  private io: SocketServer;
  private currentTurn: number = 0;
  private currentYear: number = -4000; // Starting year like Civilization
  private turnEvents: TurnEvent[] = [];
  private playerActions: Map<string, any[]> = new Map();
  private turnStartTime: Date | null = null;
  private turnTimer: NodeJS.Timeout | null = null;

  constructor(gameId: string, io: SocketServer) {
    this.gameId = gameId;
    this.io = io;
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

      // Process all queued actions
      await this.processPlayerActions();

      // Process city production
      await this.processCityProduction();

      // Process unit movement and actions
      await this.processUnitActions();

      // Process research
      await this.processResearch();

      // Process random events (barbarians, disasters, etc.)
      await this.processRandomEvents();

      // Calculate statistics
      const statistics = await this.calculateTurnStatistics(startTime);

      // Save turn to database
      await this.completeTurnRecord(statistics);

      // Advance to next turn
      await this.advanceToNextTurn();

      logger.info('Turn processed successfully', {
        gameId: this.gameId,
        turn: this.currentTurn - 1,
        processingTime: statistics.processingTimeMs,
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
    for (const [playerId, actions] of this.playerActions) {
      for (const action of actions) {
        try {
          await this.processPlayerAction(playerId, action);
        } catch (error) {
          logger.error('Error processing player action', {
            gameId: this.gameId,
            playerId,
            action: action.type,
            error: error instanceof Error ? error.message : error,
          });
        }
      }
    }

    // Clear processed actions
    this.playerActions.clear();
  }

  private async processPlayerAction(playerId: string, action: any): Promise<void> {
    switch (action.type) {
      case 'unit_move':
        await this.processUnitMove(playerId, action.data);
        break;
      case 'unit_attack':
        await this.processUnitAttack(playerId, action.data);
        break;
      case 'city_production':
        await this.processCityProductionOrder(playerId, action.data);
        break;
      case 'research_selection':
        await this.processResearchSelection(playerId, action.data);
        break;
      default:
        logger.warn('Unknown action type', {
          gameId: this.gameId,
          playerId,
          actionType: action.type,
        });
    }
  }

  private async processUnitMove(playerId: string, moveData: any): Promise<void> {
    // TODO: Implement unit movement logic
    // - Validate move is legal
    // - Check for encounters (other units, cities, resources)
    // - Update unit position
    // - Consume movement points

    this.addTurnEvent('unit_move', playerId, moveData);
    logger.debug('Processed unit move', { gameId: this.gameId, playerId, moveData });
  }

  private async processUnitAttack(playerId: string, attackData: any): Promise<void> {
    // TODO: Implement combat system
    // - Calculate attack/defense values
    // - Apply damage
    // - Handle unit destruction
    // - Update experience

    this.addTurnEvent('combat', playerId, attackData);
    logger.debug('Processed unit attack', { gameId: this.gameId, playerId, attackData });
  }

  private async processCityProduction(): Promise<void> {
    // TODO: Implement city production
    // - Process production queues
    // - Complete buildings/units
    // - Handle population growth
    // - Calculate resource yields

    logger.debug('Processing city production', { gameId: this.gameId });
  }

  private async processCityProductionOrder(playerId: string, productionData: any): Promise<void> {
    // TODO: Implement production orders
    // - Validate player owns the city
    // - Update production queue
    // - Check if production can complete this turn

    this.addTurnEvent('city_production', playerId, productionData);
    logger.debug('Processed city production order', {
      gameId: this.gameId,
      playerId,
      productionData,
    });
  }

  private async processUnitActions(): Promise<void> {
    // TODO: Implement unit actions
    // - Process automated units
    // - Handle fortification
    // - Process unit healing
    // - Update unit status

    logger.debug('Processing unit actions', { gameId: this.gameId });
  }

  private async processResearch(): Promise<void> {
    // TODO: Implement research system
    // - Add research points
    // - Complete technologies
    // - Unlock new units/buildings
    // - Handle tech trading

    logger.debug('Processing research', { gameId: this.gameId });
  }

  private async processResearchSelection(playerId: string, researchData: any): Promise<void> {
    // TODO: Implement research selection
    // - Validate research is available
    // - Set current research
    // - Calculate research points

    this.addTurnEvent('research_complete', playerId, researchData);
    logger.debug('Processed research selection', { gameId: this.gameId, playerId, researchData });
  }

  private async processRandomEvents(): Promise<void> {
    // TODO: Implement random events
    // - Barbarian spawning
    // - Natural disasters
    // - Goody huts
    // - City revolts

    logger.debug('Processing random events', { gameId: this.gameId });
  }

  public addPlayerAction(playerId: string, action: any): void {
    if (!this.playerActions.has(playerId)) {
      this.playerActions.set(playerId, []);
    }

    this.playerActions.get(playerId)!.push({
      ...action,
      timestamp: new Date(),
    });

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

    await db.insert(gameTurns).values(turnData);
    logger.debug('Created turn record', { gameId: this.gameId, turn: this.currentTurn });
  }

  private async completeTurnRecord(statistics: TurnStatistics): Promise<void> {
    const endTime = new Date();
    const duration = this.turnStartTime ? endTime.getTime() - this.turnStartTime.getTime() : 0;

    await db
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
    await db.update(players).set({ hasEndedTurn: false }).where(eq(players.gameId, this.gameId));

    // Update game turn counter
    await db
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
