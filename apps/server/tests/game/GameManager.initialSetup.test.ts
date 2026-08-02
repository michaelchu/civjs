import { GameManager } from '@game/managers/GameManager';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('GameManager ruleset initial setup', () => {
  const io = { to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() } as any;
  let manager: GameManager;

  beforeEach(() => {
    (GameManager as any).instance = null;
    manager = GameManager.getInstance(io, createMockDatabaseProvider());
  });

  afterEach(() => manager.clearAllGames());

  /**
   * @evidence parity
   * @reference reference/freeciv/server/gamehand.c:798-878
   * @reference reference/freeciv/server/gamehand.c:232-255
   * @reference reference/freeciv/common/game.h:387-396
   * @reference reference/freeciv/data/civ2civ3/game.ruleset:810-827
   * @assertion C2C3 creates the cwsx role roster sequentially at the player's start tile; the unconfigured dispersion default is zero, so no role unit is scattered to another coordinate.
   * @c2c3-surface map-generation
   * @c2c3-surface-scenario normal
   */
  it('creates the C2C3 cwsx roster at the isometric map start coordinate', async () => {
    const createUnit = jest.fn(async (_playerId, unitTypeId, x, y) => ({
      id: `${unitTypeId}-${x}-${y}`,
    }));
    const researchManager = { getResearchedTechs: () => [] };

    await (manager as any).createStartingUnits(
      'c2c3-start',
      { startingPositions: [{ playerId: 'p1', x: 14, y: 9 }] },
      { createUnit },
      new Map([['p1', { id: 'p1' }]]),
      'civ2civ3',
      researchManager
    );

    expect(createUnit.mock.calls).toEqual([
      ['p1', 'settlers', 14, 9],
      ['p1', 'worker', 14, 9],
      ['p1', 'diplomat', 14, 9],
      ['p1', 'explorer', 14, 9],
    ]);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/server/gamehand.c:112-190
   * @reference reference/freeciv/common/unittype.c:2100-2118
   * @reference reference/freeciv/common/unittype.c:2348-2369
   * @assertion The startup lifecycle uses the player's already-granted technologies when a role has an advanced non-obsolete candidate.
   * @c2c3-surface map-generation
   * @c2c3-surface-scenario boundary
   */
  it('uses advanced role candidates when the startup technology state makes them buildable', async () => {
    const createUnit = jest.fn(async (_playerId, unitTypeId) => ({ id: unitTypeId }));
    const researchManager = {
      getResearchedTechs: () => ['alphabet', 'espionage', 'explosives', 'seafaring'],
    };

    await (manager as any).createStartingUnits(
      'c2c3-start',
      { startingPositions: [{ playerId: 'p1', x: 2, y: 3 }] },
      { createUnit },
      new Map([['p1', { id: 'p1' }]]),
      'civ2civ3',
      researchManager
    );

    expect(createUnit.mock.calls.map(([, unitTypeId]) => unitTypeId)).toEqual([
      'settlers',
      'engineers',
      'spy',
      'explorer',
    ]);
  });
});
