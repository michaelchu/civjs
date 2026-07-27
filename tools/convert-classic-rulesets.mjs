#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'reference/freeciv/data/classic');
const targetDir = join(root, 'apps/server/src/shared/data/rulesets/classic');

function stripComment(line) {
  let quoted = false;
  let result = '';
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index - 1] !== '\\') quoted = !quoted;
    if ((character === ';' || character === '#') && !quoted) break;
    result += character;
  }
  return result.trimEnd();
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

  const translated = value.match(/^_\("(?:\?[^:"]+:)?([^"]*)"\)$/);
  if (translated) return translated[1];
  const quoted = [...value.matchAll(/"([^"]*)"/g)].map(match => match[1]);
  if (quoted.length > 1 || (quoted.length === 1 && value.includes(','))) return quoted;
  if (quoted.length === 1) return quoted[0];

  if (/^(TRUE|FALSE)$/i.test(value)) return value.toUpperCase() === 'TRUE';
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function parseSecfile(fileName) {
  const lines = readFileSync(join(sourceDir, fileName), 'utf8').split(/\r?\n/).map(stripComment);
  const sections = {};
  let current;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
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
      if (/^\[[^\]]+\]$/.test(next) || /^[a-zA-Z0-9_.]+\s*=/.test(next)) break;
      index += 1;
      if (next) valueLines.push(next);
    }
    current[key] = parseValue(valueLines.join('\n'));
  }
  return sections;
}

function metadata(datafile, source) {
  return {
    source,
    datafile: {
      description: datafile.description,
      options: datafile.options,
      format_version: datafile.format_version,
    },
  };
}

function convertActions() {
  const sections = parseSecfile('actions.ruleset');
  return {
    ...metadata(sections.datafile, 'reference/freeciv/data/classic/actions.ruleset'),
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
    ...metadata(sections.datafile, 'reference/freeciv/data/classic/terrain.ruleset'),
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

function convertStyles() {
  const sections = parseSecfile('styles.ruleset');
  const select = prefix =>
    Object.fromEntries(Object.entries(sections).filter(([id]) => id.startsWith(prefix)));
  return {
    ...metadata(sections.datafile, 'reference/freeciv/data/classic/styles.ruleset'),
    nation_styles: select('style_'),
    city_styles: select('citystyle_'),
    music_styles: select('musicstyle_'),
  };
}

function asArray(value) {
  if (value === undefined || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function selectSections(sections, prefix) {
  return Object.fromEntries(
    Object.entries(sections)
      .filter(([id]) => id.startsWith(prefix))
      .map(([id, section]) => [id.slice(prefix.length), section])
  );
}

function convertGame() {
  const sections = parseSecfile('game.ruleset');
  const civstyle = sections.civstyle;
  const incite = sections.incite_cost;

  return {
    ...metadata(sections.datafile, 'reference/freeciv/data/classic/game.ruleset'),
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
      granary_food_ini: civstyle.granary_food_ini,
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
for (const [fileName, data] of [
  ['actions.json', convertActions()],
  ['extras.json', convertExtras()],
  ['game.json', convertGame()],
  ['styles.json', convertStyles()],
]) {
  const target = join(targetDir, fileName);
  writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
  generatedFiles.push(target);
}

execFileSync(join(root, 'apps/server/node_modules/.bin/prettier'), ['--write', ...generatedFiles], {
  stdio: 'inherit',
});
