import { planFerries, scoreFerryBeachhead } from '@game/ai/FreecivAIFerryPlanner';

const unit = (id: string, unitTypeId: string, x: number, y: number, transportedBy?: string) =>
  ({
    id,
    playerId: 'ai',
    unitTypeId,
    x,
    y,
    transportedBy,
    movementLeft: 3,
    health: 100,
    veteranLevel: 0,
    experience: 0,
    fortified: false,
  }) as any;

const types: Record<string, any> = {
  ferry: {
    id: 'ferry',
    unitClass: 'naval',
    transport_capacity: 2,
    cargoClasses: ['Land'],
  },
  settler: {
    id: 'settler',
    unitClass: 'civilian',
    rulesetUnitClass: 'Land',
    cargoClasses: [],
  },
  air: { id: 'air', unitClass: 'air', rulesetUnitClass: 'Air', cargoClasses: [] },
};

describe('Freeciv AI ferry planner', () => {
  it('matches demand to the nearest compatible available ferry', () => {
    const plan = planFerries({
      friendlyUnits: [
        unit('far', 'ferry', 8, 8),
        unit('near', 'ferry', 1, 0),
        unit('passenger', 'settler', 0, 0),
      ],
      existingTasks: {
        passenger: { role: 'settle', targetX: 12, targetY: 4, assignedTurn: 2 },
      },
      getType: id => types[id],
      capacityRemaining: () => 2,
      distance: (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      ferry: { id: 'near' },
      passenger: { id: 'passenger' },
      destinationX: 12,
      phase: 'rendezvous',
    });
  });

  it('retains a valid pair and switches to delivery once embarked', () => {
    const plan = planFerries({
      friendlyUnits: [unit('boat', 'ferry', 3, 3), unit('passenger', 'settler', 3, 3, 'boat')],
      existingTasks: {
        boat: { role: 'ferry', targetId: 'passenger', assignedTurn: 4 },
        passenger: { role: 'settle', targetX: 9, targetY: 9, assignedTurn: 4 },
      },
      getType: id => types[id],
      capacityRemaining: () => 1,
      distance: () => 0,
    });
    expect(plan[0]).toMatchObject({
      ferry: { id: 'boat' },
      passenger: { id: 'passenger' },
      phase: 'delivery',
    });
  });

  it('rejects incompatible cargo and ferries without capacity', () => {
    const plan = planFerries({
      friendlyUnits: [
        unit('boat', 'ferry', 0, 0),
        unit('air', 'air', 0, 0),
        unit('settler', 'settler', 0, 0),
      ],
      existingTasks: {
        air: { role: 'attack', targetX: 5, targetY: 5, assignedTurn: 1 },
        settler: { role: 'settle', targetX: 5, targetY: 5, assignedTurn: 1 },
      },
      getType: id => types[id],
      capacityRemaining: () => 0,
      distance: () => 0,
    });
    expect(plan).toEqual([]);
  });

  it('pools multiple passengers onto one ferry without exceeding planned capacity', () => {
    const plan = planFerries({
      friendlyUnits: [
        unit('boat', 'ferry', 0, 0),
        unit('first', 'settler', 1, 0),
        unit('second', 'settler', 1, 1),
        unit('third', 'settler', 2, 0),
      ],
      existingTasks: {
        first: { role: 'settle', targetX: 10, targetY: 3, assignedTurn: 1 },
        second: { role: 'guard', targetX: 10, targetY: 3, assignedTurn: 1 },
        third: { role: 'attack', targetX: 10, targetY: 3, assignedTurn: 1 },
      },
      getType: id => types[id],
      capacityRemaining: () => 2,
      distance: (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
    });

    expect(plan.map(assignment => assignment.passenger.id)).toEqual(['first', 'second']);
    expect(new Set(plan.map(assignment => assignment.ferry.id))).toEqual(new Set(['boat']));
  });

  it('prefers a supported beachhead over an equally distant threatened landing', () => {
    const threatened = scoreFerryBeachhead({
      missionRole: 'attack',
      distance: 2,
      enemyThreat: 100,
      friendlySupport: 0,
      landingDefense: 20,
    });
    const supported = scoreFerryBeachhead({
      missionRole: 'attack',
      distance: 2,
      enemyThreat: 20,
      friendlySupport: 100,
      landingDefense: 80,
    });

    expect(supported).toBeLessThan(threatened);
  });
});
