/**
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
import { turnEvents, NewTurnEvent } from '@database/schema/turn-events';

export enum GameEventType {
  // Turn-based events
  TURN_BEGIN = 'turn_begin',
  TURN_END = 'turn_end',
  PHASE_START = 'phase_start',
  PHASE_END = 'phase_end',

  // City events
  CITY_FOUNDED = 'city_founded',
  CITY_GROWTH = 'city_growth',
  CITY_PRODUCTION_COMPLETE = 'city_production_complete',
  CITY_BUILDING_BUILT = 'city_building_built',

  // Unit events
  UNIT_CREATED = 'unit_created',
  UNIT_DESTROYED = 'unit_destroyed',
  UNIT_PROMOTED = 'unit_promoted',
  UNIT_MOVED = 'unit_moved',

  // Research events
  TECH_RESEARCHED = 'tech_researched',
  RESEARCH_STARTED = 'research_started',

  // Combat events
  COMBAT_OCCURRED = 'combat_occurred',
  UNIT_KILLED = 'unit_killed',

  // Trade events
  TRADE_ROUTE_ESTABLISHED = 'trade_route_established',

  // Achievement events
  ACHIEVEMENT_UNLOCKED = 'achievement_unlocked',
  MILESTONE_REACHED = 'milestone_reached',

  // Custom events
  CUSTOM_EVENT = 'custom_event',
}

export enum EventPriority {
  LOW = 1,
  NORMAL = 2,
  HIGH = 3,
  CRITICAL = 4,
}

export interface GameEventData {
  [key: string]: any;
  gameId: string;
  playerId?: string;
  turn: number;
  year: number;
  timestamp: number;
}

export interface GameEvent {
  id: string;
  type: GameEventType;
  priority: EventPriority;
  data: GameEventData;
  handled: boolean;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  handledAt?: number;
}

export interface EventHandler {
  id: string;
  eventType: GameEventType;
  priority: EventPriority;
  handler: (event: GameEvent) => Promise<boolean>;
  description?: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: string;
  trigger: GameEventType[];
  condition: (event: GameEvent, playerStats: any) => boolean;
  reward?: {
    type: 'bonus' | 'unlock' | 'message';
    value: any;
  };
  oneTime: boolean;
  enabled: boolean;
}

export interface EventCacheEntry {
  event: GameEvent;
  expiredAt: number;
}

export interface EventProcessingResult {
  eventsProcessed: number;
  eventsHandled: number;
  eventsFailed: number;
  achievementsUnlocked: number;
  duration: number;
  errors: string[];
}

export interface PlayerEventStats {
  playerId: string;
  citiesCount: number;
  unitsCount: number;
  technologiesCount: number;
  score: number;
  turn: number;
}

export class GameEventService {
  private gameId: string;
  private broadcastManager: GameBroadcastManager;

  // Event management
  private eventHandlers: Map<GameEventType, EventHandler[]> = new Map();
  private eventQueue: GameEvent[] = [];
  private eventCache: Map<string, EventCacheEntry> = new Map();

  // Achievement system
  private achievements: Map<string, Achievement> = new Map();
  private playerAchievements: Map<string, Set<string>> = new Map(); // playerId -> achievementIds

  // Configuration
  private cacheRetentionMs = 5 * 60 * 1000; // 5 minutes
  private maxEventQueueSize = 1000;
  private maxRetries = 3;

  private currentTurnId: string | null = null;
  private playerStatsProvider?: (playerId: string) => PlayerEventStats;

  constructor(
    gameId: string,
    broadcastManager: GameBroadcastManager,
    private readonly databaseProvider: DatabaseProvider
  ) {
    this.gameId = gameId;
    this.broadcastManager = broadcastManager;

    // Initialize built-in achievements
    this.initializeBuiltInAchievements();

    logger.info('GameEventService initialized', {
      gameId: this.gameId,
      achievements: this.achievements.size,
    });
  }

  /**
   * Set the current turn ID for database tracking
   */
  setCurrentTurnId(turnId: string): void {
    this.currentTurnId = turnId;
  }

  setPlayerStatsProvider(provider: (playerId: string) => PlayerEventStats): void {
    this.playerStatsProvider = provider;
  }

  /**
   * Save an event to the database
   */
  private async saveEventToDatabase(event: GameEvent): Promise<void> {
    if (!this.currentTurnId) {
      // If no turn ID is set, we can't save to database but shouldn't block event processing
      return;
    }

    try {
      const eventRecord = this.buildEventRecord(event);
      /*
      const eventRecord: NewTurnEvent = {
        gameId: this.gameId,
        turnId: this.currentTurnId,
        playerId: event.data.playerId || null,
        eventType: event.type,
        eventCategory: this.getEventCategory(event.type),
        occurredAt: new Date(event.createdAt),
        title: this.getEventTitle(event),
        description: this.getEventDescription(event),
        eventData: event.data,
        priority: event.priority,
        isVisible: this.shouldEventBeVisible(event.type),
        isAchievement: event.type === GameEventType.ACHIEVEMENT_UNLOCKED,
        status: event.handled ? 'completed' : 'pending',
        attempts: event.retryCount + 1,
        lastError: null,
        achievementId:
          event.type === GameEventType.ACHIEVEMENT_UNLOCKED ? event.data.achievementId : null,
        achievementUnlocked: event.type === GameEventType.ACHIEVEMENT_UNLOCKED,
        locationX: event.data.x || null,
        locationY: event.data.y || null,
        relatedUnitId: event.data.unitId || null,
        relatedCityId: event.data.cityId || null,
        relatedPlayerId: event.data.targetPlayerId || null,
      };
      */

      await this.databaseProvider.getDatabase().insert(turnEvents).values(eventRecord);
    } catch (error) {
      // Log but don't throw - database issues shouldn't break event processing
      logger.warn('Failed to save event to database', {
        gameId: this.gameId,
        eventId: event.id,
        eventType: event.type,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private buildEventRecord(event: GameEvent): NewTurnEvent {
    return {
      gameId: this.gameId,
      turnId: this.currentTurnId!,
      playerId: event.data.playerId ?? null,
      eventType: event.type,
      eventCategory: this.getEventCategory(event.type),
      occurredAt: new Date(event.createdAt),
      title: this.getEventTitle(event),
      description: this.getEventDescription(event),
      eventData: event.data,
      priority: event.priority,
      isVisible: this.shouldEventBeVisible(event.type),
      isAchievement: event.type === GameEventType.ACHIEVEMENT_UNLOCKED,
      status: event.handled ? 'completed' : 'pending',
      attempts: event.retryCount + 1,
      lastError: null,
      achievementId:
        event.type === GameEventType.ACHIEVEMENT_UNLOCKED ? event.data.achievementId : null,
      achievementUnlocked: event.type === GameEventType.ACHIEVEMENT_UNLOCKED,
      locationX: event.data.x ?? null,
      locationY: event.data.y ?? null,
      relatedUnitId: event.data.unitId ?? null,
      relatedCityId: event.data.cityId ?? null,
      relatedPlayerId: event.data.targetPlayerId ?? null,
    };
  }

  /**
   * Get event category for database classification
   */
  private getEventCategory(eventType: GameEventType): string {
    const categoryMap: Record<string, string> = {
      [GameEventType.TURN_BEGIN]: 'game',
      [GameEventType.TURN_END]: 'game',
      [GameEventType.PHASE_START]: 'game',
      [GameEventType.PHASE_END]: 'game',
      [GameEventType.CITY_FOUNDED]: 'city',
      [GameEventType.CITY_GROWTH]: 'city',
      [GameEventType.CITY_PRODUCTION_COMPLETE]: 'city',
      [GameEventType.CITY_BUILDING_BUILT]: 'city',
      [GameEventType.UNIT_CREATED]: 'unit',
      [GameEventType.UNIT_DESTROYED]: 'unit',
      [GameEventType.UNIT_PROMOTED]: 'unit',
      [GameEventType.UNIT_MOVED]: 'unit',
      [GameEventType.TECH_RESEARCHED]: 'research',
      [GameEventType.RESEARCH_STARTED]: 'research',
      [GameEventType.COMBAT_OCCURRED]: 'combat',
      [GameEventType.UNIT_KILLED]: 'combat',
      [GameEventType.TRADE_ROUTE_ESTABLISHED]: 'trade',
      [GameEventType.ACHIEVEMENT_UNLOCKED]: 'achievement',
      [GameEventType.MILESTONE_REACHED]: 'achievement',
      [GameEventType.CUSTOM_EVENT]: 'custom',
    };
    return categoryMap[eventType] || 'other';
  }

  /**
   * Get human-readable title for an event
   */
  private getEventTitle(event: GameEvent): string {
    const titleMap: Record<string, (data: any) => string> = {
      [GameEventType.CITY_FOUNDED]: data => `City "${data.cityName || 'Unknown'}" founded`,
      [GameEventType.UNIT_CREATED]: data => `${data.unitType || 'Unit'} created`,
      [GameEventType.TECH_RESEARCHED]: data => `${data.techName || 'Technology'} researched`,
      [GameEventType.TRADE_ROUTE_ESTABLISHED]: data =>
        `Trade route established from ${data.sourceCityId || 'city'} to ${data.partnerCityId || 'city'}`,
      [GameEventType.ACHIEVEMENT_UNLOCKED]: data =>
        `Achievement: ${data.achievementName || 'Unknown'}`,
      [GameEventType.TURN_BEGIN]: data => `Turn ${data.turn} began`,
      [GameEventType.TURN_END]: data => `Turn ${data.turn} completed`,
    };

    const titleGenerator = titleMap[event.type];
    if (titleGenerator) {
      return titleGenerator(event.data);
    }
    return `${event.type} event`;
  }

  /**
   * Get human-readable description for an event
   */
  private getEventDescription(_event: GameEvent): string | null {
    // For most events, we don't need a separate description
    // This could be expanded based on specific event types
    return null;
  }

  /**
   * Determine if an event should be visible to players
   */
  private shouldEventBeVisible(eventType: GameEventType): boolean {
    const visibleEvents = [
      GameEventType.CITY_FOUNDED,
      GameEventType.CITY_GROWTH,
      GameEventType.UNIT_CREATED,
      GameEventType.TECH_RESEARCHED,
      GameEventType.ACHIEVEMENT_UNLOCKED,
      GameEventType.COMBAT_OCCURRED,
      GameEventType.TRADE_ROUTE_ESTABLISHED,
    ];
    return visibleEvents.includes(eventType);
  }

  /**
   * Register an event handler for specific event types
   * @reference freeciv/server/srv_main.c - script hook registration
   */
  registerEventHandler(handler: EventHandler): void {
    if (!this.eventHandlers.has(handler.eventType)) {
      this.eventHandlers.set(handler.eventType, []);
    }

    const handlers = this.eventHandlers.get(handler.eventType)!;

    // Check for duplicate handler IDs
    const existingIndex = handlers.findIndex(h => h.id === handler.id);
    if (existingIndex !== -1) {
      handlers[existingIndex] = handler; // Replace existing
      logger.debug('Event handler updated', {
        gameId: this.gameId,
        handlerId: handler.id,
        eventType: handler.eventType,
      });
    } else {
      handlers.push(handler);
      logger.debug('Event handler registered', {
        gameId: this.gameId,
        handlerId: handler.id,
        eventType: handler.eventType,
      });
    }

    // Sort handlers by priority (highest first)
    handlers.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Emit a game event
   * @reference freeciv/server/srv_main.c - script_server_signal_emit()
   */
  emitEvent(type: GameEventType, data: Partial<GameEventData>): string {
    const eventId = `${this.gameId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const gameEvent: GameEvent = {
      id: eventId,
      type,
      priority: EventPriority.NORMAL,
      data: {
        gameId: this.gameId,
        turn: 0, // Will be updated by caller
        year: 0, // Will be updated by caller
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
      logger.warn('Event queue at capacity, dropping oldest events', {
        gameId: this.gameId,
        queueSize: this.eventQueue.length,
      });
      // Remove oldest events
      this.eventQueue.splice(0, Math.floor(this.maxEventQueueSize * 0.1));
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
    if (item.kind === 'building' || item.kind === 'wonder') {
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
  }): string {
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
        : event.type === 'moved'
          ? GameEventType.UNIT_MOVED
          : event.type === 'destroyed'
            ? GameEventType.UNIT_DESTROYED
            : GameEventType.CUSTOM_EVENT;
    return this.emitEvent(eventType, {
      ...data,
      ...(event.type === 'owner_changed' ? { eventName: 'unit_owner_changed' } : {}),
    });
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
      achievementsUnlocked: 0,
      duration: 0,
      errors: [],
    };

    logger.debug('Processing queued events', {
      gameId: this.gameId,
      queueSize: this.eventQueue.length,
      turn: currentTurn,
    });

    // Update turn/year for all events
    for (const event of this.eventQueue) {
      if (event.data.turn === 0) event.data.turn = currentTurn;
      if (event.data.year === 0) event.data.year = currentYear;
    }

    // Process events in priority order
    const sortedEvents = [...this.eventQueue].sort((a, b) => b.priority - a.priority);

    for (const event of sortedEvents) {
      result.eventsProcessed++;

      try {
        // Handle the event
        const handled = await this.handleEvent(event);

        if (handled) {
          result.eventsHandled++;
          event.handled = true;
          event.handledAt = Date.now();

          // Cache the event for potential replay/analysis
          this.cacheEvent(event);

          // Save event to database for persistent history
          await this.saveEventToDatabase(event);

          // Check for achievement unlocks
          const achievementsUnlocked = await this.checkAchievements(event);
          result.achievementsUnlocked += achievementsUnlocked;
        } else {
          event.retryCount++;
          if (event.retryCount >= event.maxRetries) {
            result.eventsFailed++;
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
   * Handle a single event by calling all registered handlers
   */
  private async handleEvent(event: GameEvent): Promise<boolean> {
    const handlers = this.eventHandlers.get(event.type) || [];

    if (handlers.length === 0) {
      // No handlers registered for this event type
      return true;
    }

    let allHandlersSucceeded = true;

    for (const handler of handlers) {
      try {
        const success = await handler.handler(event);
        if (!success) {
          allHandlersSucceeded = false;
          logger.warn('Event handler returned false', {
            gameId: this.gameId,
            eventId: event.id,
            handlerId: handler.id,
            eventType: event.type,
          });
        }
      } catch (error) {
        allHandlersSucceeded = false;
        logger.error('Event handler threw error', {
          gameId: this.gameId,
          eventId: event.id,
          handlerId: handler.id,
          eventType: event.type,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    return allHandlersSucceeded;
  }

  /**
   * Check if any achievements should be unlocked based on the event
   */
  private async checkAchievements(event: GameEvent): Promise<number> {
    if (!event.data.playerId) {
      return 0; // No player-specific achievements to check
    }

    const playerId = event.data.playerId;
    let achievementsUnlocked = 0;

    // Get player's current achievements
    if (!this.playerAchievements.has(playerId)) {
      this.playerAchievements.set(playerId, new Set());
    }
    const playerAchievements = this.playerAchievements.get(playerId)!;

    // Check all achievements that trigger on this event type
    for (const achievement of this.achievements.values()) {
      if (await this.processAchievement(event, playerId, playerAchievements, achievement))
        achievementsUnlocked++;
    }

    return achievementsUnlocked;
  }

  private async processAchievement(
    event: GameEvent,
    playerId: string,
    unlocked: Set<string>,
    achievement: Achievement
  ): Promise<boolean> {
    if (
      !achievement.enabled ||
      !achievement.trigger.includes(event.type) ||
      (achievement.oneTime && unlocked.has(achievement.id))
    )
      return false;
    try {
      if (!achievement.condition(event, this.getPlayerStats(playerId))) return false;
      unlocked.add(achievement.id);
      await this.emitEvent(GameEventType.ACHIEVEMENT_UNLOCKED, {
        playerId,
        achievementId: achievement.id,
        achievementName: achievement.name,
        triggerEvent: event.id,
      });
      this.broadcastManager.broadcastToPlayer(playerId, 'achievement_unlocked', {
        achievement: {
          id: achievement.id,
          name: achievement.name,
          description: achievement.description,
          category: achievement.category,
        },
      });
      logger.info('Achievement unlocked', {
        gameId: this.gameId,
        playerId,
        achievementId: achievement.id,
        achievementName: achievement.name,
        triggerEvent: event.id,
      });
      return true;
    } catch (error) {
      logger.error('Error checking achievement', {
        gameId: this.gameId,
        achievementId: achievement.id,
        playerId,
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
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
   * Get basic player stats for achievement checking
   * (This would integrate with actual game managers in a full implementation)
   */
  private getPlayerStats(playerId: string): PlayerEventStats {
    return (
      this.playerStatsProvider?.(playerId) ?? {
        playerId,
        citiesCount: 0,
        unitsCount: 0,
        technologiesCount: 0,
        score: 0,
        turn: 0,
      }
    );
  }

  /**
   * Initialize built-in achievements
   * @reference freeciv/server achievements and milestones
   */
  private initializeBuiltInAchievements(): void {
    // First City achievement
    this.achievements.set('first_city', {
      id: 'first_city',
      name: 'City Founder',
      description: 'Found your first city',
      category: 'civilization',
      trigger: [GameEventType.CITY_FOUNDED],
      condition: (event, playerStats) => {
        return (
          event.type === GameEventType.CITY_FOUNDED && event.data.playerId === playerStats.playerId
        );
      },
      oneTime: true,
      enabled: true,
    });

    // First Unit achievement
    this.achievements.set('first_unit', {
      id: 'first_unit',
      name: 'Military Commander',
      description: 'Create your first unit',
      category: 'military',
      trigger: [GameEventType.UNIT_CREATED],
      condition: (event, playerStats) => {
        return (
          event.type === GameEventType.UNIT_CREATED && event.data.playerId === playerStats.playerId
        );
      },
      oneTime: true,
      enabled: true,
    });

    // First Tech achievement
    this.achievements.set('first_tech', {
      id: 'first_tech',
      name: 'Researcher',
      description: 'Research your first technology',
      category: 'science',
      trigger: [GameEventType.TECH_RESEARCHED],
      condition: (event, playerStats) => {
        return (
          event.type === GameEventType.TECH_RESEARCHED &&
          event.data.playerId === playerStats.playerId
        );
      },
      oneTime: true,
      enabled: true,
    });

    // Turn milestones
    this.achievements.set('turn_10', {
      id: 'turn_10',
      name: 'Survivor',
      description: 'Survive 10 turns',
      category: 'survival',
      trigger: [GameEventType.TURN_BEGIN],
      condition: (event, _playerStats) => {
        return event.type === GameEventType.TURN_BEGIN && event.data.turn >= 10;
      },
      oneTime: true,
      enabled: true,
    });

    logger.debug('Built-in achievements initialized', {
      gameId: this.gameId,
      achievementCount: this.achievements.size,
    });
  }

  /**
   * Add custom achievement
   */
  addAchievement(achievement: Achievement): void {
    this.achievements.set(achievement.id, achievement);
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
    const achievements = this.playerAchievements.get(playerId);
    return achievements ? Array.from(achievements) : [];
  }

  /**
   * Get achievement info
   */
  getAchievement(achievementId: string): Achievement | undefined {
    return this.achievements.get(achievementId);
  }

  /**
   * Clear event queue (for testing or reset)
   */
  clearEventQueue(): void {
    this.eventQueue = [];
    logger.debug('Event queue cleared', { gameId: this.gameId });
  }
}
