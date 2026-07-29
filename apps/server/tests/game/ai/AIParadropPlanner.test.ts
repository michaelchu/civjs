import { planParadropMissions, rankVirtualParadropProduction } from '@game/ai/AIParadropPlanner';
import type { TerrainType } from '@game/map/MapTypes';
import { makeAICity, makeAIUnit, makeTerrainTile } from '../../fixtures/aiFixtures';

const unit = (
  id: string,
  x: number,
  y: number,
  playerId = id.startsWith('enemy') ? 'enemy' : 'ai'
) =>
  makeAIUnit({
    id,
    playerId,
    unitTypeId: id.startsWith('enemy') ? 'tank' : 'paratroopers',
    x,
    y,
    movementLeft: 3,
    health: 100,
    veteranLevel: 0,
    experience: 0,
    fortified: false,
  });
const city = (id: string, playerId: string, x: number, y: number, size = 4) =>
  makeAICity({ id, name: id, playerId, x, y, size, population: size, buildings: [] });
const tile = (x: number, y: number, continentId = 1, terrain: TerrainType = 'grassland') =>
  makeTerrainTile(x, y, terrain, { continentId });
const types: Record<string, any> = {
  paratroopers: {
    id: 'paratroopers',
    unitClass: 'military',
    rulesetUnitClass: 'Land',
    rulesetUnitClassFlags: ['CanOccupyCity'],
    flags: ['Paratroopers'],
    attack: 6,
    defense: 4,
    combat: 6,
    hitpoints: 10,
    movement: 1,
    cost: 60,
    paratroopersRange: 6,
  },
  tank: {
    id: 'tank',
    unitClass: 'military',
    rulesetUnitClass: 'Land',
    rulesetUnitClassFlags: ['CanOccupyCity'],
    flags: [],
    attack: 10,
    defense: 5,
    combat: 10,
    hitpoints: 20,
    movement: 3,
    cost: 80,
    paratroopersRange: 0,
  },
};
const distance = (x1: number, y1: number, x2: number, y2: number) =>
  Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));

function context(overrides: Record<string, unknown> = {}) {
  const tiles = Array.from({ length: 8 }, (_, x) =>
    Array.from({ length: 4 }, (_, y) => tile(x, y, x < 4 ? 1 : 2))
  ).flat();
  return {
    paratroopers: [unit('para', 0, 0)],
    friendlyUnits: [unit('para', 0, 0)],
    hostileUnits: [],
    friendlyCities: [],
    hostileCities: [],
    tiles,
    getType: (id: string) => types[id],
    distance,
    canParadropTo: () => true,
    isKnown: () => true,
    isSeen: () => true,
    cityUrgency: () => 0,
    terrainDefense: () => 0,
    isStackProtected: () => false,
    canAttack: () => true,
    defenderRating: () => 10,
    winChance: () => 1,
    ...overrides,
  } as any;
}

describe('Freeciv AI paradrop planner', () => {
  it('reinforces the highest-urgency empty friendly city before attacking', () => {
    const threatened = city('threatened', 'ai', 3, 0, 5);
    const missions = planParadropMissions(
      context({
        friendlyCities: [threatened],
        hostileCities: [city('enemy-city', 'enemy', 2, 0, 9)],
        cityUrgency: (candidate: any) => (candidate.id === threatened.id ? 12 : 0),
      })
    );
    expect(missions[0]).toMatchObject({
      kind: 'reinforce',
      targetCity: { id: 'threatened' },
    });
  });

  it('captures the most valuable undefended enemy city and favors another continent', () => {
    const missions = planParadropMissions(
      context({
        hostileCities: [city('near', 'enemy', 2, 0, 5), city('overseas', 'enemy', 4, 0, 5)],
      })
    );
    expect(missions[0]).toMatchObject({ kind: 'capture', targetCity: { id: 'overseas' } });
  });

  it('chooses a legal empty tactical landing beside a profitable vulnerable stack', () => {
    const enemyOne = unit('enemy-one', 4, 1);
    const enemyTwo = unit('enemy-two', 4, 1);
    const missions = planParadropMissions(
      context({
        hostileUnits: [enemyOne, enemyTwo],
        terrainDefense: (candidate: any) => (candidate.x === 3 && candidate.y === 1 ? 100 : 0),
      })
    );
    expect(missions[0]).toMatchObject({
      kind: 'tactical',
      targetX: 3,
      targetY: 1,
      attackTarget: { id: 'enemy-one' },
    });
  });

  it('does not select tactical tiles hidden by the fog handicap', () => {
    const missions = planParadropMissions(
      context({
        hostileUnits: [unit('enemy-one', 4, 1)],
        fogHandicap: true,
        isSeen: () => false,
      })
    );
    expect(missions).toEqual([]);
  });

  it('holds a damaged paratrooper in a city to recover', () => {
    const para = { ...unit('para', 0, 0), health: 40 };
    const missions = planParadropMissions(
      context({
        paratroopers: [para],
        friendlyUnits: [para, unit('guard', 0, 0)],
        friendlyCities: [city('home', 'ai', 0, 0)],
      })
    );
    expect(missions[0]).toMatchObject({ kind: 'hold' });
  });

  it('keeps a sole city defender in place', () => {
    const missions = planParadropMissions(context({ friendlyCities: [city('home', 'ai', 0, 0)] }));
    expect(missions[0]).toMatchObject({ kind: 'hold' });
  });

  it('returns a paratrooper without a valid jump source to the nearest friendly city', () => {
    const missions = planParadropMissions(
      context({
        friendlyCities: [city('home', 'ai', 2, 0)],
        canParadropTo: () => false,
      })
    );
    expect(missions[0]).toMatchObject({ kind: 'return', targetCity: { id: 'home' } });
  });

  it('reserves a reinforcement city for only one paratrooper', () => {
    const first = unit('a-para', 0, 0);
    const second = unit('b-para', 0, 1);
    const threatened = city('threatened', 'ai', 3, 0);
    const missions = planParadropMissions(
      context({
        paratroopers: [first, second],
        friendlyUnits: [first, second],
        friendlyCities: [threatened],
        cityUrgency: () => 10,
      })
    );
    expect(missions.filter(mission => mission.kind === 'reinforce')).toHaveLength(1);
  });

  it('values buildable paratroopers for long intercontinental city coverage', () => {
    const tiles = [tile(0, 0, 1), tile(4, 0, 2), tile(4, 1, 2), tile(5, 0, 2)];
    const wants = rankVirtualParadropProduction({
      gameId: 'game',
      playerId: 'ai',
      city: city('home', 'ai', 0, 0),
      unitTypes: [types.paratroopers],
      units: [],
      cities: [city('home', 'ai', 0, 0), city('target', 'enemy', 4, 0, 6)],
      alliedPlayerIds: new Set(),
      tiles,
      canBuild: () => true,
      isKnown: () => true,
      distance,
    });
    expect(wants.get('paratroopers')).toBeGreaterThan(100);
  });

  it('discounts allied cities and counts foreign defenders when valuing production', () => {
    const tiles = [tile(0, 0, 1), tile(4, 0, 2), tile(4, 1, 2), tile(5, 0, 2)];
    const alliedCity = city('ally', 'ally', 4, 0, 6);
    const base = {
      gameId: 'game',
      playerId: 'ai',
      city: city('home', 'ai', 0, 0),
      unitTypes: [types.paratroopers],
      cities: [city('home', 'ai', 0, 0), alliedCity],
      tiles,
      canBuild: () => true,
      isKnown: () => true,
      distance,
    };
    const alliedWant = rankVirtualParadropProduction({
      ...base,
      units: [],
      alliedPlayerIds: new Set(['ally']),
    }).get('paratroopers')!;
    const foreignWant = rankVirtualParadropProduction({
      ...base,
      units: [],
      alliedPlayerIds: new Set(),
    }).get('paratroopers')!;
    const defendedWant = rankVirtualParadropProduction({
      ...base,
      units: [unit('enemy-one', 4, 0), unit('enemy-two', 4, 0), unit('enemy-three', 4, 0)],
      alliedPlayerIds: new Set(),
    }).get('paratroopers')!;
    expect(alliedWant).toBeLessThan(foreignWant);
    expect(defendedWant).toBeLessThan(foreignWant);
  });

  it('never uses an unclassified foreign city tile as a tactical landing zone', () => {
    const neutralTile = tile(3, 1);
    neutralTile.cityId = 'neutral-city';
    const missions = planParadropMissions(
      context({
        tiles: [tile(0, 0), neutralTile, tile(4, 1)],
        hostileUnits: [unit('enemy-one', 4, 1)],
        terrainDefense: (candidate: any) => (candidate.x === 3 ? 100 : 0),
      })
    );
    expect(missions).toEqual([]);
  });
});
