import { z } from 'zod';

// Packet type enum matching Freeciv's packet system
export enum PacketType {
  // Connection Management (0-20)
  PROCESSING_STARTED = 0,
  PROCESSING_FINISHED = 1,
  SERVER_JOIN_REQ = 4,
  SERVER_JOIN_REPLY = 5,
  AUTHENTICATION_REQ = 6,
  AUTHENTICATION_REPLY = 7,
  SERVER_SHUTDOWN = 8,

  // Player Management (10-30)
  NATION_SELECT_REQ = 10,
  PLAYER_READY = 11,
  ENDGAME_REPORT = 12,
  PLAYER_INFO = 13,
  PLAYER_REMOVE = 14,

  // Map & Tile (15-40)
  TILE_INFO = 15,
  GAME_INFO = 16,
  MAP_INFO = 17,
  NUKE_TILE_INFO = 18,
  MAP_VIEW_REQ = 19,
  TILE_VISIBILITY_REQ = 20,

  // Chat & Messages (25-30)
  CHAT_MSG = 25,
  CHAT_MSG_REQ = 26,
  CONNECT_MSG = 27,
  EARLY_CHAT_MSG = 28,
  SERVER_INFO = 29,

  // City Management (30-50)
  CITY_REMOVE = 30,
  CITY_INFO = 31,
  CITY_SHORT_INFO = 32,
  CITY_SELL = 33,
  CITY_BUY = 34,
  CITY_CHANGE = 35,
  CITY_WORKLIST = 36,
  CITY_MAKE_SPECIALIST = 37,
  CITY_MAKE_WORKER = 38,

  // Unit Management (50-80)
  UNIT_INFO = 50,
  UNIT_SHORT_INFO = 51,
  UNIT_MOVE = 52,
  UNIT_BUILD_CITY = 53,
  UNIT_DISBAND = 54,
  UNIT_CHANGE_HOMECITY = 55,
  UNIT_COMBAT_INFO = 56,
  UNIT_ORDERS = 57,
  UNIT_ATTACK = 58,
  UNIT_FORTIFY = 59,
  UNIT_CREATE = 60,

  // Turn Management (80-90)
  TURN_DONE = 80,
  NEW_TURN = 81,
  BEGIN_TURN = 82,
  END_TURN = 83,
  TURN_END_REPLY = 84,
  TURN_START = 85,
  FREEZE_CLIENT = 86,
  THAW_CLIENT = 87,

  // Custom for our implementation (200+)
  GAME_CREATE = 200,
  GAME_CREATE_REPLY = 201,
  GAME_JOIN = 202,
  GAME_JOIN_REPLY = 203,
  GAME_LEAVE = 204,
  GAME_START = 205,
  GAME_LIST = 206,
  PLAYER_LIST = 207,
  SERVER_MESSAGE = 208,
  UNIT_MOVE_REPLY = 209,
  UNIT_ATTACK_REPLY = 210,
  UNIT_FORTIFY_REPLY = 211,
  UNIT_CREATE_REPLY = 212,
  MAP_VIEW_REPLY = 213,
  TILE_VISIBILITY_REPLY = 214,
  CITY_FOUND = 215,
  CITY_FOUND_REPLY = 216,
  CITY_PRODUCTION_CHANGE = 217,
  CITY_PRODUCTION_CHANGE_REPLY = 218,
  RESEARCH_SET = 219,
  RESEARCH_SET_REPLY = 220,
  RESEARCH_GOAL_SET = 221,
  RESEARCH_GOAL_SET_REPLY = 222,
  RESEARCH_LIST = 223,
  RESEARCH_LIST_REPLY = 224,
  RESEARCH_PROGRESS = 225,
  RESEARCH_PROGRESS_REPLY = 226,
}

// Base packet interface
export interface Packet<T = any> {
  type: PacketType;
  seq?: number;
  timestamp?: number;
  data: T;
}

// Connection packets
export const ServerJoinReqSchema = z.object({
  username: z.string().min(1).max(32),
  version: z.string(),
  capability: z.string().optional(),
});

export const ServerJoinReplySchema = z.object({
  accepted: z.boolean(),
  playerId: z.string().optional(),
  message: z.string().optional(),
  capability: z.string().optional(),
});

// Game packets
export const GameInfoSchema = z.object({
  gameId: z.string(),
  name: z.string(),
  turn: z.number(),
  phase: z.string(),
  year: z.number(),
  players: z.number(),
  maxPlayers: z.number(),
});

// Chat packets
export const ChatMsgSchema = z.object({
  sender: z.string(),
  message: z.string(),
  channel: z.enum(['all', 'team', 'private']),
  recipient: z.string().optional(),
});

// Map packets
export const TileInfoSchema = z.object({
  x: z.number(),
  y: z.number(),
  terrain: z.string(),
  owner: z.string().optional(),
  city: z.string().optional(),
  units: z.array(z.string()),
  improvements: z.array(z.string()),
});

// Unit packets
export const UnitMoveSchema = z.object({
  unitId: z.string(),
  x: z.number(),
  y: z.number(),
});

export const UnitAttackSchema = z.object({
  attackerUnitId: z.string(),
  defenderUnitId: z.string(),
});

export const UnitFortifySchema = z.object({
  unitId: z.string(),
});

export const UnitCreateSchema = z.object({
  unitType: z.string(),
  x: z.number(),
  y: z.number(),
});

export const TileVisibilityReqSchema = z.object({
  x: z.number(),
  y: z.number(),
});

// City packets
export const CityFoundSchema = z.object({
  name: z.string().min(1).max(100),
  x: z.number(),
  y: z.number(),
});

export const CityInfoSchema = z.object({
  id: z.string(),
  gameId: z.string(),
  playerId: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  population: z.number(),
  foodStock: z.number(),
  foodPerTurn: z.number(),
  productionStock: z.number(),
  productionPerTurn: z.number(),
  currentProduction: z.string().optional(),
  productionType: z.enum(['unit', 'building']).optional(),
  turnsToComplete: z.number(),
  goldPerTurn: z.number(),
  sciencePerTurn: z.number(),
  culturePerTurn: z.number(),
  buildings: z.array(z.string()),
  workingTiles: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
    })
  ),
  isCapital: z.boolean(),
  defenseStrength: z.number(),
  happinessLevel: z.number(),
  healthLevel: z.number(),
  foundedTurn: z.number(),
});

export const CityProductionChangeSchema = z.object({
  cityId: z.string(),
  production: z.string(),
  type: z.enum(['unit', 'building']),
});

export const CityFoundReplySchema = z.object({
  success: z.boolean(),
  cityId: z.string().optional(),
  message: z.string().optional(),
});

export const CityProductionChangeReplySchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

// Research packets
export const ResearchSetSchema = z.object({
  techId: z.string(),
});

export const ResearchSetReplySchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  availableTechs: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        cost: z.number(),
        requirements: z.array(z.string()),
        description: z.string().optional(),
      })
    )
    .optional(),
});

export const ResearchGoalSetSchema = z.object({
  techId: z.string(),
});

export const ResearchGoalSetReplySchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

export const ResearchListSchema = z.object({});

export const ResearchListReplySchema = z.object({
  availableTechs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      cost: z.number(),
      requirements: z.array(z.string()),
      description: z.string().optional(),
    })
  ),
  researchedTechs: z.array(z.string()),
});

export const ResearchProgressSchema = z.object({});

export const ResearchProgressReplySchema = z.object({
  currentTech: z.string().optional(),
  techGoal: z.string().optional(),
  current: z.number(),
  required: z.number(),
  turnsRemaining: z.number(),
});

//Game management packets
export const GameCreateSchema = z.object({
  name: z.string().min(1).max(100),
  maxPlayers: z.number().min(2).max(16).optional(),
  mapWidth: z.number().min(40).max(200).optional(),
  mapHeight: z.number().min(30).max(150).optional(),
  ruleset: z.string().optional(),
  turnTimeLimit: z.number().optional(),
  victoryConditions: z.array(z.string()).optional(),
});

export const GameCreateReplySchema = z.object({
  success: z.boolean(),
  gameId: z.string().optional(),
  message: z.string().optional(),
});

export const GameJoinSchema = z.object({
  gameId: z.string(),
  civilization: z.string().optional(),
});

export const GameJoinReplySchema = z.object({
  success: z.boolean(),
  playerId: z.string().optional(),
  message: z.string().optional(),
});

export const TurnEndReplySchema = z.object({
  success: z.boolean(),
  turnAdvanced: z.boolean().optional(),
  message: z.string().optional(),
});

export const ServerMessageSchema = z.object({
  message: z.string(),
  type: z.enum(['info', 'warning', 'error']).optional(),
});

export const UnitMoveReplySchema = z.object({
  success: z.boolean(),
  unitId: z.string(),
  newX: z.number().optional(),
  newY: z.number().optional(),
  movementLeft: z.number().optional(),
  message: z.string().optional(),
});

export const UnitAttackReplySchema = z.object({
  success: z.boolean(),
  combatResult: z
    .object({
      attackerId: z.string(),
      defenderId: z.string(),
      attackerDamage: z.number(),
      defenderDamage: z.number(),
      attackerDestroyed: z.boolean(),
      defenderDestroyed: z.boolean(),
    })
    .optional(),
  message: z.string().optional(),
});

export const UnitFortifyReplySchema = z.object({
  success: z.boolean(),
  unitId: z.string(),
  message: z.string().optional(),
});

export const UnitCreateReplySchema = z.object({
  success: z.boolean(),
  unitId: z.string().optional(),
  message: z.string().optional(),
});

export const MapViewReplySchema = z.object({
  mapData: z.any(), // Complex map structure
});

export const TileVisibilityReplySchema = z.object({
  x: z.number(),
  y: z.number(),
  isVisible: z.boolean(),
  isExplored: z.boolean(),
  lastSeen: z.date().optional(),
});

// Type exports
export type ServerJoinReq = z.infer<typeof ServerJoinReqSchema>;
export type ServerJoinReply = z.infer<typeof ServerJoinReplySchema>;
export type GameInfo = z.infer<typeof GameInfoSchema>;
export type ChatMsg = z.infer<typeof ChatMsgSchema>;
export type TileInfo = z.infer<typeof TileInfoSchema>;
export type UnitMove = z.infer<typeof UnitMoveSchema>;
export type UnitAttack = z.infer<typeof UnitAttackSchema>;
export type UnitFortify = z.infer<typeof UnitFortifySchema>;
export type UnitCreate = z.infer<typeof UnitCreateSchema>;
export type GameCreate = z.infer<typeof GameCreateSchema>;
export type GameCreateReply = z.infer<typeof GameCreateReplySchema>;
export type GameJoin = z.infer<typeof GameJoinSchema>;
export type GameJoinReply = z.infer<typeof GameJoinReplySchema>;
export type TurnEndReply = z.infer<typeof TurnEndReplySchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type UnitMoveReply = z.infer<typeof UnitMoveReplySchema>;
export type UnitAttackReply = z.infer<typeof UnitAttackReplySchema>;
export type UnitFortifyReply = z.infer<typeof UnitFortifyReplySchema>;
export type UnitCreateReply = z.infer<typeof UnitCreateReplySchema>;
export type TileVisibilityReq = z.infer<typeof TileVisibilityReqSchema>;
export type MapViewReply = z.infer<typeof MapViewReplySchema>;
export type TileVisibilityReply = z.infer<typeof TileVisibilityReplySchema>;
export type CityFound = z.infer<typeof CityFoundSchema>;
export type CityInfo = z.infer<typeof CityInfoSchema>;
export type CityProductionChange = z.infer<typeof CityProductionChangeSchema>;
export type CityFoundReply = z.infer<typeof CityFoundReplySchema>;
export type CityProductionChangeReply = z.infer<typeof CityProductionChangeReplySchema>;
export type ResearchSet = z.infer<typeof ResearchSetSchema>;
export type ResearchSetReply = z.infer<typeof ResearchSetReplySchema>;
export type ResearchGoalSet = z.infer<typeof ResearchGoalSetSchema>;
export type ResearchGoalSetReply = z.infer<typeof ResearchGoalSetReplySchema>;
export type ResearchList = z.infer<typeof ResearchListSchema>;
export type ResearchListReply = z.infer<typeof ResearchListReplySchema>;
export type ResearchProgress = z.infer<typeof ResearchProgressSchema>;
export type ResearchProgressReply = z.infer<typeof ResearchProgressReplySchema>;
