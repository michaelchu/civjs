import { logger } from '@utils/logger';
import { GameEventType, type EventHandler, type GameEvent } from './GameEventTypes';

/** Executes each successful handler at most once for a queued event retry cycle. */
export class EventHandlerRegistry {
  private readonly handlers = new Map<GameEventType, EventHandler[]>();
  private readonly completedByEvent = new Map<string, Set<string>>();

  constructor(private readonly gameId: string) {}

  register(handler: EventHandler): void {
    const handlers = this.handlers.get(handler.eventType) ?? [];
    const existingIndex = handlers.findIndex(candidate => candidate.id === handler.id);
    if (existingIndex >= 0) handlers[existingIndex] = handler;
    else handlers.push(handler);
    handlers.sort((left, right) => right.priority - left.priority);
    this.handlers.set(handler.eventType, handlers);
  }

  async handle(event: GameEvent): Promise<boolean> {
    const handlers = this.handlers.get(event.type) ?? [];
    if (handlers.length === 0) return true;

    let completed = this.completedByEvent.get(event.id);
    if (!completed) {
      completed = new Set();
      this.completedByEvent.set(event.id, completed);
    }

    let allSucceeded = true;
    for (const handler of handlers) {
      if (completed.has(handler.id)) continue;
      try {
        if (await handler.handler(event)) {
          completed.add(handler.id);
        } else {
          allSucceeded = false;
          logger.warn('Event handler returned false', {
            gameId: this.gameId,
            eventId: event.id,
            handlerId: handler.id,
            eventType: event.type,
          });
        }
      } catch (error) {
        allSucceeded = false;
        logger.error('Event handler threw error', {
          gameId: this.gameId,
          eventId: event.id,
          handlerId: handler.id,
          eventType: event.type,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    return allSucceeded;
  }

  discard(eventId: string): void {
    this.completedByEvent.delete(eventId);
  }

  clear(): void {
    this.completedByEvent.clear();
  }
}
