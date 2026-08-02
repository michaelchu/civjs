/**
 * @module server/game/events/GameEventService
 * GameEventService - Comprehensive turn-based event system
 *
 * This service provides a general-purpose event system for turn-based triggers,
 * achievements, custom game logic hooks, and event caching. It complements the
 * RandomEventsManager by handling structured events and achievements.
 *
 * @reference freeciv/server/srv_main.c - script_server_signal_emit("turn_begin")
 * @reference freeciv-web/javascript/packhand.js - event processing and notifications
 */

import { logger } from '@utils/logger';
import type { GameBroadcastManager } from '@game/orchestrators/GameBroadcastManager';
import type { DatabaseProvider } from '@database';
import { isSpaceshipPart } from '@game/services/SpaceshipService';
import {
  EventPriority,
  GameEventType,
  type Achievement,
  type EventCacheEntry,
  type EventHandler,
  type EventProcessingResult,
  type EventTurnContext,
  type GameEvent,
  type GameEventData,
  type GameEventTelemetryDiagnostics,
  type PlayerEventStats,
} from './GameEventTypes';
import { TurnEventWriter } from './TurnEventWriter';
import { UnitMovementAccumulator } from './UnitMovementAccumulator';
import { AchievementService } from './AchievementService';
import { EventHandlerRegistry } from './EventHandlerRegistry';

export * from './GameEventTypes';

export class GameEventService {
  private gameId: string;

  // Event management
  private eventQueue: GameEvent[] = [];
  private eventCache: Map<string, EventCacheEntry> = new Map();

  // Configuration
  private cacheRetentionMs = 5 * 60 * 1000; // 5 minutes
  private maxEventQueueSize = 1000;
  private maxRetries = 3;

  private currentTurnId: string | null = null;
  private currentTurn = 0;
  private currentYear = 0;
  private droppedEventCount = 0;
  private persistenceFailureCount = 0;
  private readonly unitMovements = new UnitMovementAccumulator();
  private readonly eventWriter: TurnEventWriter;
  private readonly achievementService: AchievementService;
  private readonly handlerRegistry: EventHandlerRegistry;

  constructor(
    gameId: string,
    broadcastManager: GameBroadcastManager,
    databaseProvider: DatabaseProvider
  ) {
    this.gameId = gameId;
    this.eventWriter = new TurnEventWriter(gameId, databaseProvider);
    this.handlerRegistry = new EventHandlerRegistry(gameId);
    this.achievementService = new AchievementService(gameId, broadcastManager, (type, data) =>
      this.emitEvent(type, data)
    );

    logger.info('GameEventService initialized', {
      gameId: this.gameId,
      achievements: this.achievementService.count,
    });
  }

  /** Set the turn record and calendar context used by newly emitted events. */
  setCurrentTurnContext(turnId: string, turn: number, year: number): void {
    this.currentTurnId = turnId;
    this.currentTurn = turn;
    this.currentYear = year;
  }

  /**
   * Set the current turn ID for database tracking.
   * @deprecated Use setCurrentTurnContext so event data and turn records stay aligned.
   */
  setCurrentTurnId(turnId: string): void {
    this.currentTurnId = turnId;
  }

  public getTelemetryDiagnostics(): GameEventTelemetryDiagnostics {
    return {
      droppedEvents: this.droppedEventCount,
      persistenceFailures: this.persistenceFailureCount,
      pendingEvents: this.eventQueue.length,
      pendingMovementSummaries: this.unitMovements.pendingCount,
    };
  }

  setPlayerStatsProvider(provider: (playerId: string) => PlayerEventStats): void {
    this.achievementService.setPlayerStatsProvider(provider);
  }

  /**
   * Register an event handler for specific event types
   * @reference freeciv/server/srv_main.c - script hook registration
   */
  registerEventHandler(handler: EventHandler): void {
    this.handlerRegistry.register(handler);
  }

  /**
   * Emit a game event
   * @reference freeciv/server/srv_main.c - script_server_signal_emit()
   */
  emitEvent(type: GameEventType, data: Partial<GameEventData>): string {
    return this.enqueueEvent(type, data, this.currentTurnContext());
  }

  private currentTurnContext(): EventTurnContext {
    return {
      turnId: this.currentTurnId ?? undefined,
      turn: this.currentTurn,
      year: this.currentYear,
    };
  }

  private enqueueEvent(
    type: GameEventType,
    data: Partial<GameEventData>,
    context: EventTurnContext
  ): string {
    const eventId = `${this.gameId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const gameEvent: GameEvent = {
      id: eventId,
      type,
      turnId: context.turnId,
      priority: EventPriority.NORMAL,
      data: {
        gameId: this.gameId,
        turn: context.turn,
        year: context.year,
        timestamp: Date.now(),
        ...data,
      } as GameEventData,
      handled: false,
      retryCount: 0,
      maxRetries: this.maxRetries,
      createdAt: Date.now(),
    };

    // Add to queue for processing
    if (this.eventQueue.length >= this.maxEventQueueSize) {
      const droppedCount = Math.max(1, Math.floor(this.maxEventQueueSize * 0.1));
      this.droppedEventCount += droppedCount;
      logger.warn('Event queue at capacity, dropping oldest events', {
        gameId: this.gameId,
        queueSize: this.eventQueue.length,
        droppedCount,
        totalDroppedEvents: this.droppedEventCount,
      });
      for (const dropped of this.eventQueue.splice(0, droppedCount)) {
        this.handlerRegistry.discard(dropped.id);
      }
    }

    this.eventQueue.push(gameEvent);

    logger.debug('Event emitted', {
      gameId: this.gameId,
      eventId,
      type,
      queueSize: this.eventQueue.length,
    });

    return eventId;
  }

  private getCityEventData(city: {
    id: string;
    name: string;
    playerId: string;
    x: number;
    y: number;
  }): Pick<GameEventData, 'playerId' | 'cityId' | 'cityName' | 'x' | 'y'> {
    return {
      playerId: city.playerId,
      cityId: city.id,
      cityName: city.name,
      x: city.x,
      y: city.y,
    };
  }

  recordCityFounded(city: {
    id: string;
    name: string;
    playerId: string;
    x: number;
    y: number;
  }): string {
    return this.emitEvent(GameEventType.CITY_FOUNDED, this.getCityEventData(city));
  }

  recordCityGrowth(
    city: { id: string; name: string; playerId: string; x: number; y: number; size: number },
    oldSize: number
  ): string {
    return this.emitEvent(GameEventType.CITY_GROWTH, {
      ...this.getCityEventData(city),
      oldSize,
      newSize: city.size,
    });
  }

  recordCityProductionCompleted(
    city: { id: string; name: string; playerId: string; x: number; y: number },
    item: { kind: 'unit' | 'building' | 'wonder'; value: string }
  ): string {
    const data = {
      ...this.getCityEventData(city),
      productionType: item.kind,
      productionId: item.value,
    };
    const eventId = this.emitEvent(GameEventType.CITY_PRODUCTION_COMPLETE, data);
    if ((item.kind === 'building' || item.kind === 'wonder') && !isSpaceshipPart(item.value)) {
      this.emitEvent(GameEventType.CITY_BUILDING_BUILT, data);
    }
    return eventId;
  }

  recordTradeRouteEstablished(
    sourceCity: { id: string; playerId: string },
    partnerCity: { id: string; playerId: string },
    route: {
      id?: string;
      value: number;
      establishedTurn: number;
      distance?: number;
      routeType?: string;
      goods?: string;
    }
  ): string {
    return this.emitEvent(GameEventType.TRADE_ROUTE_ESTABLISHED, {
      playerId: sourceCity.playerId,
      targetPlayerId: partnerCity.playerId,
      sourceCityId: sourceCity.id,
      partnerCityId: partnerCity.id,
      routeId: route.id,
      value: route.value,
      establishedTurn: route.establishedTurn,
      distance: route.distance,
      routeType: route.routeType,
      goods: route.goods,
    });
  }

  recordTechnologyCompleted(
    playerId: string,
    techId: string,
    source: 'research' | 'grant'
  ): string {
    return this.emitEvent(GameEventType.TECH_RESEARCHED, {
      playerId,
      techId,
      source,
    });
  }

  recordUnitLifecycle(event: {
    type: 'created' | 'moved' | 'owner_changed' | 'destroyed';
    unit: {
      id: string;
      playerId: string;
      unitTypeId: string;
      x: number;
      y: number;
      createdTurn?: number;
    };
    previousX?: number;
    previousY?: number;
    previousPlayerId?: string;
  }): string | undefined {
    if (event.type === 'moved') {
      this.recordUnitMovement(event);
      return undefined;
    }

    const data = {
      playerId: event.unit.playerId,
      unitId: event.unit.id,
      unitTypeId: event.unit.unitTypeId,
      x: event.unit.x,
      y: event.unit.y,
      createdTurn: event.unit.createdTurn,
      previousX: event.previousX,
      previousY: event.previousY,
      previousPlayerId: event.previousPlayerId,
    };
    const eventType =
      event.type === 'created'
        ? GameEventType.UNIT_CREATED
        : event.type === 'destroyed'
          ? GameEventType.UNIT_DESTROYED
          : GameEventType.CUSTOM_EVENT;
    return this.emitEvent(eventType, {
      ...data,
      ...(event.type === 'owner_changed' ? { eventName: 'unit_owner_changed' } : {}),
    });
  }

  private recordUnitMovement(event: {
    unit: {
      id: string;
      playerId: string;
      unitTypeId: string;
      x: number;
      y: number;
    };
    previousX?: number;
    previousY?: number;
  }): void {
    this.unitMovements.record(event, this.currentTurnContext());
  }

  private flushUnitMovementSummaries(): void {
    for (const summary of this.unitMovements.drain()) {
      this.enqueueEvent(GameEventType.UNIT_MOVEMENT_SUMMARY, summary.data, summary.context);
    }
  }

  recordCombatOccurred(event: {
    attacker: { id: string; playerId: string; unitTypeId: string; x: number; y: number };
    defender: { id: string; playerId: string; unitTypeId: string; x: number; y: number };
    result: {
      attackerDamage: number;
      defenderDamage: number;
      attackerDestroyed: boolean;
      defenderDestroyed: boolean;
      collateralDestroyedIds?: string[];
    };
    collateralUnits?: Array<{
      id: string;
      playerId: string;
      unitTypeId: string;
      x: number;
      y: number;
    }>;
  }): string {
    const data = {
      playerId: event.attacker.playerId,
      targetPlayerId: event.defender.playerId,
      attackerId: event.attacker.id,
      defenderId: event.defender.id,
      attackerUnitTypeId: event.attacker.unitTypeId,
      defenderUnitTypeId: event.defender.unitTypeId,
      x: event.defender.x,
      y: event.defender.y,
      attackerDamage: event.result.attackerDamage,
      defenderDamage: event.result.defenderDamage,
      attackerDestroyed: event.result.attackerDestroyed,
      defenderDestroyed: event.result.defenderDestroyed,
      collateralDestroyedIds: event.result.collateralDestroyedIds ?? [],
    };
    const eventId = this.emitEvent(GameEventType.COMBAT_OCCURRED, data);
    if (event.result.defenderDestroyed) {
      this.emitEvent(GameEventType.UNIT_KILLED, {
        playerId: event.defender.playerId,
        targetPlayerId: event.attacker.playerId,
        unitId: event.defender.id,
        unitTypeId: event.defender.unitTypeId,
        killerUnitId: event.attacker.id,
        x: event.defender.x,
        y: event.defender.y,
        role: 'defender',
      });
    }
    if (event.result.attackerDestroyed) {
      this.emitEvent(GameEventType.UNIT_KILLED, {
        playerId: event.attacker.playerId,
        targetPlayerId: event.defender.playerId,
        unitId: event.attacker.id,
        unitTypeId: event.attacker.unitTypeId,
        killerUnitId: event.defender.id,
        x: event.attacker.x,
        y: event.attacker.y,
        role: 'attacker',
      });
    }
    const collateralIds = new Set(event.result.collateralDestroyedIds ?? []);
    for (const unit of event.collateralUnits ?? []) {
      if (!collateralIds.has(unit.id)) continue;
      this.emitEvent(GameEventType.UNIT_KILLED, {
        playerId: unit.playerId,
        targetPlayerId: event.attacker.playerId,
        unitId: unit.id,
        unitTypeId: unit.unitTypeId,
        killerUnitId: event.attacker.id,
        x: unit.x,
        y: unit.y,
        role: 'collateral',
      });
    }
    return eventId;
  }

  /**
   * Process all queued events
   * Called during turn processing phases
   */
  async processQueuedEvents(
    currentTurn: number,
    currentYear: number
  ): Promise<EventProcessingResult> {
    const startTime = Date.now();
    const result: EventProcessingResult = {
      eventsProcessed: 0,
      eventsHandled: 0,
      eventsFailed: 0,
      eventsDropped: 0,
      persistenceFailures: 0,
      achievementsUnlocked: 0,
      duration: 0,
      errors: [],
    };

    this.flushUnitMovementSummaries();

    logger.debug('Processing queued events', {
      gameId: this.gameId,
      queueSize: this.eventQueue.length,
      turn: currentTurn,
    });

    // Fill context for events emitted before the first turn record existed.
    for (const event of this.eventQueue) {
      if (event.data.turn === 0) event.data.turn = currentTurn;
      if (event.data.year === 0) event.data.year = currentYear;
      event.turnId ??= this.currentTurnId ?? undefined;
    }

    // Process events in priority order
    const sortedEvents = [...this.eventQueue].sort((a, b) => b.priority - a.priority);

    const readyForPersistence: GameEvent[] = [];
    for (const event of sortedEvents) {
      result.eventsProcessed++;

      try {
        // Handle the event
        const handled = await this.handlerRegistry.handle(event);

        if (handled) {
          readyForPersistence.push(event);
        } else {
          event.retryCount++;
          if (event.retryCount >= event.maxRetries) {
            result.eventsFailed++;
            result.eventsDropped++;
            this.droppedEventCount++;
            this.handlerRegistry.discard(event.id);
            logger.warn('Event failed after max retries', {
              gameId: this.gameId,
              eventId: event.id,
              type: event.type,
              retryCount: event.retryCount,
            });
          }
        }
      } catch (error) {
        result.eventsFailed++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push(`Event ${event.id}: ${errorMessage}`);

        logger.error('Error processing event', {
          gameId: this.gameId,
          eventId: event.id,
          type: event.type,
          error: errorMessage,
        });
      }
    }

    const persisted = await this.eventWriter.write(readyForPersistence, this.currentTurnId);
    if (!persisted) {
      this.persistenceFailureCount += readyForPersistence.length;
      result.persistenceFailures += readyForPersistence.length;
      for (const event of readyForPersistence) {
        event.retryCount++;
        result.eventsFailed++;
        if (event.retryCount >= event.maxRetries) {
          result.eventsDropped++;
          this.droppedEventCount++;
          this.handlerRegistry.discard(event.id);
        }
      }
    } else {
      for (const event of readyForPersistence) {
        try {
          result.eventsHandled++;
          event.handled = true;
          event.handledAt = Date.now();
          this.handlerRegistry.discard(event.id);

          // Cache the event for potential replay/analysis.
          this.cacheEvent(event);

          const achievementsUnlocked = await this.achievementService.check(event);
          result.achievementsUnlocked += achievementsUnlocked;
        } catch (error) {
          result.eventsFailed++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.errors.push(`Event ${event.id}: ${errorMessage}`);
          logger.error('Error finalizing processed event', {
            gameId: this.gameId,
            eventId: event.id,
            type: event.type,
            error: errorMessage,
          });
        }
      }
    }

    // Remove handled events from queue
    this.eventQueue = this.eventQueue.filter(
      event => !event.handled && event.retryCount < event.maxRetries
    );

    // Clean up expired cache entries
    this.cleanupExpiredCache();

    result.duration = Date.now() - startTime;

    logger.info('Event processing completed', {
      gameId: this.gameId,
      turn: currentTurn,
      ...result,
      remainingQueueSize: this.eventQueue.length,
    });

    return result;
  }

  /**
   * Cache event for potential replay/analysis
   */
  private cacheEvent(event: GameEvent): void {
    const expiredAt = Date.now() + this.cacheRetentionMs;
    this.eventCache.set(event.id, { event, expiredAt });
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.eventCache.entries()) {
      if (entry.expiredAt <= now) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.eventCache.delete(key);
    }

    if (expiredKeys.length > 0) {
      logger.debug('Cleaned up expired cache entries', {
        gameId: this.gameId,
        entriesRemoved: expiredKeys.length,
        remainingEntries: this.eventCache.size,
      });
    }
  }

  /**
   * Add custom achievement
   */
  addAchievement(achievement: Achievement): void {
    this.achievementService.add(achievement);
    logger.debug('Custom achievement added', {
      gameId: this.gameId,
      achievementId: achievement.id,
      name: achievement.name,
    });
  }

  /**
   * Get event cache for analysis/replay
   */
  getEventCache(): GameEvent[] {
    return Array.from(this.eventCache.values()).map(entry => entry.event);
  }

  /**
   * Get player achievements
   */
  getPlayerAchievements(playerId: string): string[] {
    return this.achievementService.getPlayerAchievements(playerId);
  }

  /**
   * Get achievement info
   */
  getAchievement(achievementId: string): Achievement | undefined {
    return this.achievementService.get(achievementId);
  }

  /**
   * Clear event queue (for testing or reset)
   */
  clearEventQueue(): void {
    this.eventQueue = [];
    this.handlerRegistry.clear();
    logger.debug('Event queue cleared', { gameId: this.gameId });
  }
}
