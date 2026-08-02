/**
 * @module server/game/services/RulesetInitialSetupService
 * Resolves the ruleset-owned initial technologies and role-based starting
 * units used when a new Freeciv game begins.
 */

import type { IntegerRandomSource } from '@game/random/FreecivRandom';
import type { UnitType } from '@game/services/RulesetUnitsService';
import { rulesetLoader, type RulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { TechnologyRuleset } from '@shared/data/rulesets/schemas';

const DEFAULT_START_UNITS = 'ccwwx';
const DEFAULT_TECH_LEVEL = 0;

type RulesetSetting = { name?: unknown; value?: unknown };

export const START_UNIT_ROLE_BY_CHARACTER = {
  c: 'CitiesStartUnit',
  w: 'WorkerStartUnit',
  x: 'ExplorerStartUnit',
  k: 'KingStartUnit',
  s: 'DiplomatStartUnit',
  f: 'FerryStartUnit',
  d: 'DefendOkStartUnit',
  D: 'DefendGoodStartUnit',
  a: 'AttackFastStartUnit',
  A: 'AttackStrongStartUnit',
} as const;

type StartUnitCharacter = keyof typeof START_UNIT_ROLE_BY_CHARACTER;
type StartUnitRole = (typeof START_UNIT_ROLE_BY_CHARACTER)[StartUnitCharacter];

export interface InitialRulesetSettings {
  startUnits: string;
  techLevel: number;
}

export interface StartingUnitResolutionOptions {
  playerTechs: ReadonlySet<string>;
  existingUnitTypeIds?: Iterable<string>;
}

type InitialSetupRulesetLoader = Pick<
  RulesetLoader,
  'getGlobalInitTechnologies' | 'getNations' | 'getTechs' | 'loadGameRulesRuleset'
>;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getRulesetSetting(
  loader: InitialSetupRulesetLoader,
  rulesetName: string,
  settingName: string
): unknown {
  const settings = loader.loadGameRulesRuleset(rulesetName).settings.set;
  if (!Array.isArray(settings)) return undefined;
  return (settings as RulesetSetting[]).find(setting => setting?.name === settingName)?.value;
}

function resolveTechnologyId(
  technologies: Record<string, TechnologyRuleset>,
  idOrName: string
): string {
  const normalized = normalize(idOrName);
  const match = Object.entries(technologies).find(
    ([id, technology]) =>
      normalize(id) === normalized ||
      normalize(technology.id) === normalized ||
      normalize(technology.name) === normalized ||
      normalize(technology.internal_name ?? '') === normalized
  );
  if (!match) throw new Error(`Unknown initial technology '${idOrName}'`);
  return match[1].id;
}

function orderedTechnologies(technologies: Record<string, TechnologyRuleset>): TechnologyRuleset[] {
  return Object.values(technologies)
    .map((technology, index) => ({ technology, index }))
    .sort(
      (left, right) =>
        (left.technology.freeciv_id ?? Number.MAX_SAFE_INTEGER) -
          (right.technology.freeciv_id ?? Number.MAX_SAFE_INTEGER) || left.index - right.index
    )
    .map(({ technology }) => technology);
}

function hasKnownTechnology(playerTechs: ReadonlySet<string>, idOrName: string): boolean {
  const expected = normalize(idOrName);
  return [...playerTechs].some(technology => normalize(technology) === expected);
}

function initialTechnologyPrerequisitesKnown(
  technology: TechnologyRuleset,
  playerTechs: ReadonlySet<string>
): boolean {
  const requirements = [
    ...technology.requirements,
    ...(technology.root_req ? [technology.root_req] : []),
  ];
  return requirements.every(requirement => hasKnownTechnology(playerTechs, requirement));
}

function hasFlag(unit: UnitType, flag: string): boolean {
  const expected = normalize(flag);
  return unit.flags?.some(candidate => normalize(candidate) === expected) ?? false;
}

function unitTechnologyRequirementsMet(unit: UnitType, playerTechs: ReadonlySet<string>): boolean {
  if (unit.requiredTech && !hasKnownTechnology(playerTechs, unit.requiredTech)) return false;

  return (unit.buildRequirements ?? []).every(requirement => {
    if (normalize(requirement.type) !== 'tech') return true;
    const known = hasKnownTechnology(playerTechs, requirement.name);
    return (requirement.present ?? true) ? known : !known;
  });
}

function isDirectlyBuildableStartingUnit(
  unit: UnitType,
  playerTechs: ReadonlySet<string>,
  existingUnitTypeIds: ReadonlySet<string>
): boolean {
  if (hasFlag(unit, 'NoBuild') || hasFlag(unit, 'BarbarianOnly')) return false;
  if (hasFlag(unit, 'Unique') && existingUnitTypeIds.has(unit.id)) return false;
  return unitTechnologyRequirementsMet(unit, playerTechs);
}

function canBuildStartingUnitNow(
  unit: UnitType,
  unitTypes: Record<string, UnitType>,
  playerTechs: ReadonlySet<string>,
  existingUnitTypeIds: ReadonlySet<string>
): boolean {
  if (!isDirectlyBuildableStartingUnit(unit, playerTechs, existingUnitTypeIds)) return false;

  const visited = new Set<string>([unit.id]);
  let replacementId = unit.obsolete_by;
  while (replacementId && !visited.has(replacementId)) {
    visited.add(replacementId);
    const replacement = unitTypes[replacementId];
    if (!replacement) break;
    if (isDirectlyBuildableStartingUnit(replacement, playerTechs, existingUnitTypeIds))
      return false;
    replacementId = replacement.obsolete_by;
  }

  return true;
}

/**
 * Read the Freeciv game-init settings represented in the converted ruleset.
 *
 * @reference reference/freeciv/common/game.h:387-396
 * @reference reference/freeciv/server/settings.c:2027-2091
 */
export function getInitialRulesetSettings(
  rulesetName: string,
  loader: InitialSetupRulesetLoader = rulesetLoader
): InitialRulesetSettings {
  const configuredStartUnits = getRulesetSetting(loader, rulesetName, 'startunits');
  const configuredTechLevel = getRulesetSetting(loader, rulesetName, 'techlevel');
  return {
    startUnits:
      typeof configuredStartUnits === 'string' && configuredStartUnits.length > 0
        ? configuredStartUnits
        : DEFAULT_START_UNITS,
    techLevel:
      typeof configuredTechLevel === 'number' && Number.isFinite(configuredTechLevel)
        ? Math.max(0, Math.trunc(configuredTechLevel))
        : DEFAULT_TECH_LEVEL,
  };
}

/**
 * Select one currently researchable technology using Freeciv's reservoir
 * sampling loop. The explicit `freeciv_id` sort preserves the source
 * advance-index order rather than relying on JSON property order.
 *
 * @reference reference/freeciv/server/techtools.c:939-958
 * @reference reference/freeciv/common/tech.h:242-258
 */
export function selectRandomInitialTechnology(
  technologies: Record<string, TechnologyRuleset>,
  playerTechs: ReadonlySet<string>,
  random: IntegerRandomSource
): string | undefined {
  let selected: string | undefined;
  let candidateCount = 0;

  for (const technology of orderedTechnologies(technologies)) {
    if (
      playerTechs.has(technology.id) ||
      !initialTechnologyPrerequisitesKnown(technology, playerTechs)
    ) {
      continue;
    }
    candidateCount += 1;
    if (random.next(candidateCount) === 0) selected = technology.id;
  }

  return selected;
}

/**
 * Resolve the source ruleset's global/nation initial technologies followed by
 * its `techlevel` random grants for one player.
 *
 * @reference reference/freeciv/server/techtools.c:1188-1225
 */
export function resolveInitialTechnologyIds(
  rulesetName: string,
  nationId: string | undefined,
  random: IntegerRandomSource,
  loader: InitialSetupRulesetLoader = rulesetLoader
): string[] {
  const technologies = loader.getTechs(rulesetName);
  const granted = new Set<string>();
  const grant = (idOrName: string): void => {
    granted.add(resolveTechnologyId(technologies, idOrName));
  };

  loader.getGlobalInitTechnologies(rulesetName).forEach(grant);
  const nation = nationId ? loader.getNations(rulesetName)[nationId] : undefined;
  nation?.init_techs?.forEach(grant);

  const { techLevel } = getInitialRulesetSettings(rulesetName, loader);
  for (let index = 0; index < techLevel; index += 1) {
    const selected = selectRandomInitialTechnology(technologies, granted, random);
    if (!selected) break;
    granted.add(selected);
  }

  return [...granted];
}

/**
 * Resolve each start-unit role to the first type the player can currently
 * build. As in `crole_to_unit_type`, a role with no buildable candidate falls
 * back to the first non-duplicate non-unique role unit, allowing rulesets to
 * grant a starting specialist before its build technology is known.
 *
 * @reference reference/freeciv/server/gamehand.c:75-145
 * @reference reference/freeciv/common/unittype.c:1951-1962
 * @reference reference/freeciv/common/unittype.c:2100-2118
 * @reference reference/freeciv/common/unittype.c:2348-2369
 */
export function resolveStartingUnitTypeIds(
  startUnits: string,
  unitTypes: Record<string, UnitType>,
  options: StartingUnitResolutionOptions
): string[] {
  const selected: string[] = [];
  const existingUnitTypeIds = new Set(options.existingUnitTypeIds ?? []);

  for (const character of startUnits) {
    const role = START_UNIT_ROLE_BY_CHARACTER[character as StartUnitCharacter] as
      StartUnitRole | undefined;
    if (!role) throw new Error(`Unsupported Freeciv start-unit character '${character}'`);

    const candidates = Object.values(unitTypes).filter(unit => unit.roles?.includes(role));
    const selectedUnit =
      candidates.find(unit =>
        canBuildStartingUnitNow(unit, unitTypes, options.playerTechs, existingUnitTypeIds)
      ) ?? candidates.find(unit => !hasFlag(unit, 'Unique') || !existingUnitTypeIds.has(unit.id));

    if (!selectedUnit) continue;
    selected.push(selectedUnit.id);
    existingUnitTypeIds.add(selectedUnit.id);
  }

  return selected;
}
