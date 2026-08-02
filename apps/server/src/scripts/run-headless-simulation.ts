import { access, mkdir, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  headlessSimulationConfigSchema,
  type HeadlessSimulationConfig,
  type HeadlessSimulationRunOptions,
  type SimulationRunBundle,
} from '@game/simulation/config/SimulationTypes';
import {
  createRunId,
  exitCodeForBundle,
  HEADLESS_EXIT_CODES,
  HeadlessSimulationRunner,
  HeadlessSimulationOutputError,
} from '@game/simulation/runtime/HeadlessSimulationRunner';

interface CliOptions {
  configPath?: string;
  seed?: number;
  mapSeed?: string;
  maxTurns?: number;
  outputDirectory?: string;
  jsonl: boolean;
  timeoutMs?: number;
  noPersist: boolean;
  databaseUrl?: string;
}

interface PreparedRun {
  options: CliOptions;
  normalizedConfig: HeadlessSimulationConfig;
  outputDirectory: string;
}

const usage = `Usage: npm run --silent simulation:run -- [options]

Required:
  --config <path>          Load and validate a simulation configuration
  --output <directory>     Write the schema-versioned run bundle
  --seed <value>           Authoritative gameplay seed (or provide in config)
  --map-seed <value>       Map seed (or provide in config)

Options:
  --max-turns <count>      Override the validated hard turn cap
  --jsonl                  Emit schema-versioned progress records on stdout
  --timeout-ms <ms>        Stop at a turn boundary after this wall-clock limit
  --database-url <url>     Explicit PostgreSQL target for this run
  --no-persist             Require an explicitly isolated/test database target
  --help                   Print this contract without side effects

Exit codes:
  0 completed, 2 invalid configuration, 3 turn failure,
  4 timeout/cancellation, 5 output failure, 6 expectation failure,
  7 invariant failure
`;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.includes('--help')) {
    process.stdout.write(usage);
    return 0;
  }
  await loadEnvironment();
  const parsed = parseOptionsOrReport(argv);
  if (typeof parsed === 'number') return parsed;
  const prepared = await prepareRunOrReport(parsed);
  if (typeof prepared === 'number') return prepared;
  return executePreparedRun(prepared);
}

async function loadEnvironment(): Promise<void> {
  const dotenv = await import('dotenv');
  dotenv.config({
    path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
    quiet: true,
  });
}

function parseOptionsOrReport(argv: string[]): CliOptions | number {
  try {
    return parseArguments(argv);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n\n${usage}`);
    return HEADLESS_EXIT_CODES.invalidConfiguration;
  }
}

async function prepareRunOrReport(options: CliOptions): Promise<PreparedRun | number> {
  try {
    const normalizedConfig = await loadConfig(options);
    const outputDirectory = await validateOutputDirectory(options.outputDirectory);
    validateDatabaseTarget(options);
    process.env.POSTGRES_URL = requireDatabaseUrl(options);
    return { options, normalizedConfig, outputDirectory };
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    return HEADLESS_EXIT_CODES.invalidConfiguration;
  }
}

function requireDatabaseUrl(options: CliOptions): string {
  const databaseUrl =
    options.databaseUrl ??
    process.env.HEADLESS_SIMULATION_DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL;
  if (databaseUrl) return databaseUrl;
  throw new Error(
    'A database target is required via --database-url or HEADLESS_SIMULATION_DATABASE_URL.'
  );
}

async function executePreparedRun(prepared: PreparedRun): Promise<number> {
  const abortController = new AbortController();
  const cancel = (signal: 'SIGINT' | 'SIGTERM') => {
    if (abortController.signal.aborted) return;
    process.stderr.write(`${signal} received; requesting simulation cancellation\n`);
    abortController.abort();
  };
  const cancelOnInterrupt = () => cancel('SIGINT');
  const cancelOnTermination = () => cancel('SIGTERM');
  process.once('SIGINT', cancelOnInterrupt);
  process.once('SIGTERM', cancelOnTermination);

  let gameManager: import('@game/managers/GameManager').GameManager | undefined;
  try {
    return await runSimulation(prepared, abortController.signal, manager => {
      gameManager = manager;
    });
  } catch (error) {
    process.stderr.write(`headless simulation failed: ${errorMessage(error)}\n`);
    return exitCodeForError(error);
  } finally {
    gameManager?.clearAllGames();
    process.removeListener('SIGINT', cancelOnInterrupt);
    process.removeListener('SIGTERM', cancelOnTermination);
    await closeRuntimeConnections();
  }
}

async function runSimulation(
  prepared: PreparedRun,
  signal: AbortSignal,
  onGameManager: (gameManager: import('@game/managers/GameManager').GameManager) => void
): Promise<number> {
  const [{ productionDatabaseProvider }, { GameManager }] = await Promise.all([
    import('@database'),
    import('@game/managers/GameManager'),
  ]);
  const io = {
    emit: () => undefined,
    to: () => ({ emit: () => undefined }),
  } as unknown as import('socket.io').Server;
  const gameManager = GameManager.getInstance(io, productionDatabaseProvider);
  onGameManager(gameManager);
  const runner = new HeadlessSimulationRunner(gameManager, productionDatabaseProvider);
  const result = await runner.run({
    config: prepared.normalizedConfig,
    outputDirectory: prepared.outputDirectory,
    runId: createRunId(),
    signal,
    timeoutMs: prepared.options.timeoutMs,
    onProgress: createProgressReporter(prepared.options.jsonl),
  });
  process.stderr.write(`simulation bundle: ${result.outputPath}\n`);
  return exitCodeForBundle(result.bundle);
}

function createProgressReporter(jsonl: boolean): HeadlessSimulationRunOptions['onProgress'] {
  return record => {
    if (jsonl) {
      process.stdout.write(`${JSON.stringify(record)}\n`);
      return;
    }
    if (record.type === 'turn_completed') process.stderr.write(`completed turn ${record.turn}\n`);
  };
}

const STATUS_EXIT_CODES: Record<SimulationRunBundle['result']['status'], number> = {
  completed: HEADLESS_EXIT_CODES.completed,
  failed: HEADLESS_EXIT_CODES.turnFailure,
  timed_out: HEADLESS_EXIT_CODES.timeoutOrCancellation,
  cancelled: HEADLESS_EXIT_CODES.timeoutOrCancellation,
};

export function exitCodeForStatus(status: SimulationRunBundle['result']['status']): number {
  return STATUS_EXIT_CODES[status];
}

export function exitCodeForError(error: unknown): number {
  return error instanceof HeadlessSimulationOutputError
    ? HEADLESS_EXIT_CODES.outputFailure
    : HEADLESS_EXIT_CODES.turnFailure;
}

async function closeRuntimeConnections(): Promise<void> {
  try {
    const [{ closeConnection }, { redis }] = await Promise.all([
      import('@database'),
      import('@database/redis'),
    ]);
    await Promise.allSettled([closeConnection(), redis.quit()]);
  } catch {
    // Preserve the simulation result; connection cleanup is best effort.
  }
}

export function parseArguments(argv: string[]): CliOptions {
  const options: CliOptions = { jsonl: false, noPersist: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') continue;
    const flagHandler = FLAG_OPTION_HANDLERS[argument];
    if (flagHandler) {
      flagHandler(options);
      continue;
    }
    const valueHandler = VALUE_OPTION_HANDLERS[argument];
    if (!valueHandler) throw new Error(`Unknown option: ${argument}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    valueHandler(options, value);
  }
  validateRequiredOptions(options);
  return options;
}

const FLAG_OPTION_HANDLERS: Record<string, (options: CliOptions) => void> = {
  '--jsonl': options => {
    options.jsonl = true;
  },
  '--no-persist': options => {
    options.noPersist = true;
  },
};

const VALUE_OPTION_HANDLERS: Record<string, (options: CliOptions, value: string) => void> = {
  '--config': (options, value) => {
    options.configPath = value;
  },
  '--seed': (options, value) => {
    options.seed = parseSeed(value, '--seed');
  },
  '--map-seed': (options, value) => {
    options.mapSeed = requireMapSeed(value);
  },
  '--max-turns': (options, value) => {
    options.maxTurns = parsePositiveInteger(value, '--max-turns');
  },
  '--output': (options, value) => {
    options.outputDirectory = value;
  },
  '--timeout-ms': (options, value) => {
    options.timeoutMs = parsePositiveInteger(value, '--timeout-ms');
  },
  '--database-url': (options, value) => {
    options.databaseUrl = value;
  },
};

function validateRequiredOptions(options: CliOptions): void {
  if (!options.configPath) throw new Error('--config is required');
  if (!options.outputDirectory) throw new Error('--output is required');
}

function requireMapSeed(value: string): string {
  if (value.trim()) return value;
  throw new Error('--map-seed must not be empty');
}

async function loadConfig(options: CliOptions): Promise<HeadlessSimulationConfig> {
  const raw = JSON.parse(await readFile(resolve(options.configPath!), 'utf8')) as Record<
    string,
    unknown
  >;
  const randomSeed = options.seed ?? readSeed(raw.seed ?? raw.randomSeed, 'config seed');
  const mapSeed = options.mapSeed ?? readMapSeed(raw.mapSeed);
  if (randomSeed === undefined) throw new Error('An explicit --seed or config seed is required');
  if (mapSeed === undefined)
    throw new Error('An explicit --map-seed or config mapSeed is required');
  return headlessSimulationConfigSchema.parse({
    ...raw,
    randomSeed,
    mapSeed,
    ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
  });
}

async function validateOutputDirectory(output?: string): Promise<string> {
  if (!output?.trim()) throw new Error('--output must not be empty');
  const directory = resolve(output);
  await mkdir(directory, { recursive: true });
  const info = await stat(directory);
  if (!info.isDirectory()) throw new Error(`Output path is not a directory: ${directory}`);
  await access(directory, constants.W_OK);
  return directory;
}

function validateDatabaseTarget(options: CliOptions): void {
  const target =
    options.databaseUrl ??
    process.env.HEADLESS_SIMULATION_DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL;
  if (!target) throw new Error('An explicit database target is required');
  if (
    options.noPersist &&
    !isIsolatedDatabaseTarget(target) &&
    process.env.HEADLESS_SIMULATION_ISOLATED !== '1'
  ) {
    throw new Error('--no-persist requires a test, isolated, or sandbox database target');
  }
}

export function isIsolatedDatabaseTarget(target: string): boolean {
  try {
    const databaseName = decodeURIComponent(new URL(target).pathname).replace(/^\/+/, '');
    return /(test|isolat|sandbox)/i.test(databaseName);
  } catch {
    return false;
  }
}

function parseSeed(value: string, option: string): number {
  const seed = Number(value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new Error(`${option} must be an unsigned 32-bit integer`);
  }
  return seed;
}

function readSeed(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return parseSeed(String(value), label);
  if (typeof value === 'string') return parseSeed(value, label);
  throw new Error(`${label} must be an unsigned 32-bit integer`);
}

function readMapSeed(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new Error('config mapSeed must be a string or number');
  const seed = String(value).trim();
  if (!seed) throw new Error('config mapSeed must not be empty');
  return seed;
}

function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${option} must be a positive integer`);
  return parsed;
}

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) return z.prettifyError(error);
  return error instanceof Error ? error.message : String(error);
}

if (require.main === module) {
  void main().then(code => {
    process.exitCode = code;
  });
}
