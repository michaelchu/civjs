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
}

export interface Unit {
  id: string;
  playerId: string;
  type: string;
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
  isHuman: boolean;
  isActive: boolean;
}

export interface Technology {
  id: string;
  name: string;
  cost: number;
  requirements: string[];
  discovered: boolean;
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

export type GameTab =
  | 'map'
  | 'government'
  | 'research'
  | 'nations'
  | 'cities'
  | 'options';
