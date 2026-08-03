/**
 * Produces an evidence-based readiness report for a CivJS claim of gameplay
 * parity with Freeciv's default civ2civ3 ruleset.
 *
 * This is deliberately a certificate gate, not a coverage counter. It derives
 * the enabled action set and raw effect types from the checked-in c2c3
 * ruleset, then compares those source facts with explicit test annotations
 * and the runtime effect catalogue. `--strict` exits non-zero until every
 * currently measurable blocking condition is resolved.
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const json = args.has('--json');
const actionsOnly = args.has('--actions-only');

const rulesetDirectory = join(root, 'apps/server/src/shared/data/rulesets/civ2civ3');
const surfaceManifestPath = join(root, 'docs/CIV2CIV3_PARITY_SURFACES.json');
const scriptHookManifestPath = join(root, 'docs/CIV2CIV3_PARITY_SCRIPT_HOOKS.json');
const testRoots = ['apps/client/src', 'apps/server/src', 'apps/server/tests', 'tests'];
const testFilePattern = /\.(?:test|spec)\.(?:ts|tsx|js|jsx)$/;
const evidenceBlockPattern = /\/\*\*[\s\S]*?\*\//g;
const scenarioKinds = new Set(['normal', 'rejected', 'boundary']);
const requiredActionScenarios = ['normal', 'rejected', 'boundary'];
// These ruleset enablers are engine checks rather than player-issued
// commands. They still need end-to-end gameplay evidence, but their tests
// must identify the internal lifecycle that performs them instead of
// pretending a client can submit the action directly.
// @reference reference/freeciv/common/actions.c:826-833
const internalActionNames = new Set(['Civil War', 'Finish Unit', 'Finish Building']);

function usage() {
  console.log(`Usage: node tools/audit-civ2civ3-parity.mjs [--actions-only] [--json] [--strict]

  --actions-only  Report only the source action matrix.
  --json          Emit a machine-readable report.
  --strict        Exit non-zero unless the available evidence satisfies every
                  measurable gameplay-parity gate.`);
}

if (args.has('--help') || args.has('-h')) {
  usage();
  process.exit(0);
}

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function followsTestDeclaration(source) {
  return /^\s*(?:it|test)(?:\.(?:only|skip))?(?:\.each(?:<[\s\S]*?>)?\s*\(|\s*\()/.test(source);
}

async function collectTestFiles(directory) {
  let entries;
  try {
    entries = await readdir(join(root, directory), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = await Promise.all(
    entries.map(async entry => {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) return collectTestFiles(child);
      return testFilePattern.test(entry.name) ? [join(root, child)] : [];
    })
  );
  return files.flat();
}

function annotationValues(block, name) {
  const pattern = new RegExp(`@${name}\\s+([^\\n*]+)`, 'g');
  return [...block.matchAll(pattern)].flatMap(([, value]) =>
    value
      .trim()
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  );
}

function readEffectTypeNames(source) {
  return new Set(
    [...source.matchAll(/^\s+[A-Z0-9_]+\s*=\s*'([^']+)'/gm)].map(([, value]) => value)
  );
}

const [
  actionsSource,
  effectsSource,
  effectsManagerSource,
  buildingsSource,
  techsSource,
  surfaceManifestSource,
  scriptHookManifestSource,
  testFiles,
] = await Promise.all([
  readFile(join(rulesetDirectory, 'actions.json'), 'utf8'),
  readFile(join(rulesetDirectory, 'effects.json'), 'utf8'),
  readFile(join(root, 'apps/server/src/game/managers/EffectsManager.ts'), 'utf8'),
  readFile(join(rulesetDirectory, 'buildings.json'), 'utf8'),
  readFile(join(rulesetDirectory, 'techs.json'), 'utf8'),
  readFile(surfaceManifestPath, 'utf8'),
  readFile(scriptHookManifestPath, 'utf8'),
  Promise.all(testRoots.map(collectTestFiles)).then(files => files.flat().sort()),
]);

const actionRules = JSON.parse(actionsSource);
const surfaceManifest = JSON.parse(surfaceManifestSource);
const requiredSurfaceScenarios = surfaceManifest.required_scenarios;
if (
  !Array.isArray(requiredSurfaceScenarios) ||
  !requiredSurfaceScenarios.every(scenario => typeof scenario === 'string') ||
  !Array.isArray(surfaceManifest.surfaces) ||
  !surfaceManifest.surfaces.every(
    surface => typeof surface.id === 'string' && typeof surface.label === 'string'
  )
) {
  throw new Error(
    `Invalid Civ2Civ3 parity surface manifest: ${relative(root, surfaceManifestPath)}`
  );
}
const scriptHookManifest = JSON.parse(scriptHookManifestSource);
if (
  !Array.isArray(scriptHookManifest.hooks) ||
  !scriptHookManifest.hooks.every(
    hook =>
      typeof hook.source === 'string' &&
      typeof hook.signal === 'string' &&
      typeof hook.callback === 'string' &&
      ['gameplay', 'presentation'].includes(hook.scope) &&
      surfaceManifest.surfaces.some(surface => surface.id === hook.surface)
  )
) {
  throw new Error(
    `Invalid Civ2Civ3 parity script-hook manifest: ${relative(root, scriptHookManifestPath)}`
  );
}
const sourceActions = [...new Set(actionRules.enablers.map(enabler => enabler.action))].sort();
const actionEnablerCounts = Object.fromEntries(
  sourceActions.map(action => [
    action,
    actionRules.enablers.filter(enabler => enabler.action === action).length,
  ])
);
const actionEvidence = new Map(
  sourceActions.map(action => [
    action,
    Object.fromEntries(requiredActionScenarios.map(scenario => [scenario, []])),
  ])
);
const surfaceEvidence = new Map(
  surfaceManifest.surfaces.map(surface => [
    surface.id,
    Object.fromEntries(requiredSurfaceScenarios.map(scenario => [scenario, []])),
  ])
);
const scriptHookBySignal = new Map();
const scriptHookEvidence = new Map();
const scriptManifestErrors = [];
for (const hook of scriptHookManifest.hooks) {
  if (scriptHookBySignal.has(hook.signal)) {
    scriptManifestErrors.push(`duplicate script-hook signal in manifest: ${hook.signal}`);
    continue;
  }
  scriptHookBySignal.set(hook.signal, hook);
  scriptHookEvidence.set(hook.signal, []);
}
const scriptSources = [...new Set(scriptHookManifest.hooks.map(hook => hook.source))];
if (scriptSources.some(source => !source.startsWith('reference/freeciv/'))) {
  throw new Error('Civ2Civ3 script-hook manifest may only reference bundled Freeciv source.');
}
const scriptSourceContents = Object.fromEntries(
  await Promise.all(
    scriptSources.map(async source => [source, await readFile(join(root, source), 'utf8')])
  )
);
const declaredScriptConnections = new Set(
  scriptHookManifest.hooks.map(hook => `${hook.source}\u0000${hook.signal}\u0000${hook.callback}`)
);
for (const source of scriptSources) {
  const actualConnections = [
    ...scriptSourceContents[source].matchAll(/signal\.connect\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g),
  ].map(([, signal, callback]) => `${source}\u0000${signal}\u0000${callback}`);
  for (const connection of actualConnections) {
    if (!declaredScriptConnections.has(connection)) {
      scriptManifestErrors.push(
        `unaccounted ruleset script hook: ${connection.replaceAll('\u0000', ' -> ')}`
      );
    }
  }
}
for (const connection of declaredScriptConnections) {
  const [source, signal, callback] = connection.split('\u0000');
  const sourceText = scriptSourceContents[source];
  const pattern = new RegExp(`signal\\.connect\\(\\s*"${signal}"\\s*,\\s*"${callback}"\\s*\\)`);
  if (!pattern.test(sourceText)) {
    scriptManifestErrors.push(
      `declared ruleset script hook is missing from source: ${source} -> ${signal} -> ${callback}`
    );
  }
}
const metadataErrors = [...scriptManifestErrors];

for (const filePath of testFiles) {
  const source = await readFile(filePath, 'utf8');
  for (const match of source.matchAll(evidenceBlockPattern)) {
    const block = match[0];
    const actions = annotationValues(block, 'c2c3-action');
    const scenarios = annotationValues(block, 'c2c3-scenario').map(value => value.toLowerCase());
    const internalActions = annotationValues(block, 'c2c3-internal-action');
    const internalScenarios = annotationValues(block, 'c2c3-internal-scenario').map(value =>
      value.toLowerCase()
    );
    const surfaces = annotationValues(block, 'c2c3-surface');
    const surfaceScenarios = annotationValues(block, 'c2c3-surface-scenario').map(value =>
      value.toLowerCase()
    );
    const scriptHooks = annotationValues(block, 'c2c3-script-hook');
    if (
      actions.length === 0 &&
      scenarios.length === 0 &&
      internalActions.length === 0 &&
      internalScenarios.length === 0 &&
      surfaces.length === 0 &&
      surfaceScenarios.length === 0 &&
      scriptHooks.length === 0
    ) {
      continue;
    }

    const location = `${relative(root, filePath)}:${lineAt(source, match.index)}`;
    const hasActionMetadata =
      actions.length > 0 ||
      scenarios.length > 0 ||
      internalActions.length > 0 ||
      internalScenarios.length > 0;
    const hasSurfaceMetadata = surfaces.length > 0 || surfaceScenarios.length > 0;
    const hasScriptMetadata = scriptHooks.length > 0;
    if (
      (hasActionMetadata || hasSurfaceMetadata || hasScriptMetadata) &&
      !/@evidence\s+parity\b/i.test(block)
    ) {
      metadataErrors.push(
        `${location}: c2c3 action, surface, or script metadata must be source-backed @evidence parity.`
      );
    }
    if (
      (hasActionMetadata || hasSurfaceMetadata || hasScriptMetadata) &&
      !followsTestDeclaration(source.slice(match.index + block.length))
    ) {
      metadataErrors.push(
        `${location}: c2c3 action, surface, or script evidence must immediately precede an it(...) or test(...) case.`
      );
    }
    if (scenarios.length > 0 && actions.length === 0) {
      metadataErrors.push(`${location}: @c2c3-scenario requires @c2c3-action.`);
    }
    if (actions.length > 0 && scenarios.length === 0) {
      metadataErrors.push(`${location}: @c2c3-action requires @c2c3-scenario.`);
    }
    if (internalScenarios.length > 0 && internalActions.length === 0) {
      metadataErrors.push(`${location}: @c2c3-internal-scenario requires @c2c3-internal-action.`);
    }
    if (internalActions.length > 0 && internalScenarios.length === 0) {
      metadataErrors.push(`${location}: @c2c3-internal-action requires @c2c3-internal-scenario.`);
    }
    if (hasSurfaceMetadata && surfaces.length === 0) {
      metadataErrors.push(`${location}: @c2c3-surface-scenario requires @c2c3-surface.`);
    }
    if (hasSurfaceMetadata && surfaceScenarios.length === 0) {
      metadataErrors.push(`${location}: @c2c3-surface requires @c2c3-surface-scenario.`);
    }

    for (const action of actions) {
      if (!actionEvidence.has(action)) {
        metadataErrors.push(
          `${location}: ${JSON.stringify(action)} is not an enabled c2c3 action.`
        );
        continue;
      }
      for (const scenario of scenarios) {
        if (!scenarioKinds.has(scenario)) {
          metadataErrors.push(
            `${location}: @c2c3-scenario must be one of ${[...scenarioKinds].join(', ')}.`
          );
          continue;
        }
        actionEvidence.get(action)[scenario].push(location);
      }
    }

    for (const action of internalActions) {
      if (!actionEvidence.has(action)) {
        metadataErrors.push(
          `${location}: ${JSON.stringify(action)} is not an enabled c2c3 action.`
        );
        continue;
      }
      if (!internalActionNames.has(action)) {
        metadataErrors.push(
          `${location}: ${JSON.stringify(action)} is not a declared c2c3 internal action.`
        );
        continue;
      }
      for (const scenario of internalScenarios) {
        if (!scenarioKinds.has(scenario)) {
          metadataErrors.push(
            `${location}: @c2c3-internal-scenario must be one of ${[...scenarioKinds].join(', ')}.`
          );
          continue;
        }
        actionEvidence.get(action)[scenario].push(location);
      }
    }

    for (const surface of surfaces) {
      if (!surfaceEvidence.has(surface)) {
        metadataErrors.push(
          `${location}: ${JSON.stringify(surface)} is not a declared c2c3 gameplay surface.`
        );
        continue;
      }
      for (const scenario of surfaceScenarios) {
        if (!requiredSurfaceScenarios.includes(scenario)) {
          metadataErrors.push(
            `${location}: @c2c3-surface-scenario must be one of ${requiredSurfaceScenarios.join(', ')}.`
          );
          continue;
        }
        surfaceEvidence.get(surface)[scenario].push(location);
      }
    }

    for (const signal of scriptHooks) {
      if (!scriptHookEvidence.has(signal)) {
        metadataErrors.push(
          `${location}: ${JSON.stringify(signal)} is not a declared c2c3 ruleset script hook.`
        );
        continue;
      }
      scriptHookEvidence.get(signal).push(location);
    }
  }
}

const actionMatrix = sourceActions.map(action => {
  const scenarios = actionEvidence.get(action);
  const missingScenarios = requiredActionScenarios.filter(
    scenario => scenarios[scenario].length === 0
  );
  return {
    action,
    evidenceKind: internalActionNames.has(action) ? 'internal-lifecycle' : 'player-or-engine',
    enablers: actionEnablerCounts[action],
    scenarios,
    missingScenarios,
    complete: missingScenarios.length === 0,
  };
});
const incompleteActions = actionMatrix.filter(row => !row.complete);
const surfaceMatrix = surfaceManifest.surfaces.map(surface => {
  const scenarios = surfaceEvidence.get(surface.id);
  const missingScenarios = requiredSurfaceScenarios.filter(
    scenario => scenarios[scenario].length === 0
  );
  return {
    ...surface,
    scenarios,
    missingScenarios,
    complete: missingScenarios.length === 0,
  };
});
const incompleteSurfaces = surfaceMatrix.filter(surface => !surface.complete);
const scriptMatrix = scriptHookManifest.hooks.map(hook => {
  const evidence = scriptHookEvidence.get(hook.signal) ?? [];
  return {
    ...hook,
    evidence,
    complete: hook.scope !== 'gameplay' || evidence.length > 0,
  };
});
const incompleteGameplayScriptHooks = scriptMatrix.filter(hook => !hook.complete);

let effectAudit;
let adapterAudit;
let oracleFixtures = [];
if (!actionsOnly) {
  const effects = JSON.parse(effectsSource).effects;
  const rawEffectTypes = [...new Set(Object.values(effects).map(effect => effect.type))].sort();
  const runtimeEffectTypes = readEffectTypeNames(effectsManagerSource);
  const unsupportedEffectTypes = rawEffectTypes.filter(type => !runtimeEffectTypes.has(type));
  effectAudit = {
    effects: Object.keys(effects).length,
    rawTypes: rawEffectTypes.length,
    declaredRuntimeTypes: rawEffectTypes.length - unsupportedEffectTypes.length,
    unsupportedTypes: unsupportedEffectTypes,
  };

  const buildings = JSON.parse(buildingsSource).buildings;
  const legacyBuildingEffectAdapters = Object.keys(buildings).filter(
    id => Object.keys(buildings[id].effects ?? {}).length > 0
  );
  const techs = JSON.parse(techsSource).techs;
  const staticResearchCostAdapters = Object.keys(techs).filter(id => techs[id].cost !== undefined);
  adapterAudit = {
    legacyBuildingEffectAdapters,
    staticResearchCostAdapters,
  };

  const oracleDirectory = join(root, 'tools/freeciv-oracle/scenarios');
  if (existsSync(oracleDirectory)) {
    oracleFixtures = (await readdir(oracleDirectory))
      .filter(file => file.endsWith('.lua'))
      .sort()
      .map(file => `tools/freeciv-oracle/scenarios/${file}`);
  }
}

const blockers = [
  ...(metadataErrors.length > 0
    ? [`${metadataErrors.length} invalid action-evidence declaration(s)`]
    : []),
  ...(incompleteActions.length > 0
    ? [
        `${incompleteActions.length}/${sourceActions.length} enabled actions lack normal, rejected, or boundary evidence`,
      ]
    : []),
  ...(!actionsOnly && incompleteSurfaces.length > 0
    ? [
        `${incompleteSurfaces.length}/${surfaceMatrix.length} gameplay surfaces lack normal, boundary, turn, or differential evidence`,
      ]
    : []),
  ...(!actionsOnly && incompleteGameplayScriptHooks.length > 0
    ? [
        `${incompleteGameplayScriptHooks.length}/${scriptMatrix.filter(hook => hook.scope === 'gameplay').length} active gameplay script hooks lack source-backed evidence`,
      ]
    : []),
];
if (!actionsOnly) {
  if (effectAudit.unsupportedTypes.length > 0) {
    blockers.push(
      `${effectAudit.unsupportedTypes.length}/${effectAudit.rawTypes} raw effect types have no declared EffectsManager handler`
    );
  }
  if (adapterAudit.legacyBuildingEffectAdapters.length > 0) {
    blockers.push(
      `${adapterAudit.legacyBuildingEffectAdapters.length} buildings retain legacy static effect adapters`
    );
  }
  if (adapterAudit.staticResearchCostAdapters.length > 0) {
    blockers.push(
      `${adapterAudit.staticResearchCostAdapters.length} technologies retain static research-cost adapters`
    );
  }
  if (oracleFixtures.length === 0) {
    blockers.push('no pinned Freeciv differential-oracle fixture is available');
  }
}

const report = {
  ruleset: 'civ2civ3',
  source: 'reference/freeciv/data/civ2civ3/actions.ruleset',
  actions: {
    enablers: actionRules.enablers.length,
    distinct: sourceActions.length,
    complete: actionMatrix.length - incompleteActions.length,
    incomplete: incompleteActions.length,
    matrix: actionMatrix,
  },
  ...(actionsOnly
    ? {}
    : {
        surfaces: {
          requiredScenarios: requiredSurfaceScenarios,
          complete: surfaceMatrix.length - incompleteSurfaces.length,
          incomplete: incompleteSurfaces.length,
          matrix: surfaceMatrix,
        },
        scripts: {
          gameplayHooks: scriptMatrix.filter(hook => hook.scope === 'gameplay').length,
          gameplayHooksWithEvidence:
            scriptMatrix.filter(hook => hook.scope === 'gameplay').length -
            incompleteGameplayScriptHooks.length,
          matrix: scriptMatrix,
        },
        effects: effectAudit,
        adapters: adapterAudit,
        oracle: {
          fixtures: oracleFixtures,
          note: 'Fixture presence proves the pinned oracle is executable, not that every gameplay domain is differentially covered.',
        },
      }),
  metadataErrors,
  certificate: {
    status: blockers.length === 0 ? 'ready-for-human-review' : 'not-ready',
    blockers,
    note: 'A ready report is necessary but not sufficient for a public full-parity claim: its source mappings and differential scenarios still require human review.',
  },
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Civ2Civ3 parity audit: ${report.certificate.status}`);
  console.log(
    `Actions: ${report.actions.complete}/${report.actions.distinct} complete (${report.actions.enablers} enablers).`
  );
  if (!actionsOnly) {
    console.log(
      `Gameplay surfaces: ${report.surfaces.complete}/${report.surfaces.matrix.length} complete (${report.surfaces.requiredScenarios.join(', ')} required).`
    );
    console.log(
      `Gameplay script hooks: ${report.scripts.gameplayHooksWithEvidence}/${report.scripts.gameplayHooks} source-backed.`
    );
    console.log(
      `Effects: ${report.effects.declaredRuntimeTypes}/${report.effects.rawTypes} raw types have declared runtime handlers.`
    );
    console.log(
      `Adapters: ${report.adapters.legacyBuildingEffectAdapters.length} building-effect, ${report.adapters.staticResearchCostAdapters.length} research-cost.`
    );
    console.log(`Pinned oracle fixtures: ${report.oracle.fixtures.length}.`);
  }
  if (metadataErrors.length > 0) {
    console.log('Metadata errors:');
    metadataErrors.forEach(error => console.log(`- ${error}`));
  }
  if (blockers.length > 0) {
    console.log('Certificate blockers:');
    blockers.forEach(blocker => console.log(`- ${blocker}`));
  }
  console.log(
    'Use --json for the action-by-action report. Use --strict only when attempting a formal certificate.'
  );
}

if (strict && blockers.length > 0) {
  process.exitCode = 1;
}
