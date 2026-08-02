/**
 * @module server/game/runtime/GameTypes
 * Defines Game Types game runtime wiring.
 */
import type { AILevel, AITraits, SettableAILevel } from '@game/ai/AIProfile';
import type { CityManager } from '@game/managers/CityManager';
import type { BorderManager } from '@game/managers/BorderManager';
import type { GovernmentManager } from '@game/managers/GovernmentManager';
import type { MapManager } from '@game/managers/MapManager';
import type { PathfindingManager } from '@game/managers/PathfindingManager';
import type { ResearchManager } from '@game/managers/ResearchManager';
import type { TurnManager } from '@game/managers/TurnManager';
import type { UnitManager } from '@game/managers/UnitManager';
import type { VisibilityManager } from '@game/managers/VisibilityManager';
import type { FreecivIdentityAllocator } from '@game/random/FreecivIdentityAllocator';
import type { FreecivRandom } from '@game/random/FreecivRandom';
import type { ResearchPacingSettings } from '@game/services/ResearchPacing';
import type { SpaceshipState } from '@game/services/SpaceshipService';
import type { ScenarioSetup } from '@game/simulation/config/ScenarioSetup';

export type GameState = 'waiting' | 'starting' | 'active' | 'paused' | 'ended';
export type TurnPhase = 'movement' | 'production' | 'research' | 'diplomacy';

export interface TerrainSettings {
  generator: string;
  landmass: string;
  huts: number;
  temperature: number;
  wetness: number;
  rivers: number;
  resources: string;
  startpos?: number;
  topologyId?: number;
  wrapId?: number;
  scenarioId?: string;
}

export interface GameConfig {
  name: string;
  hostId: string;
  gameType?: 'single' | 'multiplayer';
  maxPlayers?: number;
  mapWidth?: number;
  mapHeight?: number;
  mapSeed?: string;
  ruleset?: string;
  turnTimeLimit?: number;
  maxTurns?: number;
  victoryConditions?: string[];
  terrainSettings?: TerrainSettings;
  aiLevel?: SettableAILevel;
  researchPacing?: Partial<ResearchPacingSettings>;
  randomSeed?: number;
  executionMode?: 'headless' | 'server';
  scenarioSetup?: ScenarioSetup;
  barbarianRate?: number;
  climate?: {
    enabled?: boolean;
    warmingThreshold?: number;
    coolingThreshold?: number;
  };
}

export interface GameInstance {
  id: string;
  config: GameConfig;
  state: GameState;
  currentTurn: number;
  turnPhase: TurnPhase;
  players: Map<string, PlayerState>;
  turnManager: TurnManager;
  mapManager: MapManager;
  unitManager: UnitManager;
  visibilityManager: VisibilityManager;
  cityManager: CityManager;
  researchManager: ResearchManager;
  random: FreecivRandom;
  identities: FreecivIdentityAllocator;
  pathfindingManager: PathfindingManager;
  borderManager: BorderManager;
  governmentManager?: GovernmentManager;
  lastActivity: Date;
  pauseReason?: 'host' | 'disconnect';
  turnDeadlineAt?: Date | null;
  pausedTimerSeconds?: number | null;
}

export interface PlayerState {
  id: string;
  userId: string | null;
  isAI?: boolean;
  aiLevel?: AILevel;
  aiTraits?: AITraits;
  aiState?: Record<string, unknown>;
  playerNumber: number;
  civilization: string;
  nation?: string;
  leaderName?: string;
  color?: { r: number; g: number; b: number };
  isAlive?: boolean;
  gold?: number;
  science?: number;
  technologies?: string[];
  goldPerTurn?: number;
  sciencePerTurn?: number;
  government?: string;
  history?: number;
  unitsBuilt?: number;
  unitsKilled?: number;
  unitsLost?: number;
  teamId?: string;
  hasConceded?: boolean;
  spaceshipState?: SpaceshipState;
  isReady: boolean;
  hasEndedTurn: boolean;
  isConnected: boolean;
  lastSeen: Date;
}
