import {
  explorationDesirability,
  planExploration,
  type ExplorerPlanningContext,
} from '@game/ai/FreecivAIExplorerPlanner';

function tile(x: number, y: number, terrain: 'grassland' | 'ocean' = 'grassland'): any {
  return {
    x,
    y,
    terrain,
    riverMask: 0,
    elevation: terrain === 'ocean' ? 0 : 100,
    continentId: terrain === 'ocean' ? 0 : 1,
    isExplored: false,
    isVisible: false,
    hasRoad: false,
    hasRailroad: false,
    improvements: [],
    unitIds: [],
    properties: {},
    temperature: 'temperate',
    wetness: 50,
  };
}

function unit(id: string, x: number, y: number): any {
  return {
    id,
    playerId: 'ai',
    unitTypeId: 'explorer',
    x,
    y,
    movementLeft: 3,
    health: 100,
    fortified: false,
  };
}

function context(
  exploredCoordinates: Array<[number, number]>,
  overrides: Partial<ExplorerPlanningContext> = {}
): ExplorerPlanningContext {
  const width = 8;
  const height = 5;
  const tiles = Array.from({ length: width }, (_, x) =>
    Array.from({ length: height }, (_, y) => tile(x, y))
  );
  const exploredTiles = new Set(exploredCoordinates.map(([x, y]) => `${x},${y}`));
  return {
    turn: 7,
    playerId: 'ai',
    units: [unit('scout', 1, 2)],
    map: {
      width,
      height,
      tiles,
      startingPositions: [],
      seed: 'test',
      generatedAt: new Date(0),
    },
    exploredTiles,
    hostileUnits: [],
    nonAlliedUnits: [],
    nonAlliedCityTiles: new Set(),
    existingTasks: {},
    getType: () =>
      ({
        id: 'explorer',
        movement: 1,
        combat: 0,
        attack: 0,
        range: 1,
        sight: 2,
        vision_radius_sq: 2,
        rulesetUnitClass: 'Land',
        roles: ['Explorer'],
      }) as any,
    getNeighbors: (x, y) =>
      tiles
        .flat()
        .filter(candidate => Math.max(Math.abs(candidate.x - x), Math.abs(candidate.y - y)) === 1),
    distance: (fromX, fromY, toX, toY) => Math.max(Math.abs(fromX - toX), Math.abs(fromY - toY)),
    squaredDistance: (fromX, fromY, toX, toY) => (fromX - toX) ** 2 + (fromY - toY) ** 2,
    findPath: async (actor, targetX, targetY) => ({
      valid: true,
      path: [
        { x: actor.x, y: actor.y, moveCost: 0 },
        { x: targetX, y: targetY, moveCost: 1 },
      ],
      totalCost: Math.max(Math.abs(actor.x - targetX), Math.abs(actor.y - targetY)),
      estimatedTurns: 1,
    }),
    knowsHuts: false,
    ...overrides,
  };
}

describe('FreecivAIExplorerPlanner', () => {
  it('prefers a farther frontier when its information value repays travel', async () => {
    const planning = context(
      [
        [1, 2],
        [2, 2],
        [2, 3],
        [3, 2],
        [4, 2],
      ],
      {
        getType: () =>
          ({
            id: 'explorer',
            movement: 1,
            combat: 0,
            attack: 0,
            range: 1,
            sight: 1,
            vision_radius_sq: 1,
            rulesetUnitClass: 'Land',
            roles: ['Explorer'],
          }) as any,
        findPath: async (actor, targetX, targetY) => ({
          valid: targetY === 2 && (targetX === 2 || targetX === 4),
          path: [
            { x: actor.x, y: actor.y, moveCost: 0 },
            { x: targetX, y: targetY, moveCost: 1 },
          ],
          totalCost: Math.abs(actor.x - targetX),
          estimatedTurns: 1,
        }),
      }
    );

    const plan = await planExploration(planning);

    expect(plan.assignments[0]?.tile).toMatchObject({ x: 4, y: 2 });
    expect(plan.tasks.scout).toMatchObject({ role: 'explore', targetX: 4, targetY: 2 });
  });

  it('rejects paths exposed to an immediate hostile strike', async () => {
    const planning = context(
      [
        [1, 2],
        [2, 2],
        [3, 1],
        [3, 2],
        [3, 3],
        [4, 2],
      ],
      {
        hostileUnits: [
          {
            ...unit('enemy', 4, 1),
            playerId: 'enemy',
            unitTypeId: 'warrior',
            movementLeft: 0,
          },
        ],
        nonAlliedUnits: [
          {
            ...unit('enemy', 4, 1),
            playerId: 'enemy',
            unitTypeId: 'warrior',
            movementLeft: 0,
          },
        ],
        getType: id =>
          ({
            id,
            movement: 1,
            combat: id === 'warrior' ? 1 : 0,
            attack: id === 'warrior' ? 1 : 0,
            range: 1,
            sight: 2,
            vision_radius_sq: 2,
            rulesetUnitClass: 'Land',
            roles: id === 'explorer' ? ['Explorer'] : [],
          }) as any,
      }
    );

    const plan = await planExploration(planning);

    expect(
      plan.assignments.find(assignment => assignment.tile.x === 4 && assignment.tile.y === 2)
    ).toBeUndefined();
  });

  it('reserves distinct destinations for multiple explorers', async () => {
    const planning = context([
      [1, 2],
      [2, 2],
      [3, 1],
      [3, 2],
      [3, 3],
      [4, 2],
    ]);
    planning.units = [unit('alpha', 1, 2), unit('beta', 2, 2)];

    const plan = await planExploration(planning);

    expect(plan.assignments).toHaveLength(2);
    expect(
      new Set(plan.assignments.map(assignment => `${assignment.tile.x},${assignment.tile.y}`)).size
    ).toBe(2);
  });

  it('keeps the original assignment turn while a frontier target remains valuable', async () => {
    const planning = context(
      [
        [1, 2],
        [2, 2],
      ],
      {
        existingTasks: {
          scout: {
            role: 'explore',
            targetX: 2,
            targetY: 2,
            assignedTurn: 3,
          },
        },
      }
    );

    const plan = await planExploration(planning);

    expect(plan.tasks.scout).toMatchObject({ targetX: 2, targetY: 2, assignedTurn: 3 });
  });

  it('uses known huts only when the difficulty profile permits that knowledge', () => {
    const planning = context([
      [1, 2],
      [2, 2],
    ]);
    planning.map.tiles[2][2].improvements = ['hut'];
    const scout = planning.units[0];

    const handicapped = explorationDesirability(planning, scout, planning.map.tiles[2][2]);
    planning.knowsHuts = true;
    const informed = explorationDesirability(planning, scout, planning.map.tiles[2][2]);

    expect(informed - handicapped).toBe(60_902);
  });
});
