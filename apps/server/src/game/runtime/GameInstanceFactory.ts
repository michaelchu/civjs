import { isSettableAILevel } from '@game/ai/AIProfile';
import type { BorderManager } from '@game/managers/BorderManager';
import type { CityManager } from '@game/managers/CityManager';
import type { GovernmentManager } from '@game/managers/GovernmentManager';
import type { MapManager } from '@game/managers/MapManager';
import type { PathfindingManager } from '@game/managers/PathfindingManager';
import type { ResearchManager } from '@game/managers/ResearchManager';
import type { TurnManager } from '@game/managers/TurnManager';
import type { UnitManager } from '@game/managers/UnitManager';
import type { VisibilityManager } from '@game/managers/VisibilityManager';
import type { FreecivIdentityAllocator } from '@game/random/FreecivIdentityAllocator';
import type { FreecivRandom } from '@game/random/FreecivRandom';
import { researchPacingFromGameState } from '@game/services/ResearchPacing';
import { DEFAULT_RULESET } from '@shared/data/rulesets/defaultRuleset';
import type {
  GameConfig,
  GameInstance,
  GameState,
  PlayerState,
  TerrainSettings,
  TurnPhase,
} from './GameTypes';

interface StoredGameRecord {
  name: string;
  hostId: string;
  gameType?: string | null;
  maxPlayers?: number | null;
  mapWidth?: number | null;
  mapHeight?: number | null;
  mapSeed?: string | null;
  ruleset?: string | null;
  turnTimeLimit?: number | null;
  maxTurns?: number | null;
  victoryConditions?: unknown;
  gameState?: any;
}

export function buildStoredGameConfig(
  game: StoredGameRecord,
  options: { terrainSettings?: TerrainSettings; recovery?: boolean } = {}
): GameConfig {
  const ruleset = game.ruleset ?? DEFAULT_RULESET;
  const storedAILevel = game.gameState?.aiLevel;
  const victoryConditions = Array.isArray(game.victoryConditions)
    ? game.victoryConditions.filter(
        (condition): condition is string => typeof condition === 'string'
      )
    : undefined;

  return {
    name: game.name,
    hostId: game.hostId,
    gameType:
      game.gameType === 'single' || game.gameType === 'multiplayer' ? game.gameType : undefined,
    maxPlayers: game.maxPlayers ?? undefined,
    mapWidth: game.mapWidth ?? undefined,
    mapHeight: game.mapHeight ?? undefined,
    mapSeed: game.mapSeed ?? undefined,
    ruleset: options.recovery ? ruleset : (game.ruleset ?? undefined),
    turnTimeLimit: game.turnTimeLimit ?? undefined,
    maxTurns: game.maxTurns ?? 0,
    victoryConditions:
      options.recovery && !victoryConditions?.length
        ? ['conquest', 'science', 'culture']
        : victoryConditions,
    terrainSettings: options.terrainSettings,
    aiLevel: isSettableAILevel(storedAILevel)
      ? storedAILevel
      : options.recovery
        ? 'easy'
        : undefined,
    researchPacing: researchPacingFromGameState(ruleset, game.gameState),
    randomSeed: game.gameState?.randomSeed,
    executionMode: game.gameState?.simulation?.executionMode,
    scenarioSetup: game.gameState?.scenarioSetup,
  };
}

export interface GameRuntimeManagers {
  turnManager: TurnManager;
  mapManager: MapManager;
  unitManager: UnitManager;
  visibilityManager: VisibilityManager;
  cityManager: CityManager;
  researchManager: ResearchManager;
  pathfindingManager: PathfindingManager;
  borderManager: BorderManager;
  governmentManager?: GovernmentManager;
  random: FreecivRandom;
  identities: FreecivIdentityAllocator;
}

export function buildGameInstance(input: {
  id: string;
  config: GameConfig;
  state: GameState;
  currentTurn: number;
  turnPhase: TurnPhase;
  players: Map<string, PlayerState>;
  managers: GameRuntimeManagers;
  pauseReason?: 'host' | 'disconnect';
  turnDeadlineAt?: Date | null;
  pausedTimerSeconds?: number | null;
}): GameInstance {
  return {
    id: input.id,
    config: input.config,
    state: input.state,
    currentTurn: input.currentTurn,
    turnPhase: input.turnPhase,
    players: input.players,
    ...input.managers,
    lastActivity: new Date(),
    pauseReason: input.pauseReason,
    turnDeadlineAt: input.turnDeadlineAt,
    pausedTimerSeconds: input.pausedTimerSeconds,
  };
}
