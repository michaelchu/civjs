// Action types for the Actions & Orders System
// @reference freeciv/common/actions.h

export enum ActionType {
  // Basic unit actions
  MOVE = 'move',
  ATTACK = 'attack',
  FORTIFY = 'fortify',
  SENTRY = 'sentry',
  WAIT = 'wait',
  SKIP_TURN = 'skip_turn',

  // Goto system
  GOTO = 'goto',
  GOTO_WAYPOINT = 'goto_waypoint',

  // Settler actions
  FOUND_CITY = 'found_city',
  JOIN_CITY = 'join_city',

  // Worker actions  
  BUILD_ROAD = 'build_road',
  BUILD_RAILROAD = 'build_railroad',
  BUILD_IRRIGATION = 'build_irrigation',
  BUILD_MINE = 'build_mine',
  BUILD_FORTRESS = 'build_fortress',
  TRANSFORM_TERRAIN = 'transform_terrain',
  CLEAN_POLLUTION = 'clean_pollution',
  CLEAN_FALLOUT = 'clean_fallout',

  // Military actions
  PILLAGE = 'pillage',
  PARADROP = 'paradrop',
  BOMBARD = 'bombard',
  CAPTURE_UNITS = 'capture_units',
  PATROL = 'patrol',

  // Diplomat actions
  ESTABLISH_EMBASSY = 'establish_embassy',
  BRIBE_UNIT = 'bribe_unit',
  STEAL_TECH = 'steal_tech',
  INVESTIGATE_CITY = 'investigate_city',

  // Spy actions
  SABOTAGE_CITY = 'sabotage_city',
  SABOTAGE_UNIT = 'sabotage_unit',
  POISON_WATER = 'poison_water',
  SPREAD_PLAGUE = 'spread_plague',
  SPY_NUKE = 'spy_nuke',
  STEAL_MAPS = 'steal_maps',
  STEAL_GOLD = 'steal_gold',

  // Trade actions
  TRADE_ROUTE = 'trade_route',
  HELP_WONDER = 'help_wonder',
  MARKETPLACE = 'marketplace',

  // Transport actions
  LOAD_UNIT = 'load_unit',
  UNLOAD_UNIT = 'unload_unit',
  AIRLIFT = 'airlift',

  // Automation
  AUTO_EXPLORE = 'auto_explore',
  AUTO_SETTLER = 'auto_settler',

  // Unit management
  DISBAND_UNIT = 'disband_unit',
  UPGRADE_UNIT = 'upgrade_unit',
  CHANGE_HOME_CITY = 'change_home_city',
}

export interface ActionDefinition {
  id: ActionType;
  name: string;
  description: string;
  hotkey?: string;
  icon?: string;
  category: ActionCategory;
  requirements: ActionRequirement[];
  targetType: ActionTargetType;
  consumes_actor: boolean;
  moves_actor: ActionMovesActor;
}

export enum ActionCategory {
  BASIC = 'basic',
  MOVEMENT = 'movement', 
  BUILD = 'build',
  MILITARY = 'military',
  DIPLOMACY = 'diplomacy',
  ESPIONAGE = 'espionage',
  TRADE = 'trade',
  TRANSPORT = 'transport',
  AUTOMATION = 'automation',
  MANAGEMENT = 'management',
}

export enum ActionTargetType {
  NONE = 'none',           // No target needed
  TILE = 'tile',           // Target a map tile
  UNIT = 'unit',           // Target another unit
  CITY = 'city',           // Target a city
  SELF = 'self',           // Action on self
  ADJACENT_TILE = 'adjacent_tile', // Must target adjacent tile
}

export enum ActionMovesActor {
  STAYS = 'stays',         // Unit stays in same position
  MOVES_TO_TARGET = 'moves_to_target', // Unit moves to target tile
  TELEPORT = 'teleport',   // Unit teleports
  ESCAPE = 'escape',       // Unit escapes to nearby tile
}

export interface ActionRequirement {
  type: 'unit_type' | 'unit_flag' | 'terrain' | 'tech' | 'building' | 'government' | 'diplomatic_state';
  value: string | string[];
  present: boolean; // true if requirement must be present, false if must be absent
  range?: 'local' | 'tile' | 'adjacent' | 'city' | 'continent' | 'player' | 'world';
}

export interface ActionProbability {
  min: number;  // Minimum probability (0-200, where 200 = 100%)
  max: number;  // Maximum probability (0-200, where 200 = 100%)
}

export interface ActionResult {
  success: boolean;
  message?: string;
  newPosition?: { x: number; y: number };
  unitDestroyed?: boolean;
  targetDestroyed?: boolean;
  experience_gained?: number;
  cityId?: string;
}