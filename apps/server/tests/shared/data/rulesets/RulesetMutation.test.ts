/**
 * Isolated mutation evidence for Milestone 2 ruleset authority.
 *
 * @reference reference/freeciv/data/classic/effects.ruleset
 * @reference reference/freeciv/data/classic/units.ruleset
 * @reference reference/freeciv/data/classic/buildings.ruleset
 * @reference reference/freeciv/data/classic/techs.ruleset
 * @reference reference/freeciv/data/classic/terrain.ruleset
 * @reference reference/freeciv/data/classic/game.ruleset
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EffectsManager, EffectType, OutputType } from '@game/managers/EffectsManager';
import { loadRulesetTechnologies } from '@game/managers/ResearchManager';
import { MovementType, getTerrainMovementCost } from '@game/constants/MovementConstants';
import { CityDataService } from '@game/services/CityDataService';
import { RulesetBuildingsService } from '@game/services/RulesetBuildingsService';
import { RulesetUnitsService } from '@game/services/RulesetUnitsService';
import type { CityState } from '@game/managers/CityManager';
import { RulesetLoader } from '@shared/data/rulesets/RulesetLoader';

type JsonObject = Record<string, unknown>;

let fixtureRoot: string;
let classicRoot: string;

function mutate(fileName: string, update: (document: JsonObject) => void): void {
  const path = join(classicRoot, fileName);
  const document = JSON.parse(readFileSync(path, 'utf8')) as JsonObject;
  update(document);
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}

function city(overrides: Partial<CityState> = {}): CityState {
  return {
    id: 'mutation-city',
    name: 'Mutation City',
    x: 1,
    y: 1,
    playerId: 'player-1',
    population: 2,
    size: 2,
    cityRadius: 2,
    founded: 1,
    currentProduction: null,
    productionType: null,
    turnsToComplete: 0,
    productionStock: 0,
    foodStock: 0,
    foodPerTurn: 6,
    productionPerTurn: 1,
    tradePerTurn: 0,
    sciencePerTurn: 0,
    history: 0,
    buildings: [],
    specialists: {} as CityState['specialists'],
    tradeRoutes: [],
    happiness: { happy: 0, content: 2, unhappy: 0, angry: 0 },
    worklist: [],
    defenseStrength: 1,
    ...overrides,
  };
}

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'civjs-ruleset-mutation-'));
  classicRoot = join(fixtureRoot, 'classic');
  cpSync(join(process.cwd(), 'src/shared/data/rulesets/classic'), classicRoot, {
    recursive: true,
  });
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('isolated ruleset mutations', () => {
  it('changes specialist output through the injected effects calculation', () => {
    mutate('effects.json', document => {
      const effects = document.effects as Record<string, { value: number }>;
      effects.scientist_research.value = 7;
    });
    const effects = new EffectsManager('classic', new RulesetLoader(fixtureRoot));

    expect(
      effects.calculateEffect(EffectType.SPECIALIST_OUTPUT, {
        specialist: 'scientist',
        outputType: OutputType.SCIENCE,
      }).value
    ).toBe(7);
  });

  it('changes the authoritative mapped unit definition', () => {
    mutate('units.json', document => {
      const units = document.units as Record<string, { attack: number }>;
      units.warriors.attack = 4;
    });
    const units = new RulesetUnitsService(new RulesetLoader(fixtureRoot));

    expect(units.getUnitType('warriors')?.attack).toBe(4);
  });

  it('changes building upkeep through the building service', () => {
    mutate('buildings.json', document => {
      const buildings = document.buildings as Record<string, { upkeep: number }>;
      buildings.granary.upkeep = 6;
    });
    const buildings = new RulesetBuildingsService(new RulesetLoader(fixtureRoot));

    expect(buildings.getBuildingTypes().granary.upkeep).toBe(6);
  });

  it('changes research cost through the ruleset-backed catalogue', () => {
    mutate('techs.json', document => {
      const technologies = document.techs as Record<string, { cost: number }>;
      technologies.pottery.cost = 37;
    });

    expect(loadRulesetTechnologies(new RulesetLoader(fixtureRoot)).pottery.cost).toBe(37);
  });

  it('changes terrain movement through the loaded terrain definition', () => {
    mutate('terrain.json', document => {
      const terrains = document.terrains as Record<string, { moveCost: number }>;
      terrains.grassland.moveCost = 4;
    });
    const loader = new RulesetLoader(fixtureRoot);
    const units = new RulesetUnitsService(loader);

    expect(
      getTerrainMovementCost('grassland', 'warriors', {
        getTerrainMoveCost: terrain =>
          (loader.getTerrains() as Record<string, { moveCost: number }>)[terrain]?.moveCost,
        getUnitMovementType: unitId => units.getMovementType(unitId) as MovementType | undefined,
      })
    ).toBe(12);
  });

  it('changes city food consumption through the loaded game parameter', () => {
    mutate('game.json', document => {
      const civstyle = document.civstyle as { food_cost: number };
      civstyle.food_cost = 3;
    });
    const loader = new RulesetLoader(fixtureRoot);
    const buildings = new RulesetBuildingsService(loader);

    const result = CityDataService.transformCityForClient(city({ foodPerTurn: 0 }), 'classic', {
      loader,
      buildings,
    });

    expect(result.prod.food).toBe(6);
    expect(result.surplus.food).toBe(0);
  });
});
