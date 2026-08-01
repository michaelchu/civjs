import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixtureDirectory = resolve(repoRoot, 'docs/simulation-scenarios');
const defaultOutputDirectory = resolve(repoRoot, 'apps/artifacts/simulation-scenarios');

const usage = `Usage: npm run --silent simulation:run:scenarios -- [options]

Options:
  --fixtures <directory>    Directory containing JSON simulation configs
  --output <directory>      Parent directory for per-fixture run bundles
  --database-url <url>      PostgreSQL target (or use HEADLESS_SIMULATION_DATABASE_URL)
  --max-turns <count>       Override the validated hard turn cap for every fixture
  --timeout-ms <ms>         Stop each fixture at a turn boundary after this limit
  --jsonl                   Emit schema-versioned progress records from each run
  --no-persist              Require an explicitly isolated/test database target
  --continue-on-error       Run every fixture and report failures at the end
  --help                    Print this contract without side effects
`;

function parseArguments(argv) {
  const options = {
    fixtures: defaultFixtureDirectory,
    output: defaultOutputDirectory,
    jsonl: false,
    noPersist: false,
    continueOnError: false,
  };
  const valueOptions = new Map([
    ['--fixtures', 'fixtures'],
    ['--output', 'output'],
    ['--database-url', 'databaseUrl'],
    ['--max-turns', 'maxTurns'],
    ['--timeout-ms', 'timeoutMs'],
  ]);
  const flagOptions = new Map([
    ['--jsonl', 'jsonl'],
    ['--no-persist', 'noPersist'],
    ['--continue-on-error', 'continueOnError'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') return { help: true };
    const flag = flagOptions.get(argument);
    if (flag) {
      options[flag] = true;
      continue;
    }
    const option = valueOptions.get(argument);
    if (!option) throw new Error(`Unknown option: ${argument}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    options[option] = value;
  }
  return options;
}

function getFixturePaths(directory) {
  const fixturePaths = readdirSync(directory)
    .filter(name => extname(name) === '.json')
    .sort()
    .map(name => resolve(directory, name));
  if (fixturePaths.length === 0) throw new Error(`No JSON fixtures found in ${directory}`);
  return fixturePaths;
}

function buildRunArguments(fixturePath, outputPath, options) {
  const args = [
    'run',
    '--silent',
    'simulation:run',
    '--',
    '--config',
    fixturePath,
    '--output',
    outputPath,
  ];
  if (options.maxTurns) args.push('--max-turns', options.maxTurns);
  if (options.timeoutMs) args.push('--timeout-ms', options.timeoutMs);
  if (options.jsonl) args.push('--jsonl');
  if (options.noPersist) args.push('--no-persist');
  return args;
}

function runFixture(fixturePath, outputRoot, options, index, total) {
  const fixtureName = basename(fixturePath, extname(fixturePath));
  const outputPath = join(outputRoot, fixtureName);
  mkdirSync(outputPath, { recursive: true });
  process.stderr.write(`\n[${index}/${total}] ${fixtureName}\n`);
  const result = spawnSync('npm', buildRunArguments(fixturePath, outputPath, options), {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...(options.databaseUrl ? { HEADLESS_SIMULATION_DATABASE_URL: options.databaseUrl } : {}),
    },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArguments(argv);
    if (options.help) {
      process.stdout.write(usage);
      return 0;
    }
    const fixtureDirectory = resolve(options.fixtures);
    const outputDirectory = resolve(options.output);
    const fixturePaths = getFixturePaths(fixtureDirectory);
    mkdirSync(outputDirectory, { recursive: true });

    const failures = [];
    for (const [index, fixturePath] of fixturePaths.entries()) {
      const status = runFixture(
        fixturePath,
        outputDirectory,
        options,
        index + 1,
        fixturePaths.length
      );
      if (status !== 0) failures.push({ fixture: basename(fixturePath), status });
      if (status !== 0 && !options.continueOnError) break;
    }

    if (failures.length > 0) {
      process.stderr.write(
        `\n${failures.length} fixture run(s) failed:\n${failures
          .map(failure => `- ${failure.fixture}: exit ${failure.status}`)
          .join('\n')}\n`
      );
      return failures[0].status;
    }
    process.stderr.write(`\nAll ${fixturePaths.length} fixture runs completed successfully.\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage}`);
    return 2;
  }
}

process.exitCode = main();
