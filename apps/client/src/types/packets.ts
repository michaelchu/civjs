/* eslint-disable @typescript-eslint/no-explicit-any */
// Socket.IO packet types that match our server implementation
export const PacketType = {
  // Game flow
  GAME_STARTED: 'GAME_STARTED',
  GAME_ENDED: 'GAME_ENDED',
  TURN_STARTED: 'TURN_STARTED',
  TURN_ENDED: 'TURN_ENDED',

  // Player actions
  PLAYER_JOINED: 'PLAYER_JOINED',
  PLAYER_LEFT: 'PLAYER_LEFT',
  PLAYER_READY: 'PLAYER_READY',

  // Units
  UNIT_MOVED: 'UNIT_MOVED',
  UNIT_CREATED: 'UNIT_CREATED',
  UNIT_DESTROYED: 'UNIT_DESTROYED',
  MOVE_UNIT: 'MOVE_UNIT',

  // Cities
  CITY_FOUNDED: 'CITY_FOUNDED',
  CITY_UPDATED: 'CITY_UPDATED',
  CITY_DESTROYED: 'CITY_DESTROYED',
  FOUND_CITY: 'FOUND_CITY',

  // Research
  RESEARCH_COMPLETED: 'RESEARCH_COMPLETED',
  RESEARCH_PROGRESS: 'RESEARCH_PROGRESS',
  RESEARCH_SET: 'RESEARCH_SET',

  // Map
  MAP_UPDATE: 'MAP_UPDATE',
  TILE_UPDATE: 'TILE_UPDATE',

  // General
  GAME_STATE: 'GAME_STATE',
  ERROR: 'ERROR',
} as const;

export type PacketType = typeof PacketType[keyof typeof PacketType];

// Packet interfaces
export interface GameStatePacket {
  type: typeof PacketType.GAME_STATE;
  data: {
    turn: number;
    currentPlayerId: string;
    players: Record<string, any>;
    map: any;
    units: Record<string, any>;
    cities: Record<string, any>;
  };
}

export interface MoveUnitPacket {
  type: typeof PacketType.MOVE_UNIT;
  data: {
    unitId: string;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
  };
}

export interface FoundCityPacket {
  type: typeof PacketType.FOUND_CITY;
  data: {
    name: string;
    x: number;
    y: number;
  };
}

export interface ResearchSetPacket {
  type: typeof PacketType.RESEARCH_SET;
  data: {
    techId: string;
  };
}

export type SocketPacket =
  | GameStatePacket
  | MoveUnitPacket
  | FoundCityPacket
  | ResearchSetPacket;
