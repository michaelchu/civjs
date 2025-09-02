/**
 * Network Action Protocol Types
 * 
 * Minimal shared types for client-server action communication.
 * Server has full game logic, client just sends action requests.
 */

export enum ActionType {
  // Unit Actions
  MOVE = 'move',
  ATTACK = 'attack', 
  FORTIFY = 'fortify',
  DISBAND = 'disband',
  BUILD_CITY = 'build_city',
  BUILD_ROAD = 'build_road',
  BUILD_IRRIGATION = 'build_irrigation',
  BUILD_MINE = 'build_mine',
  TRANSFORM_TERRAIN = 'transform_terrain',
  PILLAGE = 'pillage',
  
  // City Actions
  CHANGE_PRODUCTION = 'change_production',
  BUY_PRODUCTION = 'buy_production',
  SELL_BUILDING = 'sell_building',
  
  // Government Actions  
  CHANGE_GOVERNMENT = 'change_government',
  START_REVOLUTION = 'start_revolution',
  
  // Research Actions
  SET_RESEARCH = 'set_research',
  SET_RESEARCH_GOAL = 'set_research_goal'
}

export interface ActionRequest {
  type: ActionType;
  unitId?: string;
  cityId?: string; 
  targetX?: number;
  targetY?: number;
  targetId?: string;
  data?: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  changes?: Record<string, unknown>;
  movementCost?: number; // Server-specific field for unit movement
}