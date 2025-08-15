// Core Game Types
export interface Player {
  id: string;
  username: string;
  civilization: string;
  isActive: boolean;
}

export interface Game {
  id: string;
  name: string;
  status: 'waiting' | 'active' | 'completed';
  maxPlayers: number;
  currentTurn: number;
  currentPlayerId: string;
  createdAt: string;
  settings: GameSettings;
}

export interface GameSettings {
  mapSize: 'small' | 'medium' | 'large';
  turnTimer: number; // seconds
  allowSpectators: boolean;
}

// Map and Terrain
export interface MapTile {
  x: number;
  y: number;
  terrain: TerrainType;
  feature?: string;
  resource?: string;
  improvement?: string;
  ownerId?: string;
}

export type TerrainType = 
  | 'grassland' 
  | 'plains' 
  | 'desert' 
  | 'tundra' 
  | 'snow'
  | 'hills' 
  | 'mountains' 
  | 'forest' 
  | 'jungle'
  | 'coast' 
  | 'ocean' 
  | 'lake';

// Units
export interface Unit {
  id: string;
  gameId: string;
  playerId: string;
  type: UnitType;
  x: number;
  y: number;
  health: number;
  movementLeft: number;
  experience: number;
}

export type UnitType = 
  | 'settler' 
  | 'worker' 
  | 'warrior' 
  | 'scout' 
  | 'archer'
  | 'swordsman' 
  | 'spearman';

// Cities
export interface City {
  id: string;
  gameId: string;
  playerId: string;
  name: string;
  x: number;
  y: number;
  population: number;
  foodStored: number;
  productionStored: number;
}

// Player State
export interface PlayerState {
  gameId: string;
  playerId: string;
  gold: number;
  sciencePerTurn: number;
  culturePerTurn: number;
  happiness: number;
}

// WebSocket Events
export interface GameAction {
  type: GameActionType;
  playerId: string;
  data: any;
}

export type GameActionType = 
  | 'MOVE_UNIT'
  | 'FOUND_CITY'
  | 'END_TURN'
  | 'ATTACK'
  | 'BUILD_IMPROVEMENT';

// WebSocket Messages
export interface ServerMessage {
  type: ServerMessageType;
  data: any;
}

export type ServerMessageType = 
  | 'GAME_STATE_UPDATE'
  | 'PLAYER_ACTION'
  | 'TURN_STARTED'
  | 'GAME_ENDED'
  | 'ERROR';
