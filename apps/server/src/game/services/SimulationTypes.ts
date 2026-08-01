import { z } from 'zod';
import type { SettableAILevel } from '@game/ai/AIProfile';
import type { TerrainSettings } from '@game/managers/GameManager';

export const SIMULATION_RUN_SCHEMA_VERSION = 1;
export const SIMULATION_DIAGNOSTIC_SCHEMA_VERSION = 1;

const simulationVictoryConditions = z
  .array(
    z.enum(['max_turns', 'conquest', 'science', 'culture', 'world_peace', 'allied', 'scenario'])
  )
  .min(1)
  .default(['max_turns']);

const terrainSettingsSchema = z
  .object({
    generator: z
      .enum(['random', 'fractal', 'island', 'fair', 'fracture', 'scenario'])
      .default('random'),
    landmass: z.string().default('normal'),
    huts: z.number().int().min(0).max(100).default(15),
    temperature: z.number().int().min(0).max(100).default(50),
    wetness: z.number().int().min(0).max(100).default(50),
    rivers: z.number().int().min(0).max(100).default(50),
    resources: z.string().default('normal'),
    startpos: z.number().int().optional(),
    topologyId: z.number().int().optional(),
    wrapId: z.number().int().optional(),
    scenarioId: z.string().min(1).optional(),
  })
  .default({
    generator: 'random',
    landmass: 'normal',
    huts: 15,
    temperature: 50,
    wetness: 50,
    rivers: 50,
    resources: 'normal',
  });

export const headlessSimulationConfigSchema = z.object({
  name: z.string().trim().min(1).max(100).default('Headless AI Simulation'),
  aiPlayerCount: z.number().int().min(2).max(32),
  mapWidth: z.number().int().min(20).max(200).default(80),
  mapHeight: z.number().int().min(20).max(200).default(50),
  ruleset: z.string().trim().min(1).default('civ2civ3'),
  aiLevel: z.enum(['restricted', 'novice', 'easy', 'normal', 'hard', 'cheating']).default('easy'),
  maxTurns: z.number().int().min(1).max(100_000),
  victoryConditions: simulationVictoryConditions,
  terrainSettings: terrainSettingsSchema,
  turnTimeLimit: z.number().int().min(0).max(86_400).default(0),
});

export type HeadlessSimulationConfig = z.infer<typeof headlessSimulationConfigSchema> & {
  mapSeed: string;
  randomSeed: number;
};

export type SimulationExecutionMode = 'headless' | 'server';

export interface SimulationRunManifest {
  schemaVersion: typeof SIMULATION_RUN_SCHEMA_VERSION;
  runId: string;
  gameId: string;
  createdAt: string;
  codeVersion: string;
  protocolVersion: number;
  diagnosticSchemaVersion: number;
  rulesetId: string;
  mapSeed: string;
  authoritativeRandomSeed: number;
  normalizedConfig: HeadlessSimulationConfig;
  executionMode: SimulationExecutionMode;
  aiImplementationVersion: string;
  randomizationVersion: string;
}

export interface SimulationProgressRecord {
  schemaVersion: typeof SIMULATION_RUN_SCHEMA_VERSION;
  type: 'run_started' | 'turn_completed' | 'run_finished' | 'run_failed';
  runId: string;
  gameId?: string;
  turn?: number;
  completedTurns?: number;
  endReason?: string;
  status?: SimulationRunBundle['result']['status'];
  code?: 'TURN_FAILURE' | 'TIMEOUT' | 'CANCELLED';
  error?: string;
}

export interface SimulationRunBundle {
  schemaVersion: typeof SIMULATION_RUN_SCHEMA_VERSION;
  manifest: SimulationRunManifest;
  result: {
    status: 'completed' | 'failed' | 'timed_out' | 'cancelled';
    completedTurns: number;
    endReason: string;
    standings: unknown;
    stateHashes: Array<{ turn: number; hash: string }>;
  };
  replay: unknown;
  aiSummaries: unknown;
  diagnostics: unknown;
  failure?: {
    code: 'TURN_FAILURE' | 'TIMEOUT' | 'CANCELLED';
    message: string;
  };
}

export interface HeadlessSimulationRunOptions {
  config: HeadlessSimulationConfig;
  outputDirectory: string;
  runId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (record: SimulationProgressRecord) => void;
}

export function toGameTerrainSettings(config: HeadlessSimulationConfig): TerrainSettings {
  return config.terrainSettings as TerrainSettings;
}

export function isSettableSimulationAILevel(value: string): value is SettableAILevel {
  return ['restricted', 'novice', 'easy', 'normal', 'hard', 'cheating'].includes(value);
}
