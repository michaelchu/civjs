import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { RulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import {
  EffectsRulesetFileSchema,
  GovernmentsRulesetFileSchema,
} from '@shared/data/rulesets/schemas';

describe('RulesetLoader validation', () => {
  const sourceDir = join(__dirname, '../../../../src/shared/data/rulesets/classic');
  let baseDir: string;
  let rulesetDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'civjs-ruleset-'));
    rulesetDir = join(baseDir, 'classic');
    cpSync(sourceDir, rulesetDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  const readRuleset = <T>(fileName: string): T =>
    JSON.parse(readFileSync(join(rulesetDir, fileName), 'utf8')) as T;

  const writeRuleset = (fileName: string, value: unknown): void => {
    writeFileSync(join(rulesetDir, fileName), JSON.stringify(value));
  };

  it.each([
    ['terrain.json', 'loadTerrainRuleset'],
    ['units.json', 'loadUnitsRuleset'],
    ['buildings.json', 'loadBuildingsRuleset'],
    ['techs.json', 'loadTechsRuleset'],
    ['governments.json', 'loadGovernmentsRuleset'],
    ['game.json', 'loadGameRulesRuleset'],
    ['effects.json', 'loadEffectsRuleset'],
    ['nations.json', 'loadNationsRuleset'],
    ['cities.json', 'loadCitiesRuleset'],
    ['actions.json', 'loadActionsRuleset'],
    ['extras.json', 'loadExtrasRuleset'],
    ['styles.json', 'loadStylesRuleset'],
  ] as const)('rejects malformed %s data', (fileName, loadMethod) => {
    writeRuleset(fileName, {});

    expect(() => new RulesetLoader(baseDir)[loadMethod]()).toThrow(`Failed to load`);
  });

  it('accepts all effect types shipped by the classic ruleset', () => {
    const effects = readRuleset<unknown>('effects.json');

    // @reference reference/freeciv/gen_headers/enums/effects_enums.def:5-120
    expect(EffectsRulesetFileSchema.safeParse(effects).success).toBe(true);
  });

  it('rejects unknown effect types', () => {
    const effects = readRuleset<{
      effects: Record<string, { type: string }>;
    }>('effects.json');
    effects.effects.unhappysize.type = 'Unknown_Effect';

    expect(EffectsRulesetFileSchema.safeParse(effects).success).toBe(false);
  });

  it('rejects government requirement types without a runtime evaluator', () => {
    const governments = readRuleset<{
      governments: {
        types: Record<string, { reqs?: Array<{ type: string }> }>;
      };
    }>('governments.json');
    governments.governments.types.monarchy.reqs![0].type = 'UnsupportedRequirement';

    // @reference reference/freeciv/common/requirements.c:6495-6535
    expect(GovernmentsRulesetFileSchema.safeParse(governments).success).toBe(false);
  });

  it('validates the shipped classic ruleset as one integrity unit', () => {
    // Freeciv rejects unresolved rule references while loading a ruleset.
    // @reference reference/freeciv/server/ruleset/ruleload.c:6275-6282
    expect(() => new RulesetLoader(baseDir).validateRuleset()).not.toThrow();
  });

  it('retains the complete generated classic action, extra, style, nation, and specialist catalogues', () => {
    const loader = new RulesetLoader(baseDir);
    const actions = loader.loadActionsRuleset();
    const cities = loader.loadCitiesRuleset();
    const extras = loader.loadExtrasRuleset();
    const nations = loader.loadNationsRuleset();
    const styles = loader.loadStylesRuleset();

    expect(actions.source).toBe('reference/freeciv/data/classic/actions.ruleset');
    expect(actions.enablers).toHaveLength(82);
    expect(Object.keys(extras.extras)).toHaveLength(34);
    expect(Object.keys(extras.resources)).toHaveLength(20);
    expect(Object.keys(styles.nation_styles)).toHaveLength(6);
    expect(Object.keys(styles.city_styles)).toHaveLength(10);
    expect(Object.keys(styles.music_styles)).toHaveLength(11);
    expect(Object.keys(nations.nations)).toHaveLength(571);
    expect(Object.keys(nations.nation_sets)).toHaveLength(2);
    expect(Object.keys(nations.nation_groups)).toHaveLength(11);
    expect(nations.nations.roman.leaders).toHaveLength(23);
    expect(Object.keys(cities.specialists)).toEqual(['elvis', 'scientist', 'taxman']);
  });

  it('rejects a unit technology reference that does not resolve', () => {
    const units = readRuleset<{
      units: Record<string, { required_tech?: string }>;
    }>('units.json');
    units.units.warriors.required_tech = 'missing_technology';
    writeRuleset('units.json', units);

    expect(() => new RulesetLoader(baseDir).validateRuleset()).toThrow(
      "Unit 'warriors' required technology 'missing_technology' does not exist"
    );
  });

  it('rejects a unit class reference that does not resolve', () => {
    const units = readRuleset<{
      units: Record<string, { unit_class: string }>;
    }>('units.json');
    units.units.warriors.unit_class = 'Nuclear';
    writeRuleset('units.json', units);

    expect(() => new RulesetLoader(baseDir).validateRuleset()).toThrow(
      "Unit 'warriors' unit class 'Nuclear' does not exist"
    );
  });

  it('rejects a building prerequisite that does not resolve', () => {
    const buildings = readRuleset<{
      buildings: Record<string, { requires?: string[] }>;
    }>('buildings.json');
    buildings.buildings.cathedral.requires = ['missing_building'];
    writeRuleset('buildings.json', buildings);

    expect(() => new RulesetLoader(baseDir).validateRuleset()).toThrow(
      "Building 'cathedral' prerequisite 'missing_building' does not exist"
    );
  });

  it('rejects an effect entity requirement that does not resolve', () => {
    const effects = readRuleset<{
      effects: Record<string, { reqs?: Array<{ type: string; name: string }> }>;
    }>('effects.json');
    effects.effects.temple_content.reqs![0].name = 'missing_building';
    writeRuleset('effects.json', effects);

    expect(() => new RulesetLoader(baseDir).validateRuleset()).toThrow(
      "Effect 'temple_content' Building requirement 'missing_building' does not exist"
    );
  });

  it('matches cross-file references by normalized rule name', () => {
    const effects = readRuleset<{
      effects: Record<string, { reqs?: Array<{ type: string; name: string }> }>;
    }>('effects.json');
    effects.effects.city_walls_defense.reqs![0].name = 'city_walls';
    writeRuleset('effects.json', effects);

    expect(() => new RulesetLoader(baseDir).validateRuleset()).not.toThrow();
  });

  it('rejects an unresolved action-enabler entity requirement', () => {
    const actions = readRuleset<{
      enablers: Array<{
        id: string;
        actor_reqs: Array<{ type: string; name: string }>;
      }>;
    }>('actions.json');
    const railroad = actions.enablers.find(enabler => enabler.id === 'enabler_desert_oil')!;
    railroad.actor_reqs.find(requirement => requirement.type === 'Tech')!.name = 'Missing Tech';
    writeRuleset('actions.json', actions);

    expect(() => new RulesetLoader(baseDir).validateRuleset()).toThrow(
      "Action enabler 'enabler_desert_oil' actor Tech requirement 'Missing Tech' does not exist"
    );
  });

  it('rejects an unresolved style technology requirement', () => {
    const styles = readRuleset<{
      city_styles: Record<string, { reqs: Array<{ type: string; name: string }> }>;
    }>('styles.json');
    styles.city_styles.citystyle_industrial.reqs[0].name = 'Missing Tech';
    writeRuleset('styles.json', styles);

    expect(() => new RulesetLoader(baseDir).validateRuleset()).toThrow(
      "City style 'citystyle_industrial' tech requirement 'Missing Tech' does not exist"
    );
  });
});
