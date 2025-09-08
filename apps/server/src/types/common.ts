export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export enum GameStatus {
  WAITING = 'waiting',
  STARTING = 'starting',
  RUNNING = 'running',
  PAUSED = 'paused',
  ENDED = 'ended',
}

export enum TurnPhase {
  MOVEMENT = 'movement',
  COMBAT = 'combat',
  PRODUCTION = 'production',
  END = 'end',
}

export interface PlayerColor {
  r: number;
  g: number;
  b: number;
}

// Border configuration enums - ported from reference/freeciv/common/game.h
export enum BorderMode {
  DISABLED = 0,
  ENABLED = 1,
  SEE_INSIDE = 2,
  EXPAND = 3,
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

// Extended tile interface with border properties
export interface Tile {
  x: number;
  y: number;
  terrain: string;
  city?: string; // cityId if city present
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

// Basic city interface for border calculations
export interface City {
  id: string;
  name: string;
  playerId: string;
  x: number;
  y: number;
  size: number;
}
