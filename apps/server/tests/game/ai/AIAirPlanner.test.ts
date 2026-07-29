import { planAirMissions, rankVirtualAirProduction } from '@game/ai/AIAirPlanner';
import { makeAICity, makeAIUnit } from '../../fixtures/aiFixtures';

const unit = (id: string, unitTypeId: string, x: number, y: number, fuel?: number) =>
  makeAIUnit({
    id,
    playerId: id.startsWith('enemy') ? 'enemy' : 'ai',
    unitTypeId,
    x,
    y,
    fuel,
    movementLeft: 24,
    health: 100,
    veteranLevel: 0,
    experience: 0,
    fortified: false,
  });
const city = (id: string, playerId: string, x: number, y: number, size = 4) =>
  makeAICity({ id, name: id, playerId, x, y, size, population: size, buildings: [] });
const types: Record<string, any> = {
  bomber: {
    unitClass: 'air',
    attack: 12,
    combat: 12,
    firepower: 2,
    hitpoints: 20,
    movement: 8,
    range: 8,
    fuel: 2,
    cost: 80,
    paratroopersRange: 0,
    rulesetUnitClass: 'Air',
    rulesetUnitClassFlags: [],
  },
  paratrooper: {
    unitClass: 'military',
    attack: 6,
    movement: 1,
    range: 1,
    cost: 60,
    paratroopersRange: 5,
  },
  tank: {
    unitClass: 'military',
    attack: 10,
    combat: 10,
    firepower: 1,
    hitpoints: 20,
    movement: 3,
    range: 1,
    cost: 80,
    paratroopersRange: 0,
    rulesetUnitClass: 'Land',
    rulesetUnitClassFlags: ['CanOccupyCity'],
  },
  fighter: {
    unitClass: 'air',
    attack: 4,
    defense: 3,
    combat: 4,
    firepower: 1,
    hitpoints: 20,
    movement: 10,
    range: 10,
    fuel: 1,
    cost: 60,
    paratroopersRange: 0,
    rulesetUnitClass: 'Air',
    rulesetUnitClassFlags: [],
  },
};
const distance = (x1: number, y1: number, x2: number, y2: number) =>
  Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));

describe('Freeciv AI air planner', () => {
  it('returns a low-fuel aircraft to the nearest friendly city', () => {
    const missions = planAirMissions({
      friendlyUnits: [unit('plane', 'bomber', 3, 0, 1)],
      hostileUnits: [unit('enemy-tank', 'tank', 4, 0)],
      friendlyCities: [city('base', 'ai', 2, 0)],
      hostileCities: [],
      getType: id => types[id],
      distance,
    });
    expect(missions[0]).toMatchObject({ kind: 'return', targetX: 2, targetY: 0 });
  });

  it('strikes a profitable visible target when fuel is safe', () => {
    const missions = planAirMissions({
      friendlyUnits: [unit('plane', 'bomber', 0, 0, 2)],
      hostileUnits: [unit('enemy-tank', 'tank', 3, 0)],
      friendlyCities: [city('base', 'ai', 0, 0)],
      hostileCities: [],
      getType: id => types[id],
      distance,
    });
    expect(missions[0]).toMatchObject({ kind: 'strike', target: { id: 'enemy-tank' } });
  });

  it('waits at a refuel point until the aircraft has full fuel', () => {
    const missions = planAirMissions({
      friendlyUnits: [unit('plane', 'bomber', 0, 0, 1)],
      hostileUnits: [unit('enemy-tank', 'tank', 1, 0)],
      friendlyCities: [city('base', 'ai', 0, 0)],
      hostileCities: [],
      getType: id => types[id],
      distance,
    });
    expect(missions[0]).toMatchObject({ kind: 'hold', base: { id: 'base' } });
  });

  it('returns an aircraft in the open even when it still has full fuel', () => {
    const missions = planAirMissions({
      friendlyUnits: [unit('plane', 'bomber', 3, 0, 2)],
      hostileUnits: [unit('enemy-tank', 'tank', 4, 0)],
      friendlyCities: [city('base', 'ai', 2, 0)],
      hostileCities: [],
      getType: id => types[id],
      distance,
    });
    expect(missions[0]).toMatchObject({ kind: 'return', base: { id: 'base' } });
  });

  it('uses compatible carriers as mobile refuel points', () => {
    const plane = unit('plane', 'bomber', 3, 0, 1);
    const carrier = unit('carrier', 'carrier', 2, 0);
    const missions = planAirMissions({
      friendlyUnits: [plane, carrier],
      hostileUnits: [],
      friendlyCities: [],
      hostileCities: [],
      refuelPoints: [
        {
          id: carrier.id,
          kind: 'carrier',
          x: carrier.x,
          y: carrier.y,
          carrier,
          cargoClasses: ['Air'],
          remainingCapacity: 1,
        },
      ],
      getType: id => (id === 'carrier' ? ({ unitClass: 'naval' } as any) : types[id]),
      distance,
    });
    expect(missions[0]).toMatchObject({
      kind: 'return',
      base: { id: 'carrier', kind: 'carrier' },
    });
  });

  it('recognizes a loaded carrier aircraft as fueled and sortie-ready', () => {
    const plane = { ...unit('plane', 'bomber', 0, 0, 2), transportedBy: 'carrier' };
    const carrier = unit('carrier', 'carrier', 0, 0);
    const missions = planAirMissions({
      friendlyUnits: [plane],
      hostileUnits: [unit('enemy-tank', 'tank', 2, 0)],
      friendlyCities: [],
      hostileCities: [],
      refuelPoints: [
        {
          id: carrier.id,
          kind: 'carrier',
          x: 0,
          y: 0,
          carrier,
          cargoClasses: ['Air'],
          remainingCapacity: 0,
        },
      ],
      getType: id => types[id],
      distance,
    });
    expect(missions[0]).toMatchObject({ kind: 'strike', target: { id: 'enemy-tank' } });
  });

  it('rebases toward a profitable target that cannot be reached from the current base', () => {
    const missions = planAirMissions({
      friendlyUnits: [unit('plane', 'bomber', 0, 0, 2)],
      hostileUnits: [unit('enemy-tank', 'tank', 10, 0)],
      friendlyCities: [],
      hostileCities: [],
      refuelPoints: [
        { id: 'home', kind: 'airbase', x: 0, y: 0 },
        { id: 'forward', kind: 'airbase', x: 5, y: 0 },
      ],
      getType: id => types[id],
      distance,
    });
    expect(missions[0]).toMatchObject({ kind: 'rebase', base: { id: 'forward' } });
  });

  it('rebases to reinforce a city in grave danger before seeking targets', () => {
    const missions = planAirMissions({
      friendlyUnits: [unit('plane', 'bomber', 0, 0, 2)],
      hostileUnits: [],
      friendlyCities: [],
      hostileCities: [],
      refuelPoints: [
        {
          id: 'home',
          kind: 'city',
          x: 0,
          y: 0,
          city: city('home', 'ai', 0, 0),
          graveDanger: 0,
          defenderCount: 1,
        },
        {
          id: 'danger',
          kind: 'city',
          x: 4,
          y: 0,
          city: city('danger', 'ai', 4, 0),
          graveDanger: 3,
          defenderCount: 1,
        },
      ],
      getType: id => types[id],
      distance,
    });
    expect(missions[0]).toMatchObject({ kind: 'rebase', base: { id: 'danger' } });
  });

  it('uses authoritative defender ratings to account for air interception defenses', () => {
    const fighter = unit('enemy-fighter', 'fighter', 2, 0);
    const tank = unit('enemy-tank', 'tank', 3, 0);
    const missions = planAirMissions({
      friendlyUnits: [unit('plane', 'bomber', 0, 0, 2)],
      hostileUnits: [fighter, tank],
      friendlyCities: [city('base', 'ai', 0, 0)],
      hostileCities: [],
      getType: id => types[id],
      distance,
      attackerRating: () => 100,
      defenderRating: (_attacker, defender) => (defender.id === fighter.id ? 10_000 : 10),
    });
    expect(missions[0]).toMatchObject({ kind: 'strike', target: { id: 'enemy-tank' } });
  });

  it('does not bomb an occupied city without invasion occupier support', () => {
    const targetCity = city('target', 'enemy', 2, 0);
    const missions = planAirMissions({
      friendlyUnits: [unit('plane', 'bomber', 0, 0, 2)],
      hostileUnits: [unit('enemy-tank', 'tank', 2, 0)],
      friendlyCities: [city('base', 'ai', 0, 0)],
      hostileCities: [targetCity],
      getType: id => types[id],
      distance,
      hasOccupierSupport: () => false,
    });
    expect(missions).toEqual([]);
  });

  it('feeds profitable virtual aircraft into city production wants', () => {
    const wants = rankVirtualAirProduction({
      gameId: 'game',
      playerId: 'ai',
      city: city('base', 'ai', 0, 0),
      unitTypes: Object.entries(types).map(([id, type]) => ({ id, ...type })),
      hostileUnits: [unit('enemy-tank', 'tank', 3, 0)],
      hostileCities: [],
      canBuild: id => id === 'bomber',
      getType: id => types[id],
      distance,
    });
    expect(wants.get('bomber')).toBeGreaterThan(0);
    expect(wants.has('fighter')).toBe(false);
  });

  it('does not request aircraft production under the no-planes handicap', () => {
    const wants = rankVirtualAirProduction({
      gameId: 'game',
      playerId: 'ai',
      city: city('base', 'ai', 0, 0),
      unitTypes: [{ id: 'bomber', ...types.bomber }],
      hostileUnits: [unit('enemy-tank', 'tank', 3, 0)],
      hostileCities: [],
      canBuild: () => true,
      getType: id => types[id],
      distance,
      planesHandicap: true,
    });
    expect(wants.size).toBe(0);
  });
});
