import { chooseGuardRendezvous, planCityGuards } from '@game/ai/FreecivAIGuardPlanner';
import { createAIProfile } from '@game/ai/FreecivAIProfile';
import { makeAICity, makeAIUnit } from '../../fixtures/aiFixtures';

const city = (id: string, x: number, y: number) => makeAICity({ id, name: id, x, y });

const unit = (id: string, unitTypeId: string, x: number, y: number, playerId = 'ai') =>
  makeAIUnit({ id, unitTypeId, x, y, playerId });

const types: Record<string, any> = {
  defender: {
    id: 'defender',
    attack: 1,
    defense: 4,
    combat: 1,
    movement: 3,
    hitpoints: 10,
    canFoundCity: false,
    canBuildImprovements: false,
    roles: ['DefendGood'],
  },
  attacker: {
    id: 'attacker',
    attack: 6,
    defense: 2,
    combat: 6,
    movement: 3,
    hitpoints: 10,
    firepower: 1,
    bombardRate: 0,
    cargoClasses: [],
    rulesetUnitClassFlags: ['CanOccupyCity'],
    flags: [],
    canFoundCity: false,
    canBuildImprovements: false,
  },
  diplomat: {
    id: 'diplomat',
    attack: 0,
    defense: 1,
    combat: 0,
    movement: 1,
    hitpoints: 10,
    canFoundCity: false,
    canBuildImprovements: false,
    flags: ['Diplomat', 'NonMil'],
  },
  caravan: {
    id: 'caravan',
    attack: 0,
    defense: 1,
    combat: 0,
    movement: 1,
    hitpoints: 10,
    canFoundCity: false,
    canBuildImprovements: false,
    flags: ['HelpWonder', 'NonMil'],
  },
};

describe('Freeciv AI guard planner', () => {
  it('assigns the nearest defender to the most urgent undefended city', () => {
    const plan = planCityGuards({
      turn: 5,
      cities: [city('frontier', 5, 5), city('rear', 0, 0)],
      friendlyUnits: [unit('near', 'defender', 4, 4), unit('far', 'defender', 0, 1)],
      hostileUnits: [unit('enemy', 'attacker', 6, 5, 'enemy')],
      existingTasks: {},
      getType: id => types[id],
      distance: (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
      profile: createAIProfile('normal'),
    });

    expect(plan.assignments.near).toMatchObject({
      role: 'guard',
      targetId: 'frontier',
      assignedTurn: 5,
    });
    expect(plan.assessments.find(item => item.city.id === 'frontier')?.urgency).toBe(11);
  });

  it('does not divert nonmilitary wonder helpers into city defense', () => {
    const plan = planCityGuards({
      turn: 5,
      cities: [city('frontier', 5, 5)],
      friendlyUnits: [unit('helper', 'caravan', 5, 5)],
      hostileUnits: [unit('enemy', 'attacker', 6, 5, 'enemy')],
      existingTasks: {
        helper: { role: 'caravan', targetId: 'frontier', assignedTurn: 3 },
      },
      getType: id => types[id],
      distance: (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
      profile: createAIProfile('normal'),
    });

    expect(plan.assignments.helper).toBeUndefined();
  });

  it('preserves sane assignments and dismisses destroyed charges', () => {
    const plan = planCityGuards({
      turn: 8,
      cities: [city('survives', 2, 2)],
      friendlyUnits: [unit('kept', 'defender', 0, 0), unit('dismissed', 'defender', 1, 1)],
      hostileUnits: [],
      existingTasks: {
        kept: { role: 'guard', targetId: 'survives', assignedTurn: 4 },
        dismissed: { role: 'guard', targetId: 'destroyed', assignedTurn: 4 },
      },
      getType: id => types[id],
      distance: (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
      profile: createAIProfile('normal'),
    });

    expect(plan.assignments.kept).toEqual({
      role: 'guard',
      targetId: 'survives',
      assignedTurn: 4,
    });
    expect(plan.assignments.dismissed?.targetId).not.toBe('destroyed');
  });

  it('models the difficulty danger handicap as an urgent threat', () => {
    const plan = planCityGuards({
      turn: 1,
      cities: [city('capital', 2, 2)],
      friendlyUnits: [],
      hostileUnits: [],
      existingTasks: {},
      getType: id => types[id],
      distance: () => 0,
      profile: createAIProfile('restricted'),
    });

    expect(plan.assessments[0]).toMatchObject({ danger: 1, urgency: 10, graveDanger: 1 });
  });

  it('assigns one stronger persistent escort to a vulnerable diplomat', () => {
    const plan = planCityGuards({
      turn: 7,
      cities: [],
      friendlyUnits: [
        unit('diplomat', 'diplomat', 3, 3),
        unit('escort-a', 'defender', 2, 3),
        unit('escort-b', 'defender', 4, 3),
      ],
      hostileUnits: [],
      existingTasks: {
        diplomat: {
          role: 'diplomat',
          targetId: 'enemy-city',
          targetX: 8,
          targetY: 3,
          assignedTurn: 6,
        },
      },
      getType: id => types[id],
      distance: (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
      profile: createAIProfile('normal'),
    });

    expect(Object.values(plan.assignments)).toHaveLength(1);
    expect(plan.assignments['escort-a']).toMatchObject({
      role: 'guard',
      targetId: 'diplomat',
      assignedTurn: 7,
    });
  });

  it('dismisses a destroyed charge and reassigns its guard to a replacement', () => {
    const plan = planCityGuards({
      turn: 9,
      cities: [],
      friendlyUnits: [unit('replacement', 'diplomat', 2, 2), unit('escort', 'defender', 1, 2)],
      hostileUnits: [],
      existingTasks: {
        escort: { role: 'guard', targetId: 'destroyed', assignedTurn: 5 },
        replacement: {
          role: 'diplomat',
          targetId: 'enemy-city',
          targetX: 5,
          targetY: 2,
          assignedTurn: 8,
        },
      },
      getType: id => types[id],
      distance: (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
      profile: createAIProfile('normal'),
    });

    expect(plan.assignments.escort).toMatchObject({
      role: 'guard',
      targetId: 'replacement',
      assignedTurn: 9,
    });
  });

  it('rendezvouses at the charge destination when it is closer than the charge', () => {
    const rendezvous = chooseGuardRendezvous(
      unit('escort', 'defender', 0, 0),
      unit('diplomat', 'diplomat', 4, 0),
      {
        role: 'diplomat',
        targetX: 2,
        targetY: 0,
        assignedTurn: 1,
      },
      id => types[id],
      (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2))
    );

    expect(rendezvous).toEqual({ x: 2, y: 0 });
  });
});
