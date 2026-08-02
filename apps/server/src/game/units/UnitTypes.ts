/**
 * @module server/game/units/UnitTypes
 * Defines Unit Types unit behavior and contracts.
 */
import type {
  UnitAutomationMode,
  WorkerAutomationTask,
} from '@game/automation/WorkerAutomationTypes';

export interface Unit {
  id: string;
  gameId: string;
  playerId: string;
  unitTypeId: string;
  x: number;
  y: number;
  movementLeft: number;
  fuel?: number;
  health: number;
  veteranLevel: number;
  experience: number;
  fortified: boolean;
  orders?: UnitOrder[];
  activity?: UnitActivity;
  sentryUntil?: 'turn_start' | 'enemy_sighted' | 'manual';
  autoExploreTarget?: { x: number; y: number };
  automation?: UnitAutomationMode;
  automationTask?: WorkerAutomationTask;
  transportedBy?: string;
  cargoUnits?: string[];
  homeCityId?: string;
  createdTurn?: number;
  lastActionTurn?: number;
}

export interface UnitHitpointRecovery {
  regeneration: number;
  minimum: number;
  secondary: number;
  gain: number;
}

export type UnitLifecycleEvent =
  | { type: 'created'; unit: Unit }
  | { type: 'moved'; unit: Unit; previousX: number; previousY: number }
  | { type: 'owner_changed'; unit: Unit; previousPlayerId: string }
  | { type: 'destroyed'; unit: Unit };

export interface VeteranLevel {
  name: string;
  /** Percentage multiplier applied to the unit's base combat strength. */
  powerFactor: number;
  /** Additional movement fragments granted at this level. */
  moveBonus: number;
  /** Chance to gain the next level after combat before effect modifiers. */
  baseRaiseChance: number;
  /** Chance to gain the next level after useful worker activity. */
  workRaiseChance: number;
  /**
   * Legacy compatibility metadata. Freeciv promotion is chance-based, not
   * experience-threshold based, so authoritative paths do not use this.
   */
  experienceRequired: number;
}

export interface UnitOrder {
  type:
    | 'move'
    | 'attack'
    | 'fortify'
    | 'foundCity'
    | 'buildImprovement'
    | 'pillage'
    | 'patrol'
    | 'irrigate'
    | 'mine'
    | 'cultivate'
    | 'plant'
    | 'fortress'
    | 'airbase'
    | 'road'
    | 'railroad'
    | 'transform'
    | 'cleanPollution'
    | 'sentry'
    | 'wait'
    | 'disband'
    | 'autoExplore'
    | 'autoSettler';
  targetX?: number;
  targetY?: number;
  targetId?: string;
  improvementType?: string;
  activity?: UnitActivity;
  patrolStart?: { x: number; y: number };
  patrolEnd?: { x: number; y: number };
  activityTurnsLeft?: number;
  priority?: number;
}

export interface UnitActivity {
  type:
    | 'idle'
    | 'building_road'
    | 'building_railroad'
    | 'irrigating'
    | 'mining'
    | 'cultivating'
    | 'planting'
    | 'building_fortress'
    | 'building_airbase'
    | 'pillaging'
    | 'transforming'
    | 'cleaning_pollution'
    | 'fortifying'
    | 'patrolling';
  turnsRemaining: number;
  totalTurns: number;
  target?: { x: number; y: number };
}

export interface CombatResult {
  attackerId: string;
  defenderId: string;
  attackerDamage: number;
  defenderDamage: number;
  attackerDestroyed: boolean;
  defenderDestroyed: boolean;
  collateralDestroyedIds?: string[];
  experienceGained?: { attacker: number; defender: number };
}

export interface UnitCombatEvent {
  attacker: Unit;
  defender: Unit;
  result: CombatResult;
  collateralUnits?: Unit[];
}

export interface DiplomatActionResolution {
  success: boolean;
  actorSurvives: boolean;
  successChance: number;
  escapeChance: number;
}
