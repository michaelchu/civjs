import { access, mkdir, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import {
  headlessSimulationConfigSchema,
  type HeadlessSimulationConfig,
} from '@game/services/SimulationTypes';
import {
  createRunId,
  HEADLESS_EXIT_CODES,
  HeadlessSimulationRunner,
  HeadlessSimulationOutputError,
} from '@game/services/HeadlessSimulationRunner';

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

const usage = `Usage: npm run simulation:run -- [options]

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
  4 timeout/cancellation, 5 output failure
`;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.includes('--help')) {
    process.stdout.write(usage);
    return 0;
  }
  const dotenv = await import('dotenv');
  dotenv.config({
    path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
    quiet: true,
  });
  let options: CliOptions;
  try {
    options = parseArguments(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage}`);
    return HEADLESS_EXIT_CODES.invalidConfiguration;
  }
  if (!options.configPath) {
    process.stdout.write(usage);
    return 0;
  }

  let normalizedConfig: HeadlessSimulationConfig;
  let outputDirectory: string;
  try {
    normalizedConfig = await loadConfig(options);
    outputDirectory = await validateOutputDirectory(options.outputDirectory);
    validateDatabaseTarget(options);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return HEADLESS_EXIT_CODES.invalidConfiguration;
  }

  const databaseUrl =
    options.databaseUrl ??
    process.env.HEADLESS_SIMULATION_DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write(
      'A database target is required via --database-url or HEADLESS_SIMULATION_DATABASE_URL.\n'
    );
    return HEADLESS_EXIT_CODES.invalidConfiguration;
  }
  process.env.POSTGRES_URL = databaseUrl;

  const abortController = new AbortController();
  const cancel = () => abortController.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);

  let gameManager: import('@game/managers/GameManager').GameManager | undefined;
  try {
    const [{ productionDatabaseProvider }, { GameManager }] = await Promise.all([
      import('@database'),
      import('@game/managers/GameManager'),
    ]);
    const io = {
      emit: () => undefined,
      to: () => ({ emit: () => undefined }),
    } as unknown as import('socket.io').Server;
    gameManager = GameManager.getInstance(io, productionDatabaseProvider);
    const runner = new HeadlessSimulationRunner(gameManager, productionDatabaseProvider);
    const result = await runner.run({
      config: normalizedConfig,
      outputDirectory,
      runId: createRunId(),
      signal: abortController.signal,
      timeoutMs: options.timeoutMs,
      onProgress: record => {
        if (options.jsonl) process.stdout.write(`${JSON.stringify(record)}\n`);
        else if (record.type === 'turn_completed') {
          process.stderr.write(`completed turn ${record.turn}\n`);
        }
      },
    });
    process.stderr.write(`simulation bundle: ${result.outputPath}\n`);
    return result.bundle.result.status === 'completed'
      ? HEADLESS_EXIT_CODES.completed
      : result.bundle.result.status === 'failed'
        ? HEADLESS_EXIT_CODES.turnFailure
        : HEADLESS_EXIT_CODES.timeoutOrCancellation;
  } catch (error) {
    process.stderr.write(
      `headless simulation failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return error instanceof HeadlessSimulationOutputError
      ? HEADLESS_EXIT_CODES.outputFailure
      : HEADLESS_EXIT_CODES.turnFailure;
  } finally {
    gameManager?.clearAllGames();
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    try {
      const [{ closeConnection }, { redis }] = await Promise.all([
        import('@database'),
        import('@database/redis'),
      ]);
      await closeConnection();
      await redis.quit();
    } catch {
      // Preserve the simulation result; connection cleanup is best effort.
    }
  }
}

export function parseArguments(argv: string[]): CliOptions {
  const options: CliOptions = { jsonl: false, noPersist: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') continue;
    if (argument === '--jsonl') {
      options.jsonl = true;
      continue;
    }
    if (argument === '--no-persist') {
      options.noPersist = true;
      continue;
    }
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    switch (argument) {
      case '--config':
        options.configPath = value;
        break;
      case '--seed':
        options.seed = parseSeed(value, '--seed');
        break;
      case '--map-seed':
        if (!value.trim()) throw new Error('--map-seed must not be empty');
        options.mapSeed = value;
        break;
      case '--max-turns':
        options.maxTurns = parsePositiveInteger(value, '--max-turns');
        break;
      case '--output':
        options.outputDirectory = value;
        break;
      case '--timeout-ms':
        options.timeoutMs = parsePositiveInteger(value, '--timeout-ms');
        break;
      case '--database-url':
        options.databaseUrl = value;
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (!options.configPath) throw new Error('--config is required');
  if (!options.outputDirectory) throw new Error('--output is required');
  return options;
}

async function loadConfig(options: CliOptions): Promise<HeadlessSimulationConfig> {
  const raw = JSON.parse(await readFile(resolve(options.configPath!), 'utf8')) as Record<
    string,
    unknown
  >;
  const parsed = headlessSimulationConfigSchema.parse({
    ...raw,
    ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
  });
  const randomSeed = options.seed ?? readSeed(raw.seed ?? raw.randomSeed, 'config seed');
  const mapSeed = options.mapSeed ?? readMapSeed(raw.mapSeed);
  if (randomSeed === undefined) throw new Error('An explicit --seed or config seed is required');
  if (mapSeed === undefined)
    throw new Error('An explicit --map-seed or config mapSeed is required');
  return { ...parsed, randomSeed, mapSeed };
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
    !/(test|isolat|sandbox)/i.test(target) &&
    process.env.HEADLESS_SIMULATION_ISOLATED !== '1'
  ) {
    throw new Error('--no-persist requires a test, isolated, or sandbox database target');
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

if (require.main === module) {
  void main().then(code => {
    process.exitCode = code;
  });
}
