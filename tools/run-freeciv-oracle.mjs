#!/usr/bin/env node

/**
 * Runs deterministic c2c3 scenarios against a pinned Freeciv server build.
 *
 * The bundled reference tree intentionally omits the upstream build system,
 * so callers provide a locally built server and its complete upstream source
 * checkout. The script refuses an unpinned checkout: a result from a different
 * Freeciv revision must not be mistaken for c2c3 parity evidence.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scenariosDir = join(root, 'tools/freeciv-oracle/scenarios');
const pinnedVersion = '3.3.90.5-dev';
const pinnedCommit = '440b3c9650d3052792296868cb15591bd40612ea';
const pinnedReferenceTree = 'bb555d7fe91b147d4ec504cf933bcc372b7debc8';
const gameplaySourcePaths = ['ai', 'common', 'server', 'data/civ2civ3'];
const argumentsList = process.argv.slice(2);

function fail(message) {
  console.error(`Freeciv c2c3 oracle check failed: ${message}`);
  process.exit(1);
}

function failureOutput(output) {
  const luaErrorIndex = output.search(/\blua error:/i);
  if (luaErrorIndex !== -1) {
    const contextStart = Math.max(0, luaErrorIndex - 1_000);
    const contextEnd = Math.min(output.length, luaErrorIndex + 3_000);
    return output.slice(contextStart, contextEnd);
  }

  return output.slice(-4_000);
}

function optionValue(name) {
  const inline = argumentsList.find(argument => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argumentsList.indexOf(name);
  return index === -1 ? undefined : argumentsList[index + 1];
}

function collectFiles(directory, relativeDirectory = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = join(relativeDirectory, entry.name);
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(fullPath, relativePath);
    return entry.isFile() ? [relativePath] : [];
  });
}

const prerequisiteScenarioFiles = [
  'civ2civ3-bootstrap-tech-leakage.lua',
  'civ2civ3-spaceship-effects.lua',
];
const scenarioPriorities = new Map(prerequisiteScenarioFiles.map((file, index) => [file, index]));

// Technology Leakage has a fixed three-player denominator, while Apollo's
// world-scoped Enable_Space effect survives its source building. Run both
// prerequisite-dependent fixtures before later scenarios mutate that state,
// while retaining a deterministic lexical order for every other fixture.
const scenarios = readdirSync(scenariosDir)
  .filter(file => file.endsWith('.lua'))
  .sort((left, right) => {
    const leftPriority = scenarioPriorities.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = scenarioPriorities.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.localeCompare(right);
  })
  .map(file => ({ name: basename(file, '.lua'), path: join(scenariosDir, file) }));

if (argumentsList.includes('--list')) {
  process.stdout.write(`${scenarios.map(scenario => scenario.name).join('\n')}\n`);
  process.exit(0);
}

const requestedScenario = optionValue('--scenario');
const selectedScenarios = requestedScenario
  ? scenarios.filter(scenario => scenario.name === requestedScenario)
  : scenarios;

if (selectedScenarios.length === 0) {
  fail(
    requestedScenario
      ? `unknown scenario '${requestedScenario}'. Run with --list to see available scenarios.`
      : 'no oracle scenarios were found.'
  );
}

const binaryPath = process.env.FREECIV_ORACLE_BIN;
const dataPath = process.env.FREECIV_ORACLE_DATA;
const sourcePath = process.env.FREECIV_ORACLE_SOURCE ?? (dataPath ? dirname(dataPath) : undefined);
const port = process.env.FREECIV_ORACLE_PORT ?? '0';

if (!binaryPath || !dataPath || !sourcePath) {
  fail(
    'set FREECIV_ORACLE_BIN, FREECIV_ORACLE_DATA, and FREECIV_ORACLE_SOURCE to the pinned Freeciv build and source checkout.'
  );
}

for (const [label, path] of [
  ['FREECIV_ORACLE_BIN', binaryPath],
  ['FREECIV_ORACLE_DATA', dataPath],
  ['FREECIV_ORACLE_SOURCE', sourcePath],
]) {
  if (!existsSync(path)) fail(`${label} does not exist: ${path}`);
}

const revision = spawnSync('git', ['-C', sourcePath, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
});
if (revision.status !== 0) {
  fail(`could not read the Freeciv source revision at ${sourcePath}.`);
}
if (revision.stdout.trim() !== pinnedCommit) {
  fail(`source revision is ${revision.stdout.trim()}, expected pinned commit ${pinnedCommit}.`);
}

const referenceTree = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD:reference/freeciv'], {
  encoding: 'utf8',
});
if (referenceTree.status !== 0 || referenceTree.stdout.trim() !== pinnedReferenceTree) {
  fail(
    `bundled reference tree is ${referenceTree.stdout.trim() || 'unavailable'}, expected ${pinnedReferenceTree}.`
  );
}

const sourceDifferences = [];
for (const sourcePathFragment of gameplaySourcePaths) {
  const bundledDirectory = join(root, 'reference/freeciv', sourcePathFragment);
  if (!existsSync(bundledDirectory)) {
    fail(`bundled gameplay source path is missing: ${bundledDirectory}`);
  }
  for (const relativePath of collectFiles(bundledDirectory)) {
    const bundledFile = join(bundledDirectory, relativePath);
    const upstreamFile = join(sourcePath, sourcePathFragment, relativePath);
    if (!existsSync(upstreamFile)) {
      sourceDifferences.push(`${sourcePathFragment}/${relativePath}: missing upstream file`);
    } else if (!readFileSync(bundledFile).equals(readFileSync(upstreamFile))) {
      sourceDifferences.push(`${sourcePathFragment}/${relativePath}: content differs`);
    }
  }
}
if (sourceDifferences.length > 0) {
  fail(
    `bundled gameplay sources differ from pinned upstream source:\n${sourceDifferences
      .slice(0, 20)
      .map(difference => `- ${difference}`)
      .join('\n')}`
  );
}

const version = spawnSync(binaryPath, ['--version'], { encoding: 'utf8' });
const versionOutput = `${version.stdout ?? ''}${version.stderr ?? ''}`;
if (version.status !== 0 || !versionOutput.includes(`Freeciv version ${pinnedVersion}`)) {
  fail(`server binary is not Freeciv ${pinnedVersion}.`);
}

const tempDirectory = mkdtempSync(join(tmpdir(), 'civjs-freeciv-oracle-'));

try {
  const commands = [
    'set aifill 1',
    'set minplayers 0',
    'set animals 0',
    'start',
    ...selectedScenarios.map(scenario => `lua unsafe-file ${scenario.path}`),
    'quit',
  ].join('\n');
  const run = spawnSync(
    binaryPath,
    [
      '--ruleset',
      'civ2civ3',
      '--Announce',
      'none',
      '--port',
      port,
      '--saves',
      join(tempDirectory, 'saves'),
    ],
    {
      input: `${commands}\n`,
      encoding: 'utf8',
      env: { ...process.env, FREECIV_DATA_PATH: dataPath },
      timeout: 60_000,
    }
  );
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

  if (run.error) fail(run.error.message);
  if (run.status !== 0) {
    fail(`reference server exited with status ${run.status}.\n${failureOutput(output)}`);
  }
  if (/\blua error:/i.test(output)) {
    fail(`reference server reported a Lua fixture error.\n${failureOutput(output)}`);
  }

  const results = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/CIVJS_ORACLE_RESULT\s+([a-z0-9_]+)=(-?\d+(?:\.\d+)?)/i);
    if (!match) continue;
    const [, key, value] = match;
    if (key in results) fail(`oracle emitted duplicate result '${key}'.`);
    results[key] = Number(value);
  }

  if (Object.keys(results).length === 0) {
    fail(`reference server emitted no oracle result.\n${failureOutput(output)}`);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        baseline: { version: pinnedVersion, commit: pinnedCommit },
        results,
      },
      null,
      2
    )}\n`
  );
} finally {
  rmSync(tempDirectory, { force: true, recursive: true });
}
