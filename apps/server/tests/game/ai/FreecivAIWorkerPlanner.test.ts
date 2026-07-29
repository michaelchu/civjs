import { ActionType } from '@app-types/shared/actions';
import { planWorkerImprovements } from '@game/ai/FreecivAIWorkerPlanner';

const tile = (
  x: number,
  y: number,
  terrain = 'grassland',
  overrides: Record<string, unknown> = {}
) =>
  ({
    x,
    y,
    terrain,
    riverMask: 0,
    elevation: 0,
    continentId: 1,
    isExplored: true,
    isVisible: true,
    hasRoad: false,
    hasRailroad: false,
    improvements: [],
    unitIds: [],
    properties: {},
    temperature: 4,
    wetness: 50,
    owner: 'ai',
    ...overrides,
  }) as any;

const worker = (id: string, x: number, y: number) =>
  ({
    id,
    playerId: 'ai',
    unitTypeId: 'worker',
    x,
    y,
    movementLeft: 3,
    health: 100,
    veteranLevel: 0,
    experience: 0,
    fortified: false,
  }) as any;

function context(tiles: any[], workers: any[], overrides: Record<string, unknown> = {}): any {
  const byPosition = new Map(tiles.map(candidate => [`${candidate.x},${candidate.y}`, candidate]));
  return {
    turn: 4,
    playerId: 'ai',
    workers,
    cities: [
      {
        id: 'city',
        playerId: 'ai',
        workableTiles: tiles.map(candidate => ({
          x: candidate.x,
          y: candidate.y,
          isWorked: true,
        })),
      },
    ],
    hostileUnits: [],
    existingTasks: {},
    getTile: (x: number, y: number) => byPosition.get(`${x},${y}`) ?? null,
    getNeighbors: (x: number, y: number) =>
      tiles.filter(
        candidate => Math.max(Math.abs(candidate.x - x), Math.abs(candidate.y - y)) === 1
      ),
    getType: (unitTypeId: string) =>
      unitTypeId === 'worker'
        ? { canBuildImprovements: true, movement: 1, attack: 0 }
        : { movement: 1, attack: 1, combat: 1 },
    distance: (fromX: number, fromY: number, toX: number, toY: number) =>
      Math.max(Math.abs(fromX - toX), Math.abs(fromY - toY)),
    researchedTechs: new Set<string>(),
    ...overrides,
  };
}

describe('Freeciv AI worker planner', () => {
  it('values the best ruleset improvement and discounts travel and work time', () => {
    const hills = tile(1, 1, 'hills');
    const plan = planWorkerImprovements(context([hills], [worker('worker', 1, 1)]));

    expect(plan.assignments[0]).toMatchObject({
      action: ActionType.BUILD_MINE,
      travelTurns: 0,
      workTurns: 10,
    });
    expect(plan.tasks.worker).toMatchObject({
      role: 'worker',
      action: ActionType.BUILD_MINE,
      targetX: 1,
      targetY: 1,
    });
  });

  it('prioritizes cleanup but rejects a tile an enemy can immediately threaten', () => {
    const polluted = tile(2, 2, 'grassland', { improvements: ['pollution'] });
    const enemy = { ...worker('enemy', 3, 2), playerId: 'enemy', unitTypeId: 'warriors' };

    expect(
      planWorkerImprovements(
        context([polluted], [worker('worker', 2, 2)], { hostileUnits: [enemy] })
      ).assignments
    ).toEqual([]);

    enemy.x = 8;
    expect(
      planWorkerImprovements(
        context([polluted], [worker('worker', 2, 2)], { hostileUnits: [enemy] })
      ).assignments[0]
    ).toMatchObject({ action: ActionType.CLEAN_POLLUTION });
  });

  it('reserves distinct destinations across multiple workers', () => {
    const first = tile(1, 1, 'grassland');
    const second = tile(2, 1, 'grassland');
    const plan = planWorkerImprovements(
      context([first, second], [worker('a', 0, 1), worker('b', 3, 1)])
    );

    expect(plan.assignments).toHaveLength(2);
    expect(new Set(plan.assignments.map(item => `${item.tile.x},${item.tile.y}`)).size).toBe(2);
  });

  it('orders railroad after its road dependency and preserves an unchanged assignment', () => {
    const roaded = tile(1, 1, 'plains', { hasRoad: true, improvements: ['road'] });
    const existing = {
      worker: {
        role: 'worker',
        action: ActionType.BUILD_RAILROAD,
        targetX: 1,
        targetY: 1,
        assignedTurn: 2,
      },
    };
    const plan = planWorkerImprovements(
      context([roaded], [worker('worker', 1, 1)], {
        existingTasks: existing,
        researchedTechs: new Set(['railroad']),
      })
    );

    expect(plan.assignments[0].action).toBe(ActionType.BUILD_RAILROAD);
    expect(plan.tasks.worker.assignedTurn).toBe(2);

    const unroaded = tile(1, 1, 'plains');
    const withoutDependency = planWorkerImprovements(
      context([unroaded], [worker('worker', 1, 1)], {
        researchedTechs: new Set(['railroad']),
      })
    );
    expect(withoutDependency.assignments[0].action).not.toBe(ActionType.BUILD_RAILROAD);
  });
});
