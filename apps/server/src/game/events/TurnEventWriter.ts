/**
 * @module server/game/events/TurnEventWriter
 * Defines Turn Event Writer game event behavior and contracts.
 */
import type { DatabaseProvider } from '@database';
import { turnEvents, type NewTurnEvent } from '@database/schema/turn-events';
import { logger } from '@utils/logger';
import { GameEventType, type GameEvent } from './GameEventTypes';

/** Persists already-accepted game events as durable turn telemetry. */
export class TurnEventWriter {
  constructor(
    private readonly gameId: string,
    private readonly databaseProvider: DatabaseProvider
  ) {}

  async write(events: GameEvent[], fallbackTurnId: string | null): Promise<boolean> {
    if (events.length === 0 || !fallbackTurnId) return true;
    try {
      await this.databaseProvider
        .getDatabase()
        .insert(turnEvents)
        .values(events.map(event => this.buildRecord(event, fallbackTurnId)));
      return true;
    } catch (error) {
      logger.warn('Failed to save events to database', {
        gameId: this.gameId,
        eventCount: events.length,
        eventTypes: [...new Set(events.map(event => event.type))],
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  private buildRecord(event: GameEvent, fallbackTurnId: string): NewTurnEvent {
    return {
      gameId: this.gameId,
      turnId: event.turnId ?? fallbackTurnId,
      playerId: event.data.playerId ?? null,
      eventType: event.type,
      eventCategory: eventCategory(event.type),
      occurredAt: new Date(event.createdAt),
      title: eventTitle(event),
      description: null,
      eventData: event.data,
      priority: event.priority,
      isVisible: isVisibleEvent(event.type),
      isAchievement: event.type === GameEventType.ACHIEVEMENT_UNLOCKED,
      status: 'completed',
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
}

function eventCategory(eventType: GameEventType): string {
  const categories: Partial<Record<GameEventType, string>> = {
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
    [GameEventType.UNIT_MOVEMENT_SUMMARY]: 'unit',
    [GameEventType.TECH_RESEARCHED]: 'research',
    [GameEventType.RESEARCH_STARTED]: 'research',
    [GameEventType.COMBAT_OCCURRED]: 'combat',
    [GameEventType.UNIT_KILLED]: 'combat',
    [GameEventType.TRADE_ROUTE_ESTABLISHED]: 'trade',
    [GameEventType.ACHIEVEMENT_UNLOCKED]: 'achievement',
    [GameEventType.MILESTONE_REACHED]: 'achievement',
    [GameEventType.CUSTOM_EVENT]: 'custom',
  };
  return categories[eventType] ?? 'other';
}

function eventTitle(event: GameEvent): string {
  const titles: Partial<Record<GameEventType, (data: GameEvent['data']) => string>> = {
    [GameEventType.CITY_FOUNDED]: data => `City "${data.cityName || 'Unknown'}" founded`,
    [GameEventType.UNIT_CREATED]: data => `${data.unitType || 'Unit'} created`,
    [GameEventType.UNIT_MOVEMENT_SUMMARY]: data =>
      `${data.moveCount || 0} unit movement(s) recorded`,
    [GameEventType.TECH_RESEARCHED]: data => `${data.techName || 'Technology'} researched`,
    [GameEventType.TRADE_ROUTE_ESTABLISHED]: data =>
      `Trade route established from ${data.sourceCityId || 'city'} to ${data.partnerCityId || 'city'}`,
    [GameEventType.ACHIEVEMENT_UNLOCKED]: data =>
      `Achievement: ${data.achievementName || 'Unknown'}`,
    [GameEventType.TURN_BEGIN]: data => `Turn ${data.turn} began`,
    [GameEventType.TURN_END]: data => `Turn ${data.turn} completed`,
  };
  return titles[event.type]?.(event.data) ?? `${event.type} event`;
}

function isVisibleEvent(eventType: GameEventType): boolean {
  return new Set<GameEventType>([
    GameEventType.CITY_FOUNDED,
    GameEventType.CITY_GROWTH,
    GameEventType.UNIT_CREATED,
    GameEventType.TECH_RESEARCHED,
    GameEventType.ACHIEVEMENT_UNLOCKED,
    GameEventType.COMBAT_OCCURRED,
    GameEventType.TRADE_ROUTE_ESTABLISHED,
  ]).has(eventType);
}
