// Map Configuration
export const MAP_SIZES = {
  small: { width: 100, height: 100 },
  medium: { width: 140, height: 140 },
  large: { width: 160, height: 160 },
} as const;

// Unit Configuration
export const UNIT_STATS = {
  settler: { health: 100, movement: 2, combat: 0 },
  worker: { health: 100, movement: 2, combat: 0 },
  warrior: { health: 100, movement: 2, combat: 8 },
  scout: { health: 100, movement: 3, combat: 4 },
  archer: { health: 100, movement: 2, combat: 5 },
  swordsman: { health: 100, movement: 2, combat: 14 },
  spearman: { health: 100, movement: 2, combat: 11 },
} as const;

// Terrain Configuration
export const TERRAIN_STATS = {
  grassland: { food: 2, production: 0, gold: 0, moveCost: 1 },
  plains: { food: 1, production: 1, gold: 0, moveCost: 1 },
  desert: { food: 0, production: 0, gold: 0, moveCost: 1 },
  tundra: { food: 1, production: 0, gold: 0, moveCost: 1 },
  snow: { food: 0, production: 0, gold: 0, moveCost: 1 },
  hills: { food: 0, production: 2, gold: 0, moveCost: 2 },
  mountains: { food: 0, production: 0, gold: 0, moveCost: 99 }, // impassable
  forest: { food: 1, production: 1, gold: 0, moveCost: 2 },
  jungle: { food: 1, production: 0, gold: 0, moveCost: 2 },
  coast: { food: 1, production: 0, gold: 2, moveCost: 1 },
  ocean: { food: 1, production: 0, gold: 1, moveCost: 1 },
  lake: { food: 2, production: 0, gold: 1, moveCost: 1 },
} as const;

// Game Configuration
export const GAME_CONFIG = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 6,
  DEFAULT_TURN_TIMER: 300, // 5 minutes in seconds
  STARTING_GOLD: 0,
  STARTING_UNITS: ['settler', 'warrior'] as const,
} as const;

// WebSocket Events
export const SOCKET_EVENTS = {
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',
  JOIN_GAME: 'join_game',
  LEAVE_GAME: 'leave_game',
  GAME_ACTION: 'game_action',
  GAME_UPDATE: 'game_update',
  ERROR: 'error',
} as const;
