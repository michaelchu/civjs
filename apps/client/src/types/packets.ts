/**
 * @module client/types/packets
 * Declares packets client contracts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export { PacketType, PACKET_NAMES, PROTOCOL_VERSION } from '@protocol';
import { PacketType } from '@protocol';

// Base packet interface matching server
export interface Packet<T = any> {
  type: PacketType;
  version?: number;
  seq?: number;
  requestId?: string;
  timestamp?: number;
  data: T;
}

/**
 * Freeciv-compatible spaceship placement request. The server remains the
 * authority for whether a requested part is currently available and attached
 * to the existing ship.
 */
export type SpaceshipPlacement =
  | { kind: 'structural'; index: number }
  | { kind: 'fuel'; number: number }
  | { kind: 'propulsion'; number: number }
  | { kind: 'habitation'; number: number }
  | { kind: 'life_support'; number: number }
  | { kind: 'solar_panel'; number: number };

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
    phase?: 'movement' | 'research' | 'production' | 'diplomacy';
    year?: number;
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
      flags: string[];
      description?: string;
    }>;
  };
}

export interface TurnStartPacket {
  type: PacketType.TURN_START;
  data: {
    turn: number;
    year: number;
    phase?: 'movement' | 'research' | 'production' | 'diplomacy';
  };
}

export interface NewYearPacket {
  type: PacketType.NEW_YEAR;
  data: {
    turn: number;
    year: number;
    fragments?: number; // Calendar fragments for sub-year precision
  };
}

// Map & Tile packets - Enhanced for structured packet system
export interface MapInfoPacket {
  type: PacketType.MAP_INFO;
  data: {
    xsize: number;
    ysize: number;
    topology?: number;
    topology_id?: number;
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
    hasRoad?: boolean;
    hasRailroad?: boolean;
    improvements?: string[];
    cityId?: string;
    owner?: string;
    claimer?: string;
    known: number; // Freeciv known_type: 0 = unknown, 1 = fogged, 2 = seen
    seen: number; // compatibility flag: 0 = unseen, 1 = visible
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
      hasRoad?: boolean;
      hasRailroad?: boolean;
      improvements?: string[];
      cityId?: string;
      owner?: string;
      claimer?: string;
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
    nationGraphic?: string;
    team?: string;
    teamId?: string;
    score: number;
    gold: number;
    goldPerTurn?: number;
    science: number;
    sciencePerTurn?: number;
    taxRate?: number;
    luxuryRate?: number;
    scienceRate?: number;
    culture: number;
    spaceshipState?: Record<string, unknown>;
    government: string;
    alive: boolean;
    isAI?: boolean;
    color: {
      r: number;
      g: number;
      b: number;
    };
  };
}

export interface EndGameReportData {
  version: 1;
  gameId: string;
  turn: number;
  year: number;
  reason:
    | 'conquest'
    | 'team'
    | 'allied'
    | 'culture'
    | 'world_peace'
    | 'science'
    | 'scenario'
    | 'max_turns';
  winnerPlayerId: string;
  winnerPlayerIds: string[];
  endedAt: string;
  standings: Array<{
    playerId: string;
    civilization: string;
    score: number;
    cities: number;
    population: number;
    units: number;
    technologies: number;
    history: number;
    alive: boolean;
  }>;
}

export interface EndGameReportPacket {
  type: PacketType.ENDGAME_REPORT;
  data: EndGameReportData;
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
  | NewYearPacket
  | ServerJoinReplyPacket
  | MapInfoPacket
  | TileInfoPacket
  | TileInfoBatchPacket
  | ProcessingStartedPacket
  | ProcessingFinishedPacket
  | AuthenticationReqPacket
  | AuthenticationReplyPacket
  | PlayerInfoPacket
  | EndGameReportPacket;
