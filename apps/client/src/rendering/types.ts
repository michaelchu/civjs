// TypeScript interfaces for the complete rendering system

export interface Point2D {
  x: number;
  y: number;
}

export interface Size2D {
  width: number;
  height: number;
}

export interface SpriteCoordinate {
  x: number;
  y: number;
  width: number;
  height: number;
  sheetIndex: number;
}

export interface SpriteDefinitions {
  [spriteTag: string]: SpriteCoordinate;
}

export interface SpriteDefinition {
  key: string;
  tag?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  sheetIndex?: number;
  offset?: Point2D;
  offset_x?: number;
  offset_y?: number;
  text?: string;
}

// Type aliases for constants - use actual constants from constants.ts
export type LayerType = number;
export type MatchStyle = number;
export type CellType = number;
export type FogStyle = number;

// Complete tileset configuration interface
export interface CompleteTilesetConfig {
  // Basic dimensions
  tileWidth: number;
  tileHeight: number;
  name: string;
  imageCount: number;

  // Unit rendering parameters
  unitOffset: Point2D;
  unitFlagOffset: Point2D;
  unitActivityOffset: Point2D;

  // City rendering parameters
  cityFlagOffset: Point2D;
  citySizeOffset: Point2D;
  cityBarOffset: Point2D;

  // Rendering styles
  isIsometric: boolean;
  fogStyle: FogStyle;
  darknessStyle: number;
  roadStyle: number;
  isMountainous: boolean;

  // UI positioning
  tileLabelOffset: Point2D;
  smallTileSize: Size2D;

  // Additional tileset parameters
  unitExtraOffset?: Point2D;
  cityBarStyleOffset?: Point2D;
  selectOffset?: Point2D;
  mainIntroFile?: string;

  // Advanced rendering options
  layer0MatchStyle?: MatchStyle;
  layer1MatchStyle?: MatchStyle;
  blendingLayer?: number;
  darknessLayer?: number;
}

// Terrain rendering configuration
export interface TerrainRenderingConfig {
  [terrainLayerKey: string]: {
    matchStyle: MatchStyle;
    spriteType: CellType;
    mineTag?: string;
    matchIndices: number[];
    dither: boolean;
  };
}

// Game entity interfaces (simplified for rendering needs)
export interface Tile {
  id: number;
  index: number;
  terrain?: Terrain;
  x: number;
  y: number;
  visibility?: number;
  extras?: Extra[];
  units?: Unit[];
  label?: string;
  worked?: number;
  goto_dir?: number;
  nuke: number;
}

export interface Unit {
  id: number;
  type: UnitType;
  owner: Player;
  tile: number;
  hp: number;
  veteran: number;
  activity: number;
  facing?: number;
}

export interface City {
  id: number;
  name: string;
  owner: Player;
  tile: number;
  size: number;
  shield_surplus: number;
  food_surplus: number;
  trade_surplus: number;
  occupied?: boolean;
  unhappy?: boolean;
  output_food?: number[];
  output_shield?: number[];
  output_trade?: number[];
}

export interface Player {
  id: number;
  name: string;
  nation: Nation;
}

export interface Nation {
  id: number;
  flag: string;
}

export interface Terrain {
  id: number;
  name: string;
  graphic: string;
  graphic_alt?: string;
}

export interface UnitType {
  id: number;
  name: string;
  graphic: string;
  graphic_alt?: string;
}

export interface Extra {
  id: number;
  name: string;
  graphic: string;
  category: string;
}

export interface Edge {
  // Edge data structure for corner/edge matching
  id: number;
}

export interface Corner {
  // Corner data structure for corner matching system
  id: number;
}

export interface Building {
  id: number;
  name: string;
  graphic: string;
}
