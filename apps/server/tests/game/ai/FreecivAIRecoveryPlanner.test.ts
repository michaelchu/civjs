import {
  planMilitaryRecovery,
  type RecoveryPlanningContext,
} from '@game/ai/FreecivAIRecoveryPlanner';

function unit(health: number): any {
  return {
    id: 'warrior',
    playerId: 'ai',
    unitTypeId: 'warriors',
    x: 0,
    y: 0,
    movementLeft: 3,
    health,
    veteranLevel: 0,
    fortified: false,
  };
}

function city(id: string, x: number): any {
  return { id, playerId: 'ai', x, y: 0, buildings: [] };
}

function context(health: number, overrides: Partial<RecoveryPlanningContext> = {}) {
  const actor = unit(health);
  return {
    turn: 9,
    units: [actor],
    cities: [city('near', 1), city('barracks', 2)],
    existingTasks: {},
    getType: () =>
      ({
        id: 'warriors',
        unitClass: 'military',
        rulesetUnitClass: 'Land',
        attack: 1,
        defense: 1,
        combat: 1,
        movement: 1,
        canFoundCity: false,
        canBuildImprovements: false,
        transport_capacity: 0,
        paratroopersRange: 0,
        fuel: 0,
        roles: [],
        flags: [],
      }) as any,
    findPath: async (_unit: any, targetX: number) => ({
      valid: true,
      path: [
        { x: 0, y: 0, moveCost: 0 },
        { x: targetX, y: 0, moveCost: 1 },
      ],
      totalCost: targetX,
      estimatedTurns: targetX,
    }),
    hasAcceleratedRegeneration: (_unit: any, destination: any) => destination.id === 'barracks',
    ...overrides,
  } satisfies RecoveryPlanningContext;
}

describe('FreecivAIRecoveryPlanner', () => {
  it('starts recovery below one quarter health and prefers accelerated regeneration', async () => {
    const plan = await planMilitaryRecovery(context(24));

    expect(plan.tasks.warrior).toMatchObject({
      role: 'recover',
      targetId: 'barracks',
      assignedTurn: 9,
    });
  });

  it('does not start recovery at exactly one quarter health', async () => {
    expect((await planMilitaryRecovery(context(25))).assignments).toHaveLength(0);
  });

  it('keeps recovery sticky until full health', async () => {
    const planning = context(80, {
      existingTasks: {
        warrior: {
          role: 'recover',
          targetId: 'near',
          targetX: 1,
          targetY: 0,
          assignedTurn: 4,
        },
      },
    });

    const plan = await planMilitaryRecovery(planning);

    expect(plan.tasks.warrior).toMatchObject({ role: 'recover', assignedTurn: 4 });
    planning.units[0].health = 100;
    expect((await planMilitaryRecovery(planning)).tasks).toEqual({});
  });

  it('leaves the unit available when no allied recovery city is reachable', async () => {
    const plan = await planMilitaryRecovery(
      context(10, {
        findPath: async () => ({
          valid: false,
          path: [],
          totalCost: 0,
          estimatedTurns: 0,
        }),
      })
    );

    expect(plan.tasks).toEqual({});
  });

  it('leaves Freeciv hunter specialists under their dedicated controller', async () => {
    const plan = await planMilitaryRecovery(
      context(10, {
        getType: () =>
          ({
            unitClass: 'military',
            attack: 4,
            defense: 2,
            combat: 4,
            canFoundCity: false,
            canBuildImprovements: false,
            paratroopersRange: 0,
            roles: ['Hunter'],
          }) as any,
      })
    );

    expect(plan.tasks).toEqual({});
  });
});
