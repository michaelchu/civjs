import { planHunters } from '@game/ai/FreecivAIHunterPlanner';

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
});
