// Border configuration enums - ported from reference/freeciv/common/game.h
export enum BorderMode {
  DISABLED = 0,
  ENABLED = 1,
  SEE_INSIDE = 2,
  EXPAND = 3,
}

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
  // Border system properties - ported from reference/freeciv/server/maphand.c
  owner?: string; // playerId that owns this tile
  claimer?: string; // cityId or baseId that claims this tile for borders
  borderStrength?: number; // Border strength at this tile for conflict resolution
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

export interface City {
  id: string;
  name: string;
  playerId: string;
  x: number;
  y: number;
  size: number;
  food: number;
  shields: number;
  trade: number;
  buildings: string[];
  production?: {
    target: string;
    type: 'unit' | 'building' | 'wonder';
    progress: number;
    cost: number;
  };
}

export interface Player {
  id: string;
  name: string;
  nation: string;
  color: string;
  gold: number;
  science: number;
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

// Border configuration - ported from reference/freeciv/server/settings.c
export interface BorderConfiguration {
  borderMode: BorderMode; // Overall border system mode
  borderCityRadiusSquared: number; // Base radius for city borders
  borderSizeEffect: number; // How much city size affects border radius
  borderVision: boolean; // Whether borders provide vision
  borderStrengthPct: number; // Base border strength percentage
  happyBorders: boolean; // Whether crossing borders affects happiness
}

// Base/Extra types for territory claiming - ported from reference/freeciv/common/extra.h
export interface Extra {
  id: string;
  name: string;
  borderSquared?: number; // Border radius if this extra claims territory (-1 = no claiming)
  visionRadius?: number; // Vision radius provided
}

export interface GameState {
  turn: number;
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
  // Border system configuration - ported from reference/freeciv/server/settings.c
  borders?: BorderConfiguration;
  extras?: Record<string, Extra>;
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
