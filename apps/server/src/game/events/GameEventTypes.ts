export enum GameEventType {
  TURN_BEGIN = 'turn_begin',
  TURN_END = 'turn_end',
  PHASE_START = 'phase_start',
  PHASE_END = 'phase_end',
  CITY_FOUNDED = 'city_founded',
  CITY_GROWTH = 'city_growth',
  CITY_PRODUCTION_COMPLETE = 'city_production_complete',
  CITY_BUILDING_BUILT = 'city_building_built',
  UNIT_CREATED = 'unit_created',
  UNIT_DESTROYED = 'unit_destroyed',
  UNIT_PROMOTED = 'unit_promoted',
  UNIT_MOVED = 'unit_moved',
  UNIT_MOVEMENT_SUMMARY = 'unit_movement_summary',
  TECH_RESEARCHED = 'tech_researched',
  RESEARCH_STARTED = 'research_started',
  COMBAT_OCCURRED = 'combat_occurred',
  UNIT_KILLED = 'unit_killed',
  TRADE_ROUTE_ESTABLISHED = 'trade_route_established',
  ACHIEVEMENT_UNLOCKED = 'achievement_unlocked',
  MILESTONE_REACHED = 'milestone_reached',
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
  turnId?: string;
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
  reward?: { type: 'bonus' | 'unlock' | 'message'; value: any };
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
  eventsDropped: number;
  persistenceFailures: number;
  achievementsUnlocked: number;
  duration: number;
  errors: string[];
}

export interface GameEventTelemetryDiagnostics {
  droppedEvents: number;
  persistenceFailures: number;
  pendingEvents: number;
  pendingMovementSummaries: number;
}

export interface UnitMovementAggregate {
  unitId: string;
  unitTypeId: string;
  moveCount: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface EventTurnContext {
  turnId?: string;
  turn: number;
  year: number;
}

export interface PlayerEventStats {
  playerId: string;
  citiesCount: number;
  unitsCount: number;
  technologiesCount: number;
  score: number;
  turn: number;
}
