import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { headlessSimulationConfigSchema } from '@game/simulation/config/SimulationTypes';

const fixturesDirectory = resolve(__dirname, '../../../../../docs/simulation-scenarios');
const expectedFixtureNames = [
  'earth-small-bootstrap.json',
  'earth-small-city-founding.json',
  'earth-small-combat.json',
  'earth-small-research.json',
  'earth-small-trade-luxury.json',
  'earth-small-victory.json',
  'earth-small-war-declaration.json',
  'earth-small-war.json',
];

describe('headless simulation scenario fixtures', () => {
  it('keeps the documented fixture set complete', () => {
    const fixtureNames = readdirSync(fixturesDirectory)
      .filter(name => name.endsWith('.json'))
      .sort();

    expect(fixtureNames).toEqual(expectedFixtureNames);
  });

  it.each(expectedFixtureNames)('validates %s against the runtime schema', fixtureName => {
    const fixture = JSON.parse(
      readFileSync(join(fixturesDirectory, fixtureName), 'utf8')
    ) as unknown;
    const config = headlessSimulationConfigSchema.parse(fixture);

    expect(config.terrainSettings.generator).toBe('scenario');
    expect(config.terrainSettings.scenarioId).toBeTruthy();
    expect(config.scenarioSetup).toBeDefined();
    expect(config.maxTurns).toBeGreaterThan(config.scenarioSetup?.initialTurn ?? 0);
  });

  it('uses unique deterministic seeds for each fixture', () => {
    const configs = expectedFixtureNames.map(fixtureName =>
      headlessSimulationConfigSchema.parse(
        JSON.parse(readFileSync(join(fixturesDirectory, fixtureName), 'utf8')) as unknown
      )
    );
    const randomSeeds = configs.map(config => config.randomSeed);
    const mapSeeds = configs.map(config => config.mapSeed);

    expect(new Set(randomSeeds).size).toBe(randomSeeds.length);
    expect(new Set(mapSeeds).size).toBe(mapSeeds.length);
  });
});
