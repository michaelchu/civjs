/**
 * @module client/types/index
 * Declares index client contracts.
 */
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
  hasRoad?: boolean;
  hasRailroad?: boolean;
  improvements?: string[];
  cityId?: string;
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
  maxHp?: number;
  attack?: number;
  defense?: number;
  firepower?: number;
  movesLeft: number;
  maxMoves?: number;
  fuel?: number;
  maxFuel?: number;
  transportCapacity?: number;
  veteranLevel: number;
  homeCityId?: string;
  upkeep?: { food: number; shields: number; gold: number };
  nationality?: string;
  activityTarget?: string;
  occupied?: boolean;
  paradropped?: boolean;
  doneMoving?: boolean;
  stay?: boolean;
  facing?: number;
  birthTurn?: number;
  fortified?: boolean;
  activity?: unknown;
  orders?: unknown;
  automation?: 'explore' | 'worker';
  automationTask?: {
    action: string;
    targetX: number;
    targetY: number;
    assignedTurn: number;
    requestCityId?: string;
  };
  transportedBy?: string;
  cargoUnits?: string[];
  capabilities?: {
    canFortify: boolean;
    canFoundCity: boolean;
    canBuildImprovements: boolean;
    canPillage: boolean;
    canTrade: boolean;
    diplomatActions?: string[];
    unitActions?: string[];
    availableWorkerActions?: string[];
    upgradeTarget?: {
      unitTypeId: string;
      name: string;
      cost: number;
    };
  };
  /** Set only when the server is asking the player to choose a unit action. */
  actionDecisionWant?: boolean;
}

export interface PresentationEffect {
  id: string;
  type: 'combat' | 'nuclear' | 'marker';
  x: number;
  y: number;
  startedAt: number;
  durationMs?: number;
  style?: 'swords' | 'explosion';
  tiles?: Array<{ x: number; y: number }>;
  combatants?: PresentationCombatant[];
  /** Internal delivery metadata used to correlate a command reply with its server broadcast. */
  correlationKey?: string;
  origin?: 'server' | 'reply' | 'correlated';
}

export interface PresentationCombatant {
  id: string;
  role: 'attacker' | 'defender';
  playerId: string;
  unitTypeId: string;
  x: number;
  y: number;
  hpBefore: number;
  hpAfter: number;
  movesLeft?: number;
  veteranLevel?: number;
  fortified?: boolean;
  activity?: unknown;
  destroyed: boolean;
}

export interface ProductionOption {
  id: string;
  name: string;
  type: 'unit' | 'building' | 'wonder';
  cost: number;
  description?: string;
  requirements?: string[];
  conversion?: boolean;
  available: boolean;
}

export type CityBatchAction =
  | {
      action: 'production';
      productionId: string;
      productionType: 'unit' | 'building' | 'wonder';
    }
  | { action: 'optimize' }
  | {
      action: 'governor';
      config: {
        enabled: boolean;
        priority: string;
        autoManageSpecialists: boolean;
        autoManageTiles: boolean;
        autoManageProduction: boolean;
        preventStarvation: boolean;
        maintainHappiness: boolean;
      };
    }
  | {
      action: 'worklist';
      mode: 'append' | 'replace';
      items: Array<{
        productionId: string;
        type: 'unit' | 'building' | 'wonder';
      }>;
    }
  | { action: 'buy' }
  | { action: 'sellBuilding'; buildingId: string };

export interface CityBatchResult {
  success: boolean;
  succeeded: Array<{ cityId: string; detail?: Record<string, unknown> }>;
  failed: Array<{ cityId: string; reason: string }>;
  treasury?: { after: number };
  error?: string;
}

export interface City {
  id: string;
  name: string;
  playerId: string;
  x: number;
  y: number;
  size: number;
  actualPopulation?: number; // Actual population count (server-calculated)
  presentation?: {
    graphic: string;
    graphicAlt?: string;
    hasWalls: boolean;
    overlays: string[];
  };
  // Current output
  food: number;
  shields: number;
  trade: number;
  // Culture system (freeciv-based)
  history: number; // Accumulated culture history
  isCapital?: boolean;
  cityImage?: number;
  walls?: number;
  foundedTurn?: number;
  defenseStrength?: number;
  health?: number;
  culturePerTurn?: number;
  continentId?: number;
  airlift?: {
    from: {
      enabled: boolean;
      available: boolean;
    };
    to: {
      enabled: boolean;
      available: boolean;
    };
  };
  // Production breakdown (total production before usage)
  prod: {
    food: number;
    shields: number;
    trade: number;
    gold: number;
    luxury: number;
    science: number;
  };
  // Net surplus/deficit after consumption
  surplus: {
    food: number;
    shields: number;
    trade: number;
    gold: number;
    luxury: number;
    science: number;
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
    sellable: boolean;
  }>;
  // Units
  presentUnits: string[]; // Unit IDs in the city
  supportedUnits: string[]; // Unit IDs supported by this city
  workableTiles?: Array<{
    x: number;
    y: number;
    isWorked: boolean;
    isCenter?: boolean;
    isBlocked?: boolean;
    outputs: { food: number; shields: number; trade: number };
    terrain?: string;
    resource?: string;
    improvements?: string[];
  }>;
  // Production
  production?: {
    target: string;
    name?: string;
    type: 'unit' | 'building' | 'wonder';
    progress: number;
    cost: number;
    turnsToComplete: number;
    conversion?: boolean;
    percentComplete?: number; // Server-calculated percentage (0-100)
    buyCost?: number;
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
    status?: 'active' | 'disrupted';
    distance?: number;
    establishedTurn?: number;
  }>;
  governor?: {
    isEnabled: boolean;
    priority: string;
    settings: {
      autoManageSpecialists: boolean;
      autoManageTiles: boolean;
      autoManageProduction: boolean;
      preventStarvation: boolean;
      maintainHappiness: boolean;
    };
  };
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
  /** Tileset flag suffix, e.g. `rome` for the `roman` nation. */
  nationGraphic?: string;
  color: string;
  gold: number;
  goldPerTurn?: number;
  science: number;
  sciencePerTurn?: number;
  taxRate?: number;
  luxuryRate?: number;
  scienceRate?: number;
  score?: number;
  teamId?: string;
  spaceshipState?: Record<string, unknown>;
  // Culture system (freeciv-based)
  history: number; // National history accumulation
  culture?: number; // Current national history plus performance and city culture
  government: string;
  revolutionTurns?: number;
  isHuman: boolean;
  isActive: boolean;
}

export type DiplomaticState =
  'no_contact' | 'war' | 'ceasefire' | 'armistice' | 'peace' | 'alliance' | 'team';

export type TreatyClauseType =
  | 'ceasefire'
  | 'peace'
  | 'alliance'
  | 'embassy'
  | 'shared_vision'
  | 'technology'
  | 'gold'
  | 'map'
  | 'seamap'
  | 'city';

export type TreatyClause =
  | {
      type: 'ceasefire' | 'peace' | 'alliance' | 'embassy' | 'shared_vision' | 'map' | 'seamap';
      giverId?: string;
    }
  | { type: 'technology'; techId: string; giverId?: string }
  | { type: 'gold'; amount: number; giverId?: string }
  | { type: 'city'; cityId: string; giverId?: string };

export interface DiplomacyNation {
  id: string;
  civilization: string;
  leaderName: string;
  isAlive: boolean;
  isAI: boolean;
  known: boolean;
  canMeet?: boolean;
  relation: {
    state: DiplomaticState;
    maxState?: DiplomaticState;
    sinceTurn: number;
    turnsLeft?: number;
    contactTurnsLeft?: number;
    hasReasonToCancel?: number;
    embassy: boolean;
    sharedVision: boolean;
    givesSharedVision?: boolean;
    reputation?: number;
    attitude?: number;
    proposal?: {
      id: string;
      proposerId: string;
      recipientId: string;
      clauses: TreatyClause[];
      status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
      createdAt: string;
    };
  };
}

export interface DiplomacyState {
  playerId: string;
  nations: DiplomacyNation[];
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
  futureTechs: number;
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

export interface GovernmentState {
  governments: Record<string, Government>;
  currentGovernment?: string;
  revolutionTurns: number;
  requestedGovernment?: string;
  availableGovernments: Array<{
    id: string;
    available: boolean;
    reason?: string;
  }>;
}

export interface GameState {
  turn: number;
  year?: number; // Game year (e.g., -4000, 1950, 2000)
  phase: 'movement' | 'research' | 'production' | 'diplomacy';
  players: Record<string, Player>;
  currentPlayerId: string;
  map: {
    /** Native packet dimensions. ISO/HEX display width is derived in map geometry. */
    width: number;
    height: number;
    tiles: Record<string, Tile>;
    xsize?: number;
    ysize?: number;
    topology_id?: number;
    wrap_id?: number;
  };
  units: Record<string, Unit>;
  /** Ephemeral Canvas-only effects; never authoritative game state. */
  presentationEffects?: PresentationEffect[];
  cities: Record<string, City>;
  technologies: Record<string, Technology>;
  research?: ResearchState;
  governments: Record<string, Government>;
  diplomacy?: DiplomacyState;
  endGameReport?: import('./packets').EndGameReportData;
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
    owner?: string;
    claimer?: string;
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
