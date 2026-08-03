/**
 * @module server/game/cities/CityTypes
 * Defines City Types city behavior and contracts.
 */
import type { ActionType } from '@app-types/shared/actions';
import type { SpecialistType } from '@game/constants/SpecialistDefinitions';
import type { BuildingCultureRequirement } from '@shared/data/rulesets/schemas';

export interface WorkableTile {
  x: number;
  y: number;
  isWorked: boolean;
  isCenter?: boolean;
  isBlocked?: boolean;
  outputs: { food: number; shields: number; trade: number };
  terrain?: string;
  resource?: string;
  improvements?: string[];
}

export interface CityRallyPoint {
  x: number;
  y: number;
  persistent: boolean;
}

export interface TradeRoute {
  id?: string;
  sourceCity: string;
  partnerCity: string;
  establishedTurn: number;
  value: number;
  status?: 'active' | 'disrupted';
  distance?: number;
  isCaravan?: boolean;
  routeType?: string;
  goods?: string;
}

export interface TradeRouteCalculation {
  baseTradeValue: number;
  distanceBonus: number;
  sizeBonus: number;
  governmentBonus: number;
  totalValue: number;
}

export interface ProductionItem {
  kind: 'unit' | 'building' | 'wonder';
  value: string;
  remainingCost?: number;
}

export interface Happiness {
  happy: number;
  content: number;
  unhappy: number;
  angry: number;
}

export enum GovernorPriority {
  BALANCED = 'balanced',
  FOOD = 'food',
  SHIELDS = 'shields',
  TRADE = 'trade',
  SCIENCE = 'science',
  GOLD = 'gold',
  LUXURY = 'luxury',
}

export interface CityGovernor {
  isEnabled: boolean;
  priority: GovernorPriority;
  settings: {
    autoManageSpecialists: boolean;
    autoManageTiles: boolean;
    autoManageProduction: boolean;
    preventStarvation: boolean;
    maintainHappiness: boolean;
  };
}

export interface CityState {
  id: string;
  name: string;
  x: number;
  y: number;
  playerId: string;
  originalOwnerId?: string;
  population: number;
  size: number;
  cityRadius: number;
  founded: number;
  isCapital?: boolean;
  /** Ruleset-derived city graphic tier sent to clients. */
  cityImage?: number;
  /** Ruleset-derived visible wall graphic level sent to clients. */
  walls?: number;
  currentProduction?: string | null;
  productionType?: 'unit' | 'building' | null;
  turnsToComplete: number;
  productionStock?: number;
  foodStock?: number;
  foodPerTurn?: number;
  productionPerTurn?: number;
  tradePerTurn?: number;
  shieldStock?: number;
  sciencePerTurn?: number;
  goldPerTurn?: number;
  luxuryPerTurn?: number;
  pollution?: number;
  unitGoldUpkeep?: number;
  unitShieldUpkeep?: number;
  grossProductionPerTurn?: number;
  grossTradePerTurn?: number;
  continentId?: number;
  wasHappy?: boolean;
  disorderTurns?: number;
  history: number;
  buildings: string[];
  specialists: Record<SpecialistType, number>;
  workableTiles?: WorkableTile[];
  citizenAssignments?: Record<string, boolean>;
  workerTaskRequests?: CityWorkerTaskRequest[];
  tradeRoutes: TradeRoute[];
  happiness: Happiness;
  governor?: CityGovernor;
  rallyPoint?: CityRallyPoint;
  worklist: ProductionItem[];
  defenseStrength?: number;
  airliftUsedTurn?: number;
  didSellTurn?: number;
  didBuyTurn?: number;
  espionageThefts?: Record<string, number>;
}

/** Details available after a player loses their primary capital. */
export interface CapitalLossEvent {
  playerId: string;
  lostCityId: string;
  /** Number of cities the player owned immediately before the loss. */
  cityCountBeforeLoss: number;
  /** Whether the source-compatible civil-war chance roll succeeded. */
  civilWarTriggered?: boolean;
}

export interface CityWorkerTaskRequest {
  x: number;
  y: number;
  action: ActionType;
  want: number;
}

export interface BuildingType {
  id: string;
  name: string;
  genus: 'Improvement' | 'SmallWonder' | 'GreatWonder' | 'Special' | 'Convert';
  cost: number;
  sabotage?: number;
  requiredTech?: string;
  requires?: string[];
  cultureRequirements?: BuildingCultureRequirement[];
  effects: {
    defenseBonus?: number;
    foodBonus?: number;
    productionBonus?: number;
    scienceBonus?: number;
    goldBonus?: number;
    luxuryBonus?: number;
    happinessEffect?: number;
    maxCitySize?: number;
    unlimitedCitySize?: boolean;
    oceanFood?: number;
    oceanShields?: number;
    immediateTechs?: number;
    techParasitePlayers?: number;
    corruptionReduction?: number;
  };
}

export type BuildingCatalog = Readonly<Record<string, BuildingType>>;

export interface CityManagerCallbacks {
  onCityFounded?: (city: CityState) => void;
  onCityGrowth?: (city: CityState, oldSize: number) => void;
  onCityProductionComplete?: (city: CityState, item: ProductionItem) => void | Promise<void>;
  onCityDestroyed?: (city: CityState) => void | Promise<void>;
  onCityCaptured?: (city: CityState, oldPlayerId: string) => void;
  onCityOwnershipChanged?: (
    city: CityState,
    oldPlayerId: string,
    newPlayerId: string,
    reason: 'conquest' | 'transfer' | 'civil_war'
  ) => void | Promise<void>;
  onCityTurnProcessed?: (city: CityState) => void;
  onCapitalLossPending?: (event: CapitalLossEvent) => boolean | Promise<boolean>;
  onCapitalLost?: (event: CapitalLossEvent) => void | Promise<void>;
}
