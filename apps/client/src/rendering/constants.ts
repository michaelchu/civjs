// Core rendering constants ported from freeciv-web tileset configuration

// Match styles for terrain rendering (from tilespec.js)
export const MATCH_NONE = 0;
export const MATCH_SAME = 1;
export const MATCH_PAIR = 2;
export const MATCH_FULL = 3;

// Cell types for sprite rendering (from tilespec.js)
export const CELL_WHOLE = 0;
export const CELL_CORNER = 1;

// Layer constants for the 13-layer rendering system
export const LAYER_TERRAIN1 = 0;
export const LAYER_TERRAIN2 = 1;
export const LAYER_TERRAIN3 = 2;
export const LAYER_ROADS = 3;
export const LAYER_SPECIAL1 = 4;
export const LAYER_CITY1 = 5;
export const LAYER_SPECIAL2 = 6;
export const LAYER_UNIT = 7;
export const LAYER_FOG = 8;
export const LAYER_SPECIAL3 = 9;
export const LAYER_TILELABEL = 10;
export const LAYER_CITYBAR = 11;
export const LAYER_GOTO = 12;

export const ALL_LAYERS = [
  LAYER_TERRAIN1,
  LAYER_TERRAIN2,
  LAYER_TERRAIN3,
  LAYER_ROADS,
  LAYER_SPECIAL1,
  LAYER_CITY1,
  LAYER_SPECIAL2,
  LAYER_UNIT,
  LAYER_FOG,
  LAYER_SPECIAL3,
  LAYER_TILELABEL,
  LAYER_CITYBAR,
  LAYER_GOTO,
];

// Fog styles
export const FOG_AUTO = 0;
export const FOG_SPRITE = 1;
export const FOG_DARKNESS = 2;

// Visibility states for fog of war
export const VIS_UNKNOWN = 0;
export const VIS_HIDDEN = 1;
export const VIS_VISIBLE = 2;

// Dithering offsets for terrain blending
export const DITHER_OFFSET_X = [48, 0, 48, 0]; // normal_tile_width/2
export const DITHER_OFFSET_Y = [0, 24, 24, 0]; // normal_tile_height/2

// Direction constants for corner matching
export const DIR_NW = 0;
export const DIR_NE = 1;
export const DIR_SE = 2;
export const DIR_SW = 3;

// Unit activity constants
export const ACTIVITY_IDLE = 0;
export const ACTIVITY_POLLUTION = 1;
export const ACTIVITY_MINE = 2;
export const ACTIVITY_IRRIGATE = 3;
export const ACTIVITY_FORTIFIED = 4;
export const ACTIVITY_FORTRESS = 5;
export const ACTIVITY_SENTRY = 6;
export const ACTIVITY_RAILROAD = 7;
export const ACTIVITY_PILLAGE = 8;
export const ACTIVITY_GOTO = 9;
export const ACTIVITY_EXPLORE = 10;
export const ACTIVITY_TRANSFORM = 11;
export const ACTIVITY_AIRBASE = 12;
export const ACTIVITY_FORTIFYING = 13;
export const ACTIVITY_FALLOUT = 14;
export const ACTIVITY_PATROL_UNUSED = 15;

// Terrain layer match types (from tileset config)
export const TERRAIN_MATCH_TYPES = {
  layer0: ['shallow', 'deep', 'land'],
  layer1: ['forest', 'hills', 'mountains', 'water', 'ice', 'jungle'],
  layer2: ['water', 'ice'],
};

// Corner sprite indices for 81-sprite corner matching system
export const CORNER_SPRITE_COUNT = 81;

// Maximum number of sprite sheets supported
export const MAX_SPRITE_SHEETS = 10;

// Sprite tag prefixes
export const SPRITE_PREFIX_TERRAIN = 't.';
export const SPRITE_PREFIX_UNIT = 'u.';
export const SPRITE_PREFIX_CITY = 'city.';
export const SPRITE_PREFIX_BUILDING = 'b.';
export const SPRITE_PREFIX_FLAG = 'f.';

// Default sprite dimensions (fallback values)
export const DEFAULT_SPRITE_WIDTH = 96;
export const DEFAULT_SPRITE_HEIGHT = 48;

// Additional constants from original tilespec.js
export const LAYER_COUNT = 13;
export const NUM_CORNER_DIRS = 4;

// Edge types for border matching
export const EDGE_NS = 0; // North and south
export const EDGE_WE = 1; // West and east
export const EDGE_UD = 2; // Up and down (nw/se), for hex_width tilesets
export const EDGE_LR = 3; // Left and right (ne/sw), for hex_height tilesets
export const EDGE_COUNT = 4;

// Darkness styles - don't reorder this enum since tilesets depend on it
export const DARKNESS_NONE = 0; // No darkness sprites are drawn
export const DARKNESS_ISORECT = 1; // 1 sprite split into 4 parts, iso-view only
export const DARKNESS_CARD_SINGLE = 2; // 4 sprites, one per direction
export const DARKNESS_CARD_FULL = 3; // 15=2^4-1 sprites based on cardinal directions
export const DARKNESS_CORNER = 4; // Corner darkness & fog, 3^4 = 81 sprites

// Direction constants (8-directional)
export const DIR8_NORTH = 0;
export const DIR8_EAST = 1;
export const DIR8_SOUTH = 2;
export const DIR8_WEST = 3;
export const DIR8_NORTHEAST = 4;
export const DIR8_SOUTHEAST = 5;
export const DIR8_SOUTHWEST = 6;
export const DIR8_NORTHWEST = 7;

// Cardinal directions array
export const CARDINAL_TILESET_DIRS = [
  DIR8_NORTH,
  DIR8_EAST,
  DIR8_SOUTH,
  DIR8_WEST,
];
export const NUM_CARDINAL_TILESET_DIRS = 4;

// Direction mapping from 4-directional to 8-directional
export const DIR4_TO_DIR8 = [DIR8_NORTH, DIR8_SOUTH, DIR8_EAST, DIR8_WEST];

// Goto line direction offsets for rendering goto paths
export const GOTO_DIR_DX = [0, 1, 0, -1, 1, 1, -1, -1];
export const GOTO_DIR_DY = [-1, 0, 1, 0, -1, 1, 1, -1];

// Tileset dimensions will be imported from tileset-config.ts

// Renderer types
export const RENDERER_2DCANVAS = 1; // default HTML5 Canvas
export const RENDERER_WEBGL = 2; // WebGL + Three.js
