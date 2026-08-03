#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = join(root, 'reference/freeciv/data');
const supportedRuleset = 'civ2civ3';
const argumentsList = process.argv.slice(2);
const requestedRuleset =
  argumentsList.find(
    argument => argument === '--all' || argument === '--list' || !argument.startsWith('--')
  ) ?? supportedRuleset;
const checkOnly = argumentsList.includes('--check');
const writeMode = argumentsList.includes('--write');
const showDiff = argumentsList.includes('--diff');
const auditMode = argumentsList.includes('--audit');
const onlyArgument = argumentsList.find(argument => argument.startsWith('--only='));
const selectedFiles = onlyArgument
  ? new Set(
      onlyArgument
        .slice('--only='.length)
        .split(',')
        .map(file => (file.endsWith('.json') ? file : `${file}.json`))
    )
  : undefined;

if (checkOnly && writeMode) {
  throw new Error('Use either --check or --write, not both.');
}

if (requestedRuleset === '--all' || requestedRuleset === '--list') {
  if (requestedRuleset === '--list') {
    process.stdout.write(`${supportedRuleset}\n`);
    process.exit(0);
  }

  execFileSync(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      supportedRuleset,
      ...(checkOnly ? ['--check'] : []),
      ...(writeMode ? ['--write'] : []),
      ...(auditMode ? ['--audit'] : []),
      ...(onlyArgument ? [onlyArgument] : []),
    ],
    { stdio: 'inherit' }
  );
  process.exit(0);
}

const rulesetName = requestedRuleset;
const sourceDir = join(root, 'reference/freeciv/data', rulesetName);
const targetDir = join(root, 'apps/server/src/shared/data/rulesets', rulesetName);

if (!/^[a-z0-9][a-z0-9_-]*$/i.test(rulesetName)) {
  throw new Error(`Invalid ruleset name: ${rulesetName}`);
}

if (rulesetName !== supportedRuleset) {
  throw new Error(
    `Unsupported ruleset '${rulesetName}'. CivJS converts only '${supportedRuleset}'.`
  );
}

if (!existsSync(sourceDir)) {
  throw new Error(`Reference ruleset does not exist: ${sourceDir}`);
}

if (!checkOnly && !writeMode && !auditMode) {
  throw new Error(
    `Refusing to modify ${rulesetName} without --write. ` +
      `Use --check to verify or --write to regenerate converted data.`
  );
}

const retainedCompatibilityFields = {
  'buildings.json': [
    '$.buildings.*.effects (legacy building-effect adapter; authoritative effects remain in effects.json)',
  ],
  'techs.json': [
    '$.techs.*.position (CivJS client tech-tree layout; Freeciv ruleset files do not define visual coordinates)',
  ],
};

function stripComments(lines) {
  let quoted = false;
  return lines.map(line => {
    let result = '';
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && line[index - 1] !== '\\') quoted = !quoted;
      if ((character === ';' || character === '#') && !quoted) break;
      result += character;
    }
    return result.trimEnd();
  });
}

function parseTable(value) {
  const lines = value.split('\n').map(line =>
    [...line.matchAll(/"([^"]*)"|\b(TRUE|FALSE)\b|(-?\d+(?:\.\d+)?)/g)].map(match => {
      const token = match[1] ?? match[2] ?? match[3];
      return match[3] === undefined ? token : Number(token);
    })
  );
  const header = lines.find(tokens => tokens.length > 0) ?? [];
  const values = lines.slice(lines.indexOf(header) + 1).flat();
  const rows = [];
  for (let index = 0; index < values.length; index += header.length) {
    const row = values.slice(index, index + header.length);
    if (row.length !== header.length) continue;
    rows.push(
      Object.fromEntries(
        header.map((key, column) => [
          key,
          key === 'present' ? row[column].toUpperCase() !== 'FALSE' : row[column],
        ])
      )
    );
  }
  return rows;
}

function parseValue(rawValue) {
  const value = rawValue.trim();
  if (value.startsWith('{')) return parseTable(value);

  const translations = [...value.matchAll(/_\("((?:\\.|[^"\\])*)"\)/gs)].map(match =>
    match[1]
      .replace(/^\?[^:]+:/, '')
      .replace(/\\\n/g, '')
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim()
  );
  if (translations.length > 1) return translations;
  if (translations.length === 1) return translations[0];

  const translated = value.match(/^_\("(?:\?[^:"]+:)?([^"]*)"\)$/);
  if (translated) return translated[1];
  const quoted = [...value.matchAll(/"([^"]*)"/g)].map(match => match[1]);
  if (quoted.length > 1 || (quoted.length === 1 && value.includes(','))) return quoted;
  if (quoted.length === 1) return quoted[0];

  if (/^(TRUE|FALSE)$/i.test(value)) return value.toUpperCase() === 'TRUE';
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function asText(value) {
  return Array.isArray(value) ? value.join('\n') : value;
}

function mergeSections(target, incoming) {
  for (const [sectionName, section] of Object.entries(incoming)) {
    target[sectionName] = { ...(target[sectionName] ?? {}), ...section };
  }
}

function parseSecfilePath(filePath, seen = new Set(), followIncludes = true) {
  const absolutePath = filePath.startsWith('/') ? filePath : join(sourceDir, filePath);
  if (seen.has(absolutePath)) return {};
  seen.add(absolutePath);
  const lines = stripComments(readFileSync(absolutePath, 'utf8').split(/\r?\n/));
  const sections = {};
  let current;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const includeMatch = line.match(/^\*include\s+"([^"]+)"$/);
    if (includeMatch) {
      if (followIncludes) {
        const includePath = join(dataRoot, includeMatch[1]);
        mergeSections(sections, parseSecfilePath(includePath, seen, true));
      }
      continue;
    }
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      current = sections[sectionMatch[1]] ?? {};
      sections[sectionMatch[1]] = current;
      continue;
    }
    if (!current) continue;

    const assignment = line.match(/^([a-zA-Z0-9_.]+)\s*=\s*(.*)$/);
    if (!assignment) continue;
    const [, key] = assignment;
    const valueLines = [assignment[2]];
    while (index + 1 < lines.length) {
      const next = lines[index + 1].trim();
      if (
        /^\[[^\]]+\]$/.test(next) ||
        /^\*include\s+"/.test(next) ||
        /^[a-zA-Z0-9_.]+\s*=/.test(next)
      ) {
        break;
      }
      index += 1;
      if (next) valueLines.push(next);
    }
    current[key] = parseValue(valueLines.join('\n'));
  }
  return sections;
}

function parseSecfile(fileName) {
  return parseSecfilePath(join(sourceDir, fileName));
}

function metadata(datafile, source) {
  return {
    source,
    datafile: {
      description: Array.isArray(datafile.description)
        ? datafile.description.join('\n')
        : datafile.description,
      options: datafile.options,
      format_version: datafile.format_version,
    },
  };
}

function referenceSource(fileName) {
  return `reference/freeciv/data/${rulesetName}/${fileName}`;
}

function describeJsonValue(value) {
  const serialized = JSON.stringify(value);
  return serialized.length > 160 ? `${serialized.slice(0, 157)}...` : serialized;
}

function describeJsonDifferences(actual, expected, path = '$', differences = [], limit = 30) {
  if (differences.length >= limit) return differences;

  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
      differences.push(
        `${path}: expected ${describeJsonValue(expected)}, got ${describeJsonValue(actual)}`
      );
      return differences;
    }
    if (actual.length !== expected.length) {
      differences.push(`${path}: expected ${expected.length} items, got ${actual.length}`);
    }
    for (let index = 0; index < Math.max(actual.length, expected.length); index += 1) {
      if (differences.length >= limit) break;
      if (index >= actual.length) {
        differences.push(`${path}[${index}]: missing from checked-in data`);
      } else if (index >= expected.length) {
        differences.push(`${path}[${index}]: unexpected checked-in value`);
      } else {
        describeJsonDifferences(
          actual[index],
          expected[index],
          `${path}[${index}]`,
          differences,
          limit
        );
      }
    }
    return differences;
  }

  const actualObject = actual !== null && typeof actual === 'object';
  const expectedObject = expected !== null && typeof expected === 'object';
  if (actualObject || expectedObject) {
    if (!actualObject || !expectedObject) {
      differences.push(
        `${path}: expected ${describeJsonValue(expected)}, got ${describeJsonValue(actual)}`
      );
      return differences;
    }
    for (const key of [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort()) {
      if (differences.length >= limit) break;
      const childPath = `${path}.${key}`;
      if (!(key in actual)) {
        differences.push(`${childPath}: missing from checked-in data`);
      } else if (!(key in expected)) {
        differences.push(`${childPath}: unexpected checked-in value`);
      } else {
        describeJsonDifferences(actual[key], expected[key], childPath, differences, limit);
      }
    }
    return differences;
  }

  if (actual !== expected) {
    differences.push(
      `${path}: expected ${describeJsonValue(expected)}, got ${describeJsonValue(actual)}`
    );
  }
  return differences;
}

function convertActions() {
  const sections = parseSecfile('actions.ruleset');
  return {
    ...metadata(sections.datafile, referenceSource('actions.ruleset')),
    auto_attack: sections.auto_attack,
    settings: sections.actions,
    action_properties: Object.fromEntries(
      Object.entries(sections).filter(([id]) => id.startsWith('action_'))
    ),
    enablers: Object.entries(sections)
      .filter(([id]) => id.startsWith('enabler_'))
      .map(([id, section]) => ({
        id,
        action: section.action,
        actor_reqs: section.actor_reqs ?? [],
        target_reqs: section.target_reqs ?? [],
        ...(section.comment ? { comment: section.comment } : {}),
      })),
  };
}

function convertExtras() {
  const sections = parseSecfile('terrain.ruleset');
  const select = prefix =>
    Object.fromEntries(Object.entries(sections).filter(([id]) => id.startsWith(prefix)));
  return {
    ...metadata(sections.datafile, referenceSource('terrain.ruleset')),
    resources: select('resource_'),
    extras: select('extra_'),
    bases: select('base_'),
    roads: select('road_'),
    terrain_extra_settings: Object.fromEntries(
      Object.entries(select('terrain_')).map(([id, terrain]) => [
        id,
        { terrain: terrain.name, extra_settings: terrain.extra_settings ?? [] },
      ])
    ),
  };
}

function convertEffects() {
  const sections = parseSecfile('effects.ruleset');
  const effects = Object.fromEntries(
    Object.entries(sections)
      .filter(([id]) => id.startsWith('effect_'))
      .map(([id, effect]) => [
        id.slice('effect_'.length),
        {
          id: id.slice('effect_'.length),
          type: effect.type,
          value: effect.value,
          ...(effect.reqs?.length ? { reqs: effect.reqs } : {}),
          ...(effect.comment ? { comment: effect.comment } : {}),
        },
      ])
  );
  return {
    ...metadata(sections.datafile, referenceSource('effects.ruleset')),
    about: {
      name: `Freeciv ${rulesetName} Effects Ruleset`,
      summary: asText(sections.datafile.description),
    },
    user_effects: Object.fromEntries(
      Object.entries(sections).filter(([id]) => id.startsWith('ueff_'))
    ),
    effects,
  };
}

function convertTerrain() {
  const sections = parseSecfile('terrain.ruleset');
  const terrainSections = Object.entries(sections).filter(([id]) => id.startsWith('terrain_'));
  const terrainNameToId = new Map(
    terrainSections.map(([sectionId, terrain]) => [
      normalizeId(terrain.name),
      sectionId === 'terrain_inaccesible' ? 'inaccessible' : sectionId.slice('terrain_'.length),
    ])
  );
  const resolveTerrain = value => {
    if (!value || value.toLowerCase() === 'no') return undefined;
    return terrainNameToId.get(normalizeId(value)) ?? normalizeId(value);
  };
  const properties = [
    'cold',
    'dry',
    'foliage',
    'frozen',
    'green',
    'mountainous',
    'ocean_depth',
    'temperate',
    'tropical',
    'wet',
  ];
  const terrains = Object.fromEntries(
    terrainSections.map(([sectionId, terrain]) => {
      const id =
        sectionId === 'terrain_inaccesible' ? 'inaccessible' : sectionId.slice('terrain_'.length);
      const flags = asArray(terrain.flags).filter(Boolean);
      return [
        id,
        {
          ...terrain,
          source_section: sectionId,
          id,
          name: id,
          display_name: terrain.name,
          properties: Object.fromEntries(
            properties
              .filter(property => terrain[`property_${property}`] !== undefined)
              .map(property => [`MG_${property.toUpperCase()}`, terrain[`property_${property}`]])
          ),
          moveCost: terrain.movement_cost,
          defense: terrain.defense_bonus,
          shields: terrain.shield,
          roadTime: terrain.road_time,
          irrigationFoodIncr: terrain.irrigation_food_incr,
          irrigationTime: terrain.irrigation_time,
          miningShieldIncr: terrain.mining_shield_incr,
          miningTime: terrain.mining_time,
          cultivateTo: resolveTerrain(terrain.cultivate_result),
          cultivateTime: terrain.cultivate_time,
          plantTo: resolveTerrain(terrain.plant_result),
          plantTime: terrain.plant_time,
          transformTo: resolveTerrain(terrain.transform_result),
          transformTime: terrain.transform_time,
          canHaveRiver: flags.includes('CanHaveRiver'),
          notGenerated: flags.includes('NotGenerated'),
        },
      ];
    })
  );

  return {
    ...metadata(sections.datafile, referenceSource('terrain.ruleset')),
    about: {
      name: `Freeciv ${rulesetName} Terrain Ruleset`,
      summary: asText(sections.datafile.description),
    },
    // Freeciv's `[parameters]` section populates terrain_control at runtime
    // and carries ruleset-wide movement units such as `move_fragments`.
    // Keep the normalized control object with the terrain projection rather
    // than duplicating per-ruleset constants in runtime code.
    terrain_control: sections.parameters ?? {},
    terrains,
  };
}

function convertStyles() {
  const sections = parseSecfile('styles.ruleset');
  const select = prefix =>
    Object.fromEntries(Object.entries(sections).filter(([id]) => id.startsWith(prefix)));
  return {
    ...metadata(sections.datafile, referenceSource('styles.ruleset')),
    nation_styles: select('style_'),
    city_styles: select('citystyle_'),
    music_styles: select('musicstyle_'),
  };
}

function asArray(value) {
  if (value === undefined || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function asNumberList(value) {
  if (typeof value !== 'string' || !value.includes(',')) return value;
  const values = value.split(',').map(entry => Number(entry.trim()));
  return values.every(Number.isFinite) ? values : value;
}

function selectSections(sections, prefix) {
  return Object.fromEntries(
    Object.entries(sections)
      .filter(([id]) => id.startsWith(prefix))
      .map(([id, section]) => [id.slice(prefix.length), section])
  );
}

function loadTargetJson(fileName) {
  return JSON.parse(readFileSync(join(targetDir, fileName), 'utf8'));
}

function normalizeId(value) {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function buildNameToId(sections, prefix) {
  return new Map(
    Object.entries(sections)
      .filter(([id]) => id.startsWith(prefix))
      .map(([sectionId, section]) => [
        normalizeId(section.rule_name ?? section.name),
        sectionId.slice(prefix.length),
      ])
  );
}

function resolveNamedId(value, nameToId) {
  if (value === undefined || value === '' || value === 'None' || value === 'Never') {
    return undefined;
  }
  return nameToId.get(normalizeId(value)) ?? normalizeId(value);
}

function firstRequirement(section, type) {
  return (section.reqs ?? []).find(
    requirement => requirement.type?.toLowerCase() === type.toLowerCase()
  );
}

function convertUnits() {
  const sections = parseSecfile('units.ruleset');
  const techSections = parseSecfile('techs.ruleset');
  const unitNameToId = buildNameToId(sections, 'unit_');
  const techNameToId = buildNameToId(techSections, 'advance_');
  const unitClasses = Object.fromEntries(
    Object.entries(sections)
      .filter(([id]) => id.startsWith('unitclass_'))
      .map(([, unitClass]) => [
        unitClass.name,
        {
          ...unitClass,
          id: unitClass.name,
          name: unitClass.name,
          min_speed: unitClass.min_speed,
          hp_loss_pct: unitClass.hp_loss_pct,
          flags: asArray(unitClass.flags),
        },
      ])
  );
  const units = Object.fromEntries(
    Object.entries(sections)
      .filter(([id]) => id.startsWith('unit_') && !id.startsWith('unitclass_'))
      .map(([sectionId, unit]) => {
        const id = sectionId.slice('unit_'.length);
        const requiredTech = resolveNamedId(firstRequirement(unit, 'Tech')?.name, techNameToId);
        const obsoleteBy = resolveNamedId(unit.obsolete_by, unitNameToId);
        const convertTo = resolveNamedId(unit.convert_to, unitNameToId);
        return [
          id,
          {
            ...unit,
            id,
            name: unit.name,
            cost: unit.build_cost,
            movement: unit.move_rate,
            attack: unit.attack,
            defense: unit.defense,
            hitpoints: unit.hitpoints,
            firepower: unit.firepower,
            bombard_rate: unit.bombard_rate ?? 0,
            paratroopers_range: unit.paratroopers_range ?? 0,
            vision_radius_sq: unit.vision_radius_sq,
            transport_cap: unit.transport_cap,
            cargo: asArray(unit.cargo),
            fuel: unit.fuel,
            uk_happy: unit.uk_happy,
            uk_shield: unit.uk_shield,
            uk_food: unit.uk_food,
            uk_gold: unit.uk_gold,
            unit_class: unit.class,
            roles: asArray(unit.roles).filter(Boolean),
            flags: asArray(unit.flags).filter(Boolean),
            ...(requiredTech ? { required_tech: requiredTech } : {}),
            obsolete_by: obsoleteBy,
            convert_to: convertTo,
            veteran_levels: Math.max(1, asArray(unit.veteran_names).length),
          },
        ];
      })
  );

  return {
    ...metadata(sections.datafile, referenceSource('units.ruleset')),
    about: {
      name: `Freeciv ${rulesetName} Units Ruleset`,
      summary: asText(sections.datafile.description),
    },
    veteran_system: sections.veteran_system,
    unit_classes: unitClasses,
    units,
  };
}

function convertBuildings() {
  const sections = parseSecfile('buildings.ruleset');
  const techSections = parseSecfile('techs.ruleset');
  const techNameToId = buildNameToId(techSections, 'advance_');
  const buildingNameToId = buildNameToId(sections, 'building_');
  const buildings = Object.fromEntries(
    Object.entries(sections)
      .filter(([id]) => id.startsWith('building_'))
      .map(([sectionId, building]) => {
        const id = sectionId.slice('building_'.length);
        const requiredTech = resolveNamedId(firstRequirement(building, 'Tech')?.name, techNameToId);
        const prerequisites = (building.reqs ?? [])
          .filter(requirement => requirement.type?.toLowerCase() === 'building')
          .map(requirement => resolveNamedId(requirement.name, buildingNameToId))
          .filter(Boolean);
        const cultureRequirements = (building.reqs ?? [])
          .filter(requirement => requirement.type === 'MinCulture')
          .map(requirement => ({
            type: 'MinCulture',
            value: Number(requirement.name),
            range: requirement.range,
            present: requirement.present ?? true,
          }));
        return [
          id,
          {
            ...building,
            id,
            name: building.name,
            genus: building.genus,
            cost: building.build_cost,
            upkeep: building.upkeep,
            ...(requiredTech ? { requiredTech } : {}),
            ...(prerequisites.length > 0 ? { requires: prerequisites } : {}),
            ...(cultureRequirements.length > 0 ? { cultureRequirements } : {}),
            // Freeciv rulesets enumerate every improvement. CivJS keeps that
            // catalogue complete and uses validation requirements to decide
            // whether a city may build a specific entry.
            playable: true,
          },
        ];
      })
  );

  return {
    ...metadata(sections.datafile, referenceSource('buildings.ruleset')),
    about: {
      name: `Freeciv ${rulesetName} Buildings Ruleset`,
      summary: asText(sections.datafile.description),
    },
    buildings,
  };
}

function convertTechs() {
  const sections = parseSecfile('techs.ruleset');
  const presentation = loadTargetJson('techs.json');
  const techNameToId = buildNameToId(sections, 'advance_');
  const techs = Object.fromEntries(
    Object.entries(sections)
      .filter(([id]) => id.startsWith('advance_'))
      .map(([sectionId, tech], index) => {
        const id = sectionId.slice('advance_'.length);
        const presentationTech = presentation.techs[id];
        const requirements = [tech.req1, tech.req2]
          .map(requirement => resolveNamedId(requirement, techNameToId))
          .filter(Boolean);
        return [
          id,
          {
            ...tech,
            id,
            freeciv_id: index + 1,
            name: tech.name,
            internal_name: tech.rule_name ?? tech.name,
            requirements,
            root_req: resolveNamedId(tech.root_req, techNameToId) ?? null,
            flags: asArray(tech.flags).filter(Boolean),
            ...(presentationTech?.position ? { position: presentationTech.position } : {}),
            order: index + 1,
          },
        ];
      })
  );

  return {
    ...metadata(sections.datafile, referenceSource('techs.ruleset')),
    about: {
      name: `Freeciv ${rulesetName} Technologies Ruleset`,
      summary: asText(sections.datafile.description),
    },
    control: sections.control,
    techs,
  };
}

function convertGovernments() {
  const sections = parseSecfile('governments.ruleset');
  const types = Object.fromEntries(
    Object.entries(sections)
      .filter(([id]) => id.startsWith('government_'))
      .map(([sectionId, government]) => {
        const id = sectionId.slice('government_'.length);
        return [
          id,
          {
            ...government,
            id,
            name: government.name,
            reqs: government.reqs ?? [],
            helptext: government.helptext ?? '',
          },
        ];
      })
  );
  return {
    ...metadata(sections.datafile, referenceSource('governments.ruleset')),
    about: {
      name: `Freeciv ${rulesetName} Governments Ruleset`,
      summary: asText(sections.datafile.description),
    },
    governments: {
      during_revolution: sections.governments.during_revolution,
      types,
    },
  };
}

function convertNations() {
  const sections = parseSecfile('nations.ruleset');
  const main = parseSecfilePath(join(sourceDir, 'nations.ruleset'), new Set(), false);
  const defaultTraits = sections.default_traits ?? main.default_traits;
  const compatibility = sections.compatibility ?? main.compatibility;
  const nationSets = Object.fromEntries(
    Object.entries(sections).filter(([id]) => id.startsWith('nset_'))
  );
  const nationSetAliases = new Map(
    Object.entries(nationSets).flatMap(([id, nationSet]) => {
      const ruleName =
        typeof nationSet.rule_name === 'string' ? nationSet.rule_name : id.slice('nset_'.length);
      return [
        [ruleName.toLowerCase(), ruleName],
        ...(typeof nationSet.name === 'string' ? [[nationSet.name.toLowerCase(), ruleName]] : []),
        [id.slice('nset_'.length).toLowerCase(), ruleName],
      ];
    })
  );
  const defaultNationSet = compatibility.default_nationset;
  const nations = Object.fromEntries(
    Object.entries(sections)
      .filter(([id]) => id.startsWith('nation_'))
      .map(([sectionId, nation]) => {
        const id = sectionId.slice('nation_'.length);
        const sourceGroups = asArray(nation.groups);
        const explicitSets = sourceGroups
          .map(group => nationSetAliases.get(group.toLowerCase()))
          .filter(Boolean);
        const sets = [
          ...(typeof defaultNationSet === 'string' ? [defaultNationSet] : []),
          ...explicitSets,
        ].filter((set, index, values) => values.indexOf(set) === index);
        const groups = sourceGroups.filter(group => !nationSetAliases.has(group.toLowerCase()));
        return [
          id,
          {
            ...nation,
            id,
            name: nation.name,
            plural: nation.plural,
            adjective: nation.name,
            class: groups[0] ?? 'Other',
            style: nation.style ?? 'European',
            init_government: nation.init_government ?? compatibility.default_government,
            leaders: (nation.leaders ?? []).map(leader => ({
              ...leader,
              sex:
                typeof leader.sex === 'string'
                  ? `${leader.sex.charAt(0).toUpperCase()}${leader.sex.slice(1).toLowerCase()}`
                  : leader.sex,
            })),
            init_techs: asArray(nation.init_techs),
            init_buildings: asArray(nation.init_buildings),
            init_units: asArray(nation.init_units),
            civilwar_nations: asArray(nation.civilwar_nations),
            groups,
            sets,
            conflicts: asArray(nation.conflicts_with),
            cities: asArray(nation.cities),
            flag: nation.flag ? `f.${nation.flag}` : undefined,
            flag_alt: nation.flag_alt ? `f.${nation.flag_alt}` : undefined,
            // Freeciv fills omitted nation trait limits from [default_traits].
            // @reference reference/freeciv/server/ruleset/ruleload.c:5408-5427
            traits: {
              ...defaultTraits,
              ...Object.fromEntries(
                Object.entries(nation)
                  .filter(([key]) => key.startsWith('trait_'))
                  .map(([key, value]) => [key.slice('trait_'.length), value])
              ),
            },
          },
        ];
      })
  );

  return {
    datafile: metadata(main.datafile, referenceSource('nations.ruleset')).datafile,
    about: {
      name: `Freeciv ${rulesetName} Nations Ruleset`,
      summary: asText(main.datafile.description),
    },
    compatibility,
    default_traits: defaultTraits,
    nation_sets: nationSets,
    nation_groups: Object.fromEntries(
      Object.entries(sections).filter(([id]) => id.startsWith('ngroup_'))
    ),
    nations,
  };
}

function convertCities() {
  const sections = parseSecfile('cities.ruleset');
  const styles = parseSecfile('styles.ruleset');
  const terrain = parseSecfile('terrain.ruleset');
  const units = parseSecfile('units.ruleset');
  const actions = parseSecfile('actions.ruleset');
  const cityStyles = Object.fromEntries(
    Object.entries(styles)
      .filter(([id]) => id.startsWith('citystyle_'))
      .map(([sectionId, style]) => {
        const techRequirement = (style.reqs ?? []).find(
          requirement => requirement.type?.toLowerCase() === 'tech' && requirement.present !== false
        );
        return [
          sectionId.slice('citystyle_'.length),
          {
            name: style.name,
            graphic: style.graphic,
            ...(style.graphic_alt !== undefined ? { graphic_alt: style.graphic_alt } : {}),
            ...(style.citizens_graphic !== undefined
              ? { citizens_graphic: style.citizens_graphic }
              : {}),
            ...(techRequirement ? { techreq: techRequirement.name } : {}),
          },
        ];
      })
  );
  const noCitiesTerrains = Object.entries(terrain)
    .filter(
      ([id, definition]) =>
        id.startsWith('terrain_') && asArray(definition.flags).includes('NoCities')
    )
    .map(([id]) => (id === 'terrain_inaccesible' ? 'inaccessible' : id.slice('terrain_'.length)));
  const foundCityEnablers = Object.values(actions).filter(
    section => section.action === 'Found City'
  );
  const foundingFlags = new Set(
    foundCityEnablers.flatMap(enabler =>
      (enabler.actor_reqs ?? [])
        .filter(requirement => requirement.type === 'UnitTypeFlag' && requirement.present !== false)
        .map(requirement => requirement.name)
    )
  );
  const foundingUnits = Object.entries(units)
    .filter(
      ([id, unit]) =>
        id.startsWith('unit_') &&
        !id.startsWith('unitclass_') &&
        asArray(unit.flags).some(flag => foundingFlags.has(flag))
    )
    .map(([id]) => id.slice('unit_'.length));
  const allowForeignTerritory = foundCityEnablers.some(enabler =>
    (enabler.actor_reqs ?? []).some(
      requirement =>
        requirement.type === 'DiplRel' &&
        requirement.name === 'Foreign' &&
        requirement.present === true
    )
  );

  return {
    ...metadata(sections.datafile, referenceSource('cities.ruleset')),
    about: {
      name: `Freeciv ${rulesetName} Cities Ruleset`,
      summary: asText(sections.datafile.description),
    },
    specialists: selectSections(sections, 'specialist_'),
    parameters: sections.parameters,
    citizen: sections.citizen,
    city_styles: cityStyles,
    founding_rules: {
      no_cities_terrains: noCitiesTerrains,
      founding_units: foundingUnits,
      allow_foreign_territory: allowForeignTerritory,
      // Freeciv rejects enemy-occupied city tiles unconditionally when a
      // city is created, rather than making this a ruleset setting.
      // @reference reference/freeciv/server/citytools.c:1681-1689
      enemy_units_block: true,
      // A Found City action is performed by the unit already on the target
      // tile; Freeciv's city_can_be_built_here() has no visibility gate.
      // @reference reference/freeciv/common/city.c:1487-1550
      exploration_requirement: 0,
    },
  };
}

function convertGame() {
  const sections = parseSecfile('game.ruleset');
  const civstyle = sections.civstyle;
  const incite = sections.incite_cost;

  return {
    ...metadata(sections.datafile, referenceSource('game.ruleset')),
    ruledit: sections.ruledit,
    about: sections.about,
    capabilities: asArray(sections.about.capabilities),
    options: sections.options,
    tileset: sections.tileset,
    soundset: sections.soundset,
    musicset: sections.musicset,
    civstyle: {
      base_pollution: civstyle.base_pollution,
      happy_cost: civstyle.happy_cost,
      food_cost: civstyle.food_cost,
      granary_food_ini: asNumberList(civstyle.granary_food_ini),
      granary_food_inc: civstyle.granary_food_inc,
      min_city_center_food: civstyle.min_city_center_food,
      min_city_center_shield: civstyle.min_city_center_shield,
      min_city_center_trade: civstyle.min_city_center_trade,
    },
    game_parameters: {
      init_city_radius_sq: civstyle.init_city_radius_sq,
      init_vis_radius_sq: civstyle.init_vis_radius_sq,
      base_bribe_cost: civstyle.base_bribe_cost,
      ransom_gold: civstyle.ransom_gold,
      upgrade_veteran_loss: civstyle.upgrade_veteran_loss,
      autoupgrade_veteran_loss: civstyle.autoupgrade_veteran_loss,
      pillage_select: civstyle.pillage_select,
      tech_steal_allow_holes: civstyle.tech_steal_allow_holes,
      tech_trade_allow_holes: civstyle.tech_trade_allow_holes,
      tech_trade_loss_allow_holes: civstyle.tech_trade_loss_allow_holes,
      tech_parasite_allow_holes: civstyle.tech_parasite_allow_holes,
      tech_loss_allow_holes: civstyle.tech_loss_allow_holes,
      gameloss_style: civstyle.gameloss_style,
      paradrop_to_transport: civstyle.paradrop_to_transport,
      gold_upkeep_style: civstyle.gold_upkeep_style,
      output_granularity: civstyle.output_granularity,
      airlift_from_always_enabled: civstyle.airlift_from_always_enabled,
      airlift_to_always_enabled: civstyle.airlift_to_always_enabled,
      base_incite_cost: incite.base_incite_cost,
      incite_improvement_factor: incite.improvement_factor,
      incite_unit_factor: incite.unit_factor,
      incite_total_factor: incite.total_factor,
    },
    wonder_visibility: sections.wonder_visibility,
    illness: sections.illness,
    combat_rules: sections.combat_rules,
    borders: sections.borders,
    research: sections.research,
    culture: sections.culture,
    world_peace: sections.world_peace,
    calendar: {
      start_year: sections.calendar.start_year,
      skip_year_0: sections.calendar.skip_year_0,
      fragments: sections.calendar.fragments,
      fragment_names: Object.entries(sections.calendar)
        .filter(([key]) => /^fragment_name\d+$/.test(key))
        .sort(([left], [right]) => Number(left.slice(13)) - Number(right.slice(13)))
        .map(([, value]) => value),
      positive_label: sections.calendar.positive_label,
      negative_label: sections.calendar.negative_label,
    },
    disasters: selectSections(sections, 'disaster_'),
    trade: sections.trade,
    goods: selectSections(sections, 'goods_'),
    access_area: sections.aarea,
    diplomacy_clauses: selectSections(sections, 'clause_'),
    player_colors: sections.playercolors,
    teams: sections.teams,
    settings: sections.settings,
  };
}

const generatedFiles = [];
const staleFiles = [];
const staleDetails = [];
if (writeMode) {
  mkdirSync(targetDir, { recursive: true });
}
const convertedFiles = [
  ['actions.json', convertActions()],
  ['buildings.json', convertBuildings()],
  ['cities.json', convertCities()],
  ['effects.json', convertEffects()],
  ['extras.json', convertExtras()],
  ['game.json', convertGame()],
  ['governments.json', convertGovernments()],
  ['nations.json', convertNations()],
  ['styles.json', convertStyles()],
  ['terrain.json', convertTerrain()],
  ['techs.json', convertTechs()],
  ['units.json', convertUnits()],
];

if (selectedFiles) {
  const knownFiles = new Set(convertedFiles.map(([fileName]) => fileName));
  const unknownFiles = [...selectedFiles].filter(fileName => !knownFiles.has(fileName));
  if (unknownFiles.length > 0) {
    throw new Error(`Unknown converted ruleset files: ${unknownFiles.join(', ')}`);
  }
}

if (auditMode) {
  const selectedFileNames = convertedFiles
    .map(([fileName]) => fileName)
    .filter(fileName => !selectedFiles || selectedFiles.has(fileName));
  const compatibilityFields = Object.fromEntries(
    Object.entries(retainedCompatibilityFields).filter(([fileName]) =>
      selectedFileNames.includes(fileName)
    )
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        ruleset: rulesetName,
        checked_files: selectedFileNames,
        retained_compatibility_fields: compatibilityFields,
        certificate_status:
          Object.keys(compatibilityFields).length === 0
            ? 'source-derived projection complete for selected files'
            : 'not a complete source-data certificate; see retained compatibility fields',
      },
      null,
      2
    )}\n`
  );
  process.exit(0);
}

for (const [fileName, data] of convertedFiles) {
  if (selectedFiles && !selectedFiles.has(fileName)) continue;
  const target = join(targetDir, fileName);
  const generated = `${JSON.stringify(data, null, 2)}\n`;
  if (checkOnly) {
    if (!existsSync(target)) {
      staleFiles.push(`${fileName} is missing`);
    } else {
      const actualData = JSON.parse(readFileSync(target, 'utf8'));
      const actual = `${JSON.stringify(actualData, null, 2)}\n`;
      if (actual !== generated) {
        staleFiles.push(fileName);
        if (showDiff) {
          const differences = describeJsonDifferences(actualData, JSON.parse(generated));
          staleDetails.push(`${fileName}:\n${differences.map(line => `  ${line}`).join('\n')}`);
        }
      }
    }
  } else if (writeMode) {
    writeFileSync(target, generated);
  }
  generatedFiles.push(target);
}

if (checkOnly) {
  if (staleFiles.length > 0) {
    throw new Error(
      `Converted ${rulesetName} ruleset data is stale: ${staleFiles.join(', ')}. ` +
        `Run: node tools/convert-rulesets.mjs ${rulesetName} --write` +
        (staleDetails.length > 0 ? `\n${staleDetails.join('\n')}` : '')
    );
  }
  process.stdout.write(
    `Verified ${rulesetName} source-conversion projection in ${generatedFiles.length} files. ` +
      `Run with --audit for retained compatibility fields.\n`
  );
} else if (writeMode) {
  execFileSync(
    join(root, 'apps/server/node_modules/.bin/prettier'),
    ['--write', ...generatedFiles],
    {
      stdio: 'inherit',
    }
  );
}
