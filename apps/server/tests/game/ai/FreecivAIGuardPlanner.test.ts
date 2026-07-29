import { planCityGuards } from '@game/ai/FreecivAIGuardPlanner';
import { createAIProfile } from '@game/ai/FreecivAIProfile';

const city = (id: string, x: number, y: number) => ({ id, x, y, playerId: 'ai' }) as any;

const unit = (id: string, unitTypeId: string, x: number, y: number, playerId = 'ai') =>
  ({
    id,
    unitTypeId,
    x,
    y,
    playerId,
    health: 100,
    veteranLevel: 0,
    movementLeft: 3,
    fortified: false,
  }) as any;

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
});
