import {
  planHunterMissileLaunches,
  planHunters,
  rankHunterProduction,
} from '@game/ai/AIHunterPlanner';
import { makeAIUnit } from '../../fixtures/aiFixtures';

const unit = (id: string, unitTypeId: string, x: number, y: number, playerId = 'ai') =>
  makeAIUnit({ id, unitTypeId, x, y, playerId });

const types: Record<string, any> = {
  hunter: { id: 'hunter', roles: ['Hunter'], attack: 8, combat: 8, movement: 3, cost: 50 },
  transport: {
    id: 'transport',
    attack: 0,
    combat: 0,
    movement: 2,
    cost: 40,
    transport_capacity: 4,
  },
  attacker: { id: 'attacker', attack: 6, combat: 6, movement: 2, cost: 40, firepower: 1 },
  scout: { id: 'scout', attack: 0, combat: 0, movement: 3, cost: 10 },
};

describe('Freeciv AI hunter planner', () => {
  it('pursues a valuable hostile stack and ignores harmless scouts', () => {
    const plan = planHunters({
      turn: 9,
      friendlyUnits: [unit('h', 'hunter', 0, 0)],
      hostileUnits: [
        unit('transport', 'transport', 3, 0, 'enemy'),
        unit('escort', 'attacker', 3, 0, 'enemy'),
        unit('scout', 'scout', 1, 0, 'enemy'),
      ],
      existingTasks: {},
      getType: id => types[id],
      distance: (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
    });

    expect(plan.assignments.h).toMatchObject({
      role: 'hunter',
      targetX: 3,
      assignedTurn: 9,
    });
    expect(plan.targets.h.map(target => target.unit.id)).not.toContain('scout');
  });

  it('retains an equally valuable prior target across turns', () => {
    const plan = planHunters({
      turn: 10,
      friendlyUnits: [unit('h', 'hunter', 0, 0)],
      hostileUnits: [unit('a', 'attacker', 2, 0, 'enemy'), unit('b', 'attacker', 2, 0, 'enemy')],
      existingTasks: {
        h: { role: 'hunter', targetId: 'b', targetX: 2, targetY: 0, assignedTurn: 4 },
      },
      getType: id => types[id],
      distance: (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
    });

    expect(plan.assignments.h.targetId).toBe('b');
    expect(plan.assignments.h.assignedTurn).toBe(4);
  });

  it('does not send a slower new hunter after a faster target', () => {
    types.fast = { ...types.attacker, id: 'fast', movement: 5 };
    const plan = planHunters({
      turn: 1,
      friendlyUnits: [unit('h', 'hunter', 0, 0)],
      hostileUnits: [unit('fast', 'fast', 2, 0, 'enemy')],
      existingTasks: {},
      getType: id => types[id],
      distance: (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
    });

    expect(plan.assignments.h).toBeUndefined();
  });

  it('keeps chasing a faster target that moved onto an intercept vector', () => {
    types.fast = { ...types.attacker, id: 'fast', movement: 5, cost: 80 };
    const plan = planHunters({
      turn: 2,
      friendlyUnits: [unit('h', 'hunter', 0, 0)],
      hostileUnits: [unit('fast', 'fast', 2, 0, 'enemy')],
      existingTasks: {
        h: { role: 'hunter', targetId: 'fast', targetX: 3, targetY: 0, assignedTurn: 1 },
      },
      getType: id => types[id],
      distance: (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
    });

    expect(plan.assignments.h).toMatchObject({ targetId: 'fast', assignedTurn: 1 });
  });

  it('turns a virtual hunter target into a city production want', () => {
    types.richTarget = { ...types.attacker, id: 'richTarget', cost: 100 };
    const wants = rankHunterProduction({
      gameId: 'game',
      playerId: 'ai',
      city: { id: 'city', x: 0, y: 0, playerId: 'ai' } as any,
      friendlyUnits: [],
      hostileUnits: [unit('target', 'richTarget', 2, 0, 'enemy')],
      unitTypes: Object.values(types),
      canBuild: typeId => typeId === 'hunter',
      getType: id => types[id],
      distance: (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
      targetSelectionHandicap: false,
    });

    expect(wants.get('hunter')).toBeGreaterThan(0);
  });

  it('replenishes compatible missiles instead of duplicating a local hunter', () => {
    types.submarine = {
      ...types.hunter,
      id: 'submarine',
      transport_capacity: 8,
      cargoClasses: ['Missile'],
    };
    types.missile = {
      id: 'missile',
      attack: 18,
      combat: 18,
      defense: 0,
      movement: 12,
      cost: 60,
      hitpoints: 10,
      firepower: 3,
      rulesetUnitClass: 'Missile',
      rulesetUnitClassFlags: ['Missile'],
      flags: ['OneAttack'],
    };
    const local = {
      ...unit('sub', 'submarine', 0, 0),
      homeCityId: 'city',
    };
    const wants = rankHunterProduction({
      gameId: 'game',
      playerId: 'ai',
      city: { id: 'city', x: 0, y: 0, playerId: 'ai' } as any,
      friendlyUnits: [local],
      hostileUnits: [unit('target', 'attacker', 2, 0, 'enemy')],
      unitTypes: Object.values(types),
      canBuild: () => true,
      getType: id => types[id],
      distance: (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
      targetSelectionHandicap: false,
    });

    expect(wants.get('missile')).toBeGreaterThan(0);
    expect(wants.has('submarine')).toBe(false);
  });

  it('launches carried missiles at the primary target and nearby interceptors', () => {
    const hunterType = {
      ...types.hunter,
      id: 'submarine',
      defense: 2,
      transport_capacity: 8,
      cargoClasses: ['Missile'],
    };
    const missileType = {
      id: 'missile',
      attack: 18,
      combat: 18,
      defense: 0,
      movement: 6,
      cost: 60,
      rulesetUnitClass: 'Missile',
      rulesetUnitClassFlags: ['Missile'],
    };
    const launchTypes: Record<string, any> = {
      ...types,
      submarine: hunterType,
      missile: missileType,
    };
    const hunter = unit('sub', 'submarine', 0, 0);
    const primary = unit('primary', 'transport', 3, 0, 'enemy');
    const interceptor = unit('interceptor', 'attacker', 1, 0, 'enemy');
    const launches = planHunterMissileLaunches(
      hunter,
      primary,
      [
        hunter,
        { ...unit('m1', 'missile', 0, 0), transportedBy: hunter.id, movementLeft: 6 },
        { ...unit('m2', 'missile', 0, 0), transportedBy: hunter.id, movementLeft: 6 },
      ],
      [primary, interceptor],
      id => launchTypes[id],
      (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2))
    );

    expect(launches.map(launch => launch.target.id)).toEqual(['primary', 'interceptor']);
  });
});
