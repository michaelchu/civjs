// Basic game types
export interface Tile {
  x: number;
  y: number;
  terrain: string;
  units?: Unit[];
  city?: City;
  visible: boolean;
  known: boolean;
  resource?: string;
  elevation?: number;
  riverMask?: number; // River connection bitmask: N=1, E=2, S=4, W=8
  owner?: string; // Player ID who owns this tile
  claimer?: string; // Player ID who is claiming this tile
}

export interface Unit {
  id: string;
  playerId: string;
  unitTypeId: string;
  x: number;
  y: number;
  hp: number;
  movesLeft: number;
  veteranLevel: number;
}

export interface ProductionOption {
  id: string;
  name: string;
  type: 'unit' | 'building' | 'wonder';
  cost: number;
  description?: string;
  requirements?: string[];
  available: boolean;
}

export interface City {
  id: string;
  name: string;
  playerId: string;
  x: number;
  y: number;
  size: number;
  // Current output
  food: number;
  shields: number;
  trade: number;
  // Culture system (freeciv-based)
  history: number; // Accumulated culture history
  culturePerTurn: number; // Culture generated per turn
  // Production breakdown (total production before usage)
  prod: {
    food: number;
    shields: number;
    trade: number;
    gold: number;
    luxury: number;
    science: number;
    culture: number;
  };
  // Net surplus/deficit after consumption
  surplus: {
    food: number;
    shields: number;
    trade: number;
    gold: number;
    luxury: number;
    science: number;
    culture: number;
  };
  // Waste/corruption
  waste: {
    shields: number;
    trade: number;
  };
  // Population details
  foodStock: number;
  granarySize: number;
  granaryTurns: number; // positive = growth, negative = starvation
  // Citizens
  citizens: {
    happy: number;
    content: number;
    unhappy: number;
    angry: number;
    specialists: Record<string, number>; // specialist type -> count
  };
  // Buildings with upkeep
  buildings: Array<{
    id: string;
    name: string;
    upkeep: number;
  }>;
  // Units
  presentUnits: string[]; // Unit IDs in the city
  supportedUnits: string[]; // Unit IDs supported by this city
  // Production
  production?: {
    target: string;
    type: 'unit' | 'building' | 'wonder';
    progress: number;
    cost: number;
    turnsToComplete: number;
  };
  // Worklist
  worklist: Array<{
    target: string;
    type: 'unit' | 'building' | 'wonder';
    cost: number;
  }>;
  // Trade routes
  tradeRoutes: Array<{
    partnerId: string;
    goods: string;
    value: number;
  }>;
  // City state
  celebrating: boolean;
  disorder: boolean;
  pollution: number;
  // Rally point (if any)
  rallyPoint?: {
    x: number;
    y: number;
    persistent: boolean;
  };
}

export interface Player {
  id: string;
  name: string;
  nation: string;
  color: string;
  gold: number;
  science: number;
  // Culture system (freeciv-based)
  history: number; // National history accumulation
  government: string;
  revolutionTurns?: number;
  isHuman: boolean;
  isActive: boolean;
}

export interface Technology {
  id: string;
  name: string;
  cost: number;
  requirements: string[];
  discovered: boolean;
  flags?: string[];
  description?: string;
}

export interface ResearchState {
  currentTech?: string;
  techGoal?: string;
  bulbsAccumulated: number;
  bulbsLastTurn: number;
  researchedTechs: Set<string>;
  availableTechs: Set<string>;
}

export interface GovernmentRequirement {
  type: string;
  name: string;
  range: string;
}

export interface Government {
  id: string;
  name: string;
  reqs?: GovernmentRequirement[];
  graphic: string;
  graphic_alt: string;
  sound: string;
  sound_alt: string;
  sound_alt2: string;
  ai_better?: string;
  ruler_male_title: string;
  ruler_female_title: string;
  helptext: string;
}

export interface GameState {
  turn: number;
  year?: number; // Game year (e.g., -4000, 1950, 2000)
  phase: 'movement' | 'research' | 'production';
  players: Record<string, Player>;
  currentPlayerId: string;
  map: {
    width: number;
    height: number;
    tiles: Record<string, Tile>;
    xsize?: number;
    ysize?: number;
    wrap_id?: number;
  };
  units: Record<string, Unit>;
  cities: Record<string, City>;
  technologies: Record<string, Technology>;
  research?: ResearchState;
  governments: Record<string, Government>;
  mapData?: {
    width: number;
    height: number;
    startingPositions: Array<{ x: number; y: number; playerId: string }>;
    seed: string;
    generatedAt: Date;
  };
  visibleTiles?: Array<{
    x: number;
    y: number;
    terrain: string;
    resource?: string;
    elevation: number;
    riverMask: number;
    continentId: number;
    isExplored: boolean;
    isVisible: boolean;
    hasRoad: boolean;
    hasRailroad: boolean;
    improvements: string[];
    cityId?: string;
    unitIds: string[];
  }>;
}

// Client state types
export type ClientState =
  | 'initial'
  | 'creating_game'
  | 'browsing_games'
  | 'connecting'
  | 'waiting_for_players'
  | 'joining_game'
  | 'preparing'
  | 'running'
  | 'over';

// UI types
export interface MapViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  // Removed zoom - freeciv-web 2D canvas does not support zoom
}

export type GameTab = 'map' | 'government' | 'research' | 'nations' | 'cities' | 'options';

// Border system types
export interface BorderSource {
  x: number;
  y: number;
  strength: number;
  radius: number;
  playerId: string;
  type: 'city' | 'fort' | 'fortress';
  cityId?: string;
}

export interface TileOwnership {
  x: number;
  y: number;
  playerId: string | null;
  strength: number;
}

// Border packet types
export interface BorderUpdatePacket {
  type: 'border_update';
  tiles: Array<{
    x: number;
    y: number;
    owner: string | null;
    strength: number;
  }>;
  updateType: 'full_update' | 'incremental' | 'player_specific';
  affectedPlayers?: string[];
}

export interface BorderSourcePacket {
  type: 'border_source_update';
  sources: BorderSource[];
  removed: Array<{ x: number; y: number }>;
}

export interface BorderChangeNotificationPacket {
  type: 'border_change_notification';
  playerId: string;
  tilesGained: Array<{ x: number; y: number }>;
  tilesLost: Array<{ x: number; y: number }>;
  sourceAdded?: BorderSource;
  sourceRemoved?: { x: number; y: number };
}
