// Game State Types
export interface Player {
  id: string;
  gameId: string;
  userId: string;
  playerNumber: number;
  civilization: string;
  leaderName: string;
  color: { r: number; g: number; b: number };
  isAlive: boolean;
  isAI: boolean;
  isReady: boolean;
  hasEndedTurn: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'away';
  gold: number;
  science: number;
  culture: number;
  faith: number;
  technologies: string[];
  currentResearch?: string;
  researchProgress: number;
  score: number;
  knownPlayers: string[];
  diplomaticRelations: Record<string, string>;
  exploredTiles: Array<{ x: number; y: number }>;
  visibleTiles: Array<{ x: number; y: number }>;
  joinedAt: Date;
  lastActionAt: Date;
  eliminatedAt?: Date;
}

export interface Game {
  id: string;
  name: string;
  hostId: string;
  status: 'waiting' | 'starting' | 'active' | 'paused' | 'finished';
  currentTurn: number;
  turnPhase: 'movement' | 'production' | 'research' | 'diplomacy';
  maxPlayers: number;
  mapWidth: number;
  mapHeight: number;
  victoryConditions: string[];
  ruleset: string;
  mapSeed?: string;
  mapData?: any;
  turnTimeLimit?: number;
  turnStartedAt?: Date;
  pausedAt?: Date;
  startedAt?: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  gameState?: any;
}

export interface Unit {
  id: string;
  gameId: string;
  playerId: string;
  unitType: string;
  name?: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  attackStrength: number;
  defenseStrength: number;
  rangedStrength: number;
  movementPoints: number;
  maxMovementPoints: number;
  experience: number;
  veteranLevel: number;
  promotions: string[];
  orders: any[];
  currentOrder?: string;
  destination?: { x: number; y: number };
  isEmbarked: boolean;
  isFortified: boolean;
  isAutomated: boolean;
  canMove: boolean;
  cargoUnits: string[];
  homeCityId?: string;
  createdTurn: number;
  lastActionTurn?: number;
}

export interface City {
  id: string;
  gameId: string;
  playerId: string;
  name: string;
  x: number;
  y: number;
  population: number;
  food: number;
  foodPerTurn: number;
  production: number;
  productionPerTurn: number;
  currentProduction?: string;
  productionQueue: any[];
  goldPerTurn: number;
  sciencePerTurn: number;
  culturePerTurn: number;
  faithPerTurn: number;
  buildings: string[];
  workedTiles: Array<{ x: number; y: number }>;
  specialists: Record<string, number>;
  happiness: number;
  health: number;
  isCapital: boolean;
  isPuppet: boolean;
  isOccupied: boolean;
  defenseStrength: number;
  wallsLevel: number;
  foundedTurn: number;
  capturedTurn?: number;
  createdAt: Date;
}

// Packet Types for Socket.IO communication
export interface PacketPlayerConnect {
  type: 'player_connect';
  playerId: string;
  playerName: string;
}

export interface PacketPlayerDisconnect {
  type: 'player_disconnect';
  playerId: string;
}

export interface PacketGameStart {
  type: 'game_start';
  gameState: Game;
  players: Player[];
}

export interface PacketTurnDone {
  type: 'turn_done';
  playerId: string;
}

export interface PacketUnitMove {
  type: 'unit_move';
  unitId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface PacketChatMessage {
  type: 'chat_message';
  playerId: string;
  message: string;
  timestamp: Date;
}

export interface PacketError {
  type: 'error';
  message: string;
  code?: string;
}

export type GamePacket = 
  | PacketPlayerConnect
  | PacketPlayerDisconnect
  | PacketGameStart
  | PacketTurnDone
  | PacketUnitMove
  | PacketChatMessage
  | PacketError;

// Client State Types
export interface GameState {
  currentGame?: Game;
  players: Record<string, Player>;
  units: Record<string, Unit>;
  cities: Record<string, City>;
  currentPlayer?: Player;
  visibleTiles: Set<string>;
  selectedUnit?: Unit;
  selectedCity?: City;
  chatMessages: Array<{
    playerId: string;
    playerName: string;
    message: string;
    timestamp: Date;
  }>;
}

export interface ClientState {
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  gameState: GameState;
  ui: {
    activeTab: 'map' | 'cities' | 'units' | 'research' | 'diplomacy';
    showChat: boolean;
    selectedTile?: { x: number; y: number };
  };
}

// Map and Rendering Types
export interface Tile {
  x: number;
  y: number;
  terrain: string;
  features: string[];
  resources?: string;
  improvements?: string[];
  unitId?: string;
  cityId?: string;
  isVisible: boolean;
  isExplored: boolean;
}

export interface RenderState {
  tiles: Tile[][];
  units: Unit[];
  cities: City[];
  viewportX: number;
  viewportY: number;
  zoom: number;
  selectedTile?: { x: number; y: number };
  selectedUnit?: Unit;
}