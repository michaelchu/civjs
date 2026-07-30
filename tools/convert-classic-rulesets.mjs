#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = join(root, 'reference/freeciv/data');
const requestedRuleset = process.argv[2] ?? 'classic';

if (requestedRuleset === '--all' || requestedRuleset === '--list') {
  const rulesetNames = readdirSync(dataRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => existsSync(join(dataRoot, name, 'game.ruleset')))
    .sort();

  if (requestedRuleset === '--list') {
    process.stdout.write(`${rulesetNames.join('\n')}\n`);
    process.exit(0);
  }

  for (const name of rulesetNames) {
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), name], { stdio: 'inherit' });
  }
  process.exit(0);
}

const rulesetName = requestedRuleset;
const sourceDir = join(root, 'reference/freeciv/data', rulesetName);
const targetDir = join(root, 'apps/server/src/shared/data/rulesets', rulesetName);
const classicTargetDir = join(root, 'apps/server/src/shared/data/rulesets/classic');

if (!/^[a-z0-9][a-z0-9_-]*$/i.test(rulesetName)) {
  throw new Error(`Invalid ruleset name: ${rulesetName}`);
}

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
        Object.assign(sections, parseSecfilePath(includePath, seen, true));
      }
      continue;
    }
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      current = {};
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
      name: 'Freeciv Classic Terrain Ruleset',
      summary: asText(sections.datafile.description),
    },
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
  return JSON.parse(readFileSync(join(classicTargetDir, fileName), 'utf8'));
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
  const legacy = loadTargetJson('buildings.json');
  const legacyByName = new Map(
    Object.values(legacy.buildings).map(building => [normalizeId(building.name), building])
  );
  const techNameToId = buildNameToId(techSections, 'advance_');
  const buildingNameToId = buildNameToId(sections, 'building_');
  const buildings = Object.fromEntries(
    Object.entries(sections)
      .filter(([id]) => id.startsWith('building_'))
      .map(([sectionId, building]) => {
        const id = sectionId.slice('building_'.length);
        const legacyBuilding = legacyByName.get(normalizeId(building.name));
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
            playable: legacyBuilding?.playable ?? true,
            effects: legacyBuilding?.effects ?? {},
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
  const legacy = loadTargetJson('techs.json');
  const techNameToId = buildNameToId(sections, 'advance_');
  const techs = Object.fromEntries(
    Object.entries(sections)
      .filter(([id]) => id.startsWith('advance_'))
      .map(([sectionId, tech], index) => {
        const id = sectionId.slice('advance_'.length);
        const legacyTech = legacy.techs[id];
        const requirements = [tech.req1, tech.req2]
          .map(requirement => resolveNamedId(requirement, techNameToId))
          .filter(Boolean);
        return [
          id,
          {
            ...tech,
            id,
            freeciv_id: legacyTech?.freeciv_id ?? index + 1,
            name: tech.name,
            internal_name: tech.rule_name ?? tech.name,
            cost: tech.cost ?? legacyTech?.cost ?? 1,
            requirements,
            root_req: resolveNamedId(tech.root_req, techNameToId) ?? null,
            flags: asArray(tech.flags).filter(Boolean),
            ...(legacyTech?.position ? { position: legacyTech.position } : {}),
            order: legacyTech?.order ?? index + 1,
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
  const defaultTraits = main.default_traits;
  const nations = Object.fromEntries(
    Object.entries(sections)
      .filter(([id]) => id.startsWith('nation_'))
      .map(([sectionId, nation]) => {
        const id = sectionId.slice('nation_'.length);
        const groups = asArray(nation.groups);
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
            init_government: nation.init_government ?? main.compatibility.default_government,
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
    compatibility: main.compatibility,
    default_traits: defaultTraits,
    nation_sets: Object.fromEntries(
      Object.entries(sections).filter(([id]) => id.startsWith('nset_'))
    ),
    nation_groups: Object.fromEntries(
      Object.entries(sections).filter(([id]) => id.startsWith('ngroup_'))
    ),
    nations,
  };
}

function convertCities() {
  const sections = parseSecfile('cities.ruleset');
  const legacy = loadTargetJson('cities.json');
  return {
    ...metadata(sections.datafile, referenceSource('cities.ruleset')),
    about: {
      name: `Freeciv ${rulesetName} Cities Ruleset`,
      summary: asText(sections.datafile.description),
    },
    specialists: selectSections(sections, 'specialist_'),
    parameters: sections.parameters,
    citizen: sections.citizen,
    city_styles: legacy.city_styles,
    founding_rules: legacy.founding_rules,
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
mkdirSync(targetDir, { recursive: true });
for (const [fileName, data] of [
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
]) {
  const target = join(targetDir, fileName);
  writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
  generatedFiles.push(target);
}

execFileSync(join(root, 'apps/server/node_modules/.bin/prettier'), ['--write', ...generatedFiles], {
  stdio: 'inherit',
});
