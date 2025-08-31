/* eslint-disable @typescript-eslint/no-explicit-any */
// Numeric packet types matching server implementation and freeciv-web reference
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

// Debug helper for development - maps numeric types to readable names
export const PACKET_NAMES: Record<number, string> = {
  [PacketType.PROCESSING_STARTED]: 'PROCESSING_STARTED',
  [PacketType.PROCESSING_FINISHED]: 'PROCESSING_FINISHED',
  [PacketType.SERVER_JOIN_REQ]: 'SERVER_JOIN_REQ',
  [PacketType.SERVER_JOIN_REPLY]: 'SERVER_JOIN_REPLY',
  [PacketType.TILE_INFO]: 'TILE_INFO',
  [PacketType.GAME_INFO]: 'GAME_INFO',
  [PacketType.MAP_INFO]: 'MAP_INFO',
  [PacketType.CHAT_MSG]: 'CHAT_MSG',
  [PacketType.CHAT_MSG_REQ]: 'CHAT_MSG_REQ',
  [PacketType.CONNECT_MSG]: 'CONNECT_MSG',
  [PacketType.CITY_INFO]: 'CITY_INFO',
  [PacketType.UNIT_INFO]: 'UNIT_INFO',
  [PacketType.UNIT_MOVE]: 'UNIT_MOVE',
  [PacketType.UNIT_ATTACK]: 'UNIT_ATTACK',
  [PacketType.UNIT_FORTIFY]: 'UNIT_FORTIFY',
  [PacketType.UNIT_CREATE]: 'UNIT_CREATE',
  [PacketType.TURN_START]: 'TURN_START',
  [PacketType.END_TURN]: 'END_TURN',
  [PacketType.GAME_CREATE]: 'GAME_CREATE',
  [PacketType.GAME_CREATE_REPLY]: 'GAME_CREATE_REPLY',
  [PacketType.GAME_JOIN]: 'GAME_JOIN',
  [PacketType.GAME_JOIN_REPLY]: 'GAME_JOIN_REPLY',
  [PacketType.UNIT_MOVE_REPLY]: 'UNIT_MOVE_REPLY',
  [PacketType.UNIT_ATTACK_REPLY]: 'UNIT_ATTACK_REPLY',
  [PacketType.UNIT_FORTIFY_REPLY]: 'UNIT_FORTIFY_REPLY',
  [PacketType.UNIT_CREATE_REPLY]: 'UNIT_CREATE_REPLY',
  [PacketType.CITY_FOUND]: 'CITY_FOUND',
  [PacketType.CITY_FOUND_REPLY]: 'CITY_FOUND_REPLY',
  [PacketType.RESEARCH_SET]: 'RESEARCH_SET',
  [PacketType.RESEARCH_SET_REPLY]: 'RESEARCH_SET_REPLY',
};

// Base packet interface matching server
export interface Packet<T = any> {
  type: PacketType;
  seq?: number;
  timestamp?: number;
  data: T;
}

// Specific packet interfaces
export interface GameStatePacket {
  type: PacketType.GAME_INFO;
  data: {
    turn: number;
    currentPlayerId: string;
    players: Record<string, any>;
    map: any;
    units: Record<string, any>;
    cities: Record<string, any>;
  };
}

export interface UnitMovePacket {
  type: PacketType.UNIT_MOVE;
  data: {
    unitId: string;
    x: number;
    y: number;
  };
}

export interface UnitMoveReplyPacket {
  type: PacketType.UNIT_MOVE_REPLY;
  data: {
    success: boolean;
    unitId: string;
    newX?: number;
    newY?: number;
    movementLeft?: number;
    message?: string;
  };
}

export interface CityFoundPacket {
  type: PacketType.CITY_FOUND;
  data: {
    name: string;
    x: number;
    y: number;
  };
}

export interface CityFoundReplyPacket {
  type: PacketType.CITY_FOUND_REPLY;
  data: {
    success: boolean;
    cityId?: string;
    message?: string;
  };
}

export interface ResearchSetPacket {
  type: PacketType.RESEARCH_SET;
  data: {
    techId: string;
  };
}

export interface ResearchSetReplyPacket {
  type: PacketType.RESEARCH_SET_REPLY;
  data: {
    success: boolean;
    message?: string;
    availableTechs?: Array<{
      id: string;
      name: string;
      cost: number;
      requirements: string[];
      description?: string;
    }>;
  };
}

export interface TurnStartPacket {
  type: PacketType.TURN_START;
  data: {
    turn: number;
    year: number;
  };
}

// Map & Tile packets - Enhanced for structured packet system
export interface MapInfoPacket {
  type: PacketType.MAP_INFO;
  data: {
    xsize: number;
    ysize: number;
    topology?: number;
    wrap_id?: number;
    startpos?: Array<{
      x: number;
      y: number;
    }>;
  };
}

export interface TileInfoPacket {
  type: PacketType.TILE_INFO;
  data: {
    tile: number; // tile index
    x: number;
    y: number;
    terrain: string;
    resource?: string;
    elevation?: number;
    riverMask?: number;
    known: number; // 0 = unknown, 1 = known
    seen: number; // 0 = unseen, 1 = visible
    player?: string | null;
    worked?: string | null;
    extras?: number;
  };
}

export interface TileInfoBatchPacket {
  type: PacketType.TILE_INFO; // Using TILE_INFO for batches too
  data: {
    tiles: Array<{
      tile: number;
      x: number;
      y: number;
      terrain: string;
      resource?: string;
      elevation?: number;
      riverMask?: number;
      known: number;
      seen: number;
      player?: string | null;
      worked?: string | null;
      extras?: number;
    }>;
    startIndex: number;
    endIndex: number;
    total: number;
  };
}

// Processing packets
export interface ProcessingStartedPacket {
  type: PacketType.PROCESSING_STARTED;
  data: Record<string, never>; // Empty object
}

export interface ProcessingFinishedPacket {
  type: PacketType.PROCESSING_FINISHED;
  data: Record<string, never>; // Empty object
}

// Authentication packets
export interface AuthenticationReqPacket {
  type: PacketType.AUTHENTICATION_REQ;
  data: {
    username: string;
    password: string;
  };
}

export interface AuthenticationReplyPacket {
  type: PacketType.AUTHENTICATION_REPLY;
  data: {
    accepted: boolean;
    message?: string;
  };
}

// Player management packets
export interface PlayerInfoPacket {
  type: PacketType.PLAYER_INFO;
  data: {
    id: string;
    name: string;
    nation: string;
    team?: string;
    score: number;
    gold: number;
    science: number;
    culture: number;
    government: string;
    alive: boolean;
  };
}

export interface ServerJoinReplyPacket {
  type: PacketType.SERVER_JOIN_REPLY;
  data: {
    accepted: boolean;
    playerId?: string;
    message?: string;
    capability?: string;
  };
}

export type SocketPacket =
  | GameStatePacket
  | UnitMovePacket
  | UnitMoveReplyPacket
  | CityFoundPacket
  | CityFoundReplyPacket
  | ResearchSetPacket
  | ResearchSetReplyPacket
  | TurnStartPacket
  | ServerJoinReplyPacket
  | MapInfoPacket
  | TileInfoPacket
  | TileInfoBatchPacket
  | ProcessingStartedPacket
  | ProcessingFinishedPacket
  | AuthenticationReqPacket
  | AuthenticationReplyPacket
  | PlayerInfoPacket;
