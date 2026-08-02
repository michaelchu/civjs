import { EffectsManager } from '@game/managers/EffectsManager';
import { MapTopology, TopologyFlag } from '@game/map/MapTopology';
import { UnitManager } from '@game/managers/UnitManager';
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('Civ2Civ3 city conquest actions', () => {
  const gameId = 'c2c3-city-conquest-actions';
  const attackerId = 'player-1';
  const defenderId = 'player-2';
  const width = 20;
  const height = 20;

  function createManager(options: {
    cityOwner: () => string;
    onCapture: () => Promise<boolean>;
    terrainAt?: (x: number, y: number) => string;
    attackerNation?: string;
  }) {
    const terrainAt = options.terrainAt ?? (() => 'grassland');
    const manager = new UnitManager(
      gameId,
      createMockDatabaseProvider(),
      width,
      height,
      {
        getTile: jest.fn((x: number, y: number) => ({
          terrain: terrainAt(x, y),
          improvements: [],
          owner: x === 11 && y === 10 ? options.cityOwner() : undefined,
        })),
        getTopology: jest.fn(
          () =>
            new MapTopology(width, height, {
              topologyId: TopologyFlag.ISO | TopologyFlag.HEX,
            })
        ),
      } as any,
      {
        foundCity: jest.fn(),
        requestPath: jest.fn(),
        broadcastUnitMoved: jest.fn(),
        getCityAt: (x, y) =>
          x === 11 && y === 10
            ? { id: 'enemy-city', playerId: options.cityOwner(), buildings: [] }
            : null,
        captureCity: jest.fn(options.onCapture),
        getPlayerNation: playerId =>
          playerId === attackerId ? (options.attackerNation ?? 'roman') : 'french',
      },
      new EffectsManager('civ2civ3'),
      undefined,
      rulesetUnitsService.getUnitTypes('civ2civ3')
    );
    manager.setHostilityProvider(async () => true);
    return manager;
  }

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:882-897
   * @reference reference/freeciv/server/unithand.c:5610-5642
   * @assertion A non-NonMil CanOccupyCity unit on a livable tile conquers an adjacent undefended enemy city at the one-fragment C2C3 movement boundary.
   * @c2c3-action Conquer City Shrink
   * @c2c3-scenario normal, boundary
   */
  it('captures an undefended enemy city through the native C2C3 conquest action', async () => {
    let cityOwner = defenderId;
    const manager = createManager({
      cityOwner: () => cityOwner,
      onCapture: async () => {
        cityOwner = attackerId;
        return true;
      },
    });
    const warrior = await manager.createUnit(attackerId, 'warriors', 10, 10);
    warrior.movementLeft = 1;

    await expect(manager.moveUnit(warrior.id, 11, 10)).resolves.toBe(true);

    expect(cityOwner).toBe(attackerId);
    expect(warrior).toMatchObject({ x: 11, y: 10, movementLeft: 0 });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:893-897
   * @assertion Conquer City Shrink rejects an enemy city tile containing any defending unit because its target MaxUnitsOnTile requirement is zero.
   * @c2c3-action Conquer City Shrink
   * @c2c3-scenario rejected
   */
  it('rejects native C2C3 conquest of a defended city', async () => {
    const manager = createManager({
      cityOwner: () => defenderId,
      onCapture: jest.fn().mockResolvedValue(true),
    });
    const warrior = await manager.createUnit(attackerId, 'warriors', 10, 10);
    await manager.createUnit(defenderId, 'warriors', 11, 10);

    await expect(manager.moveUnit(warrior.id, 11, 10)).rejects.toThrow(
      'Cannot move to tile occupied by enemy unit'
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:898-913
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:4544-4551
   * @reference reference/freeciv/server/unithand.c:5610-5642
   * @assertion A Marine loaded on a non-livable transport tile can capture an adjacent undefended city, disembarks from the transport, and pays the C2C3 full-movement post-action cost.
   * @c2c3-action Conquer City Shrink 2
   * @c2c3-scenario normal, boundary
   */
  it('lets a C2C3 Marine capture an undefended city from transport', async () => {
    let cityOwner = defenderId;
    const manager = createManager({
      cityOwner: () => cityOwner,
      onCapture: async () => {
        cityOwner = attackerId;
        return true;
      },
      terrainAt: (x, y) => (x === 10 && y === 10 ? 'ocean' : 'grassland'),
    });
    const transport = await manager.createUnit(attackerId, 'trireme', 10, 10);
    const marine = await manager.createUnit(attackerId, 'marines', 10, 10, undefined, transport.id);
    marine.movementLeft = manager.getUnitMaxMovement('marines');

    await expect(manager.moveUnit(marine.id, 11, 10)).resolves.toBe(true);

    expect(cityOwner).toBe(attackerId);
    expect(transport.cargoUnits).toEqual([]);
    expect(marine).toMatchObject({
      transportedBy: undefined,
      x: 11,
      y: 10,
      movementLeft: 0,
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:898-913
   * @assertion Conquer City Shrink 2 rejects a transported unit without the Marines flag before it can capture the city.
   * @c2c3-action Conquer City Shrink 2
   * @c2c3-scenario rejected
   */
  it('rejects non-Marine transport city conquest', async () => {
    const manager = createManager({
      cityOwner: () => defenderId,
      onCapture: jest.fn().mockResolvedValue(true),
      terrainAt: (x, y) => (x === 10 && y === 10 ? 'ocean' : 'grassland'),
    });
    const transport = await manager.createUnit(attackerId, 'trireme', 10, 10);
    const warrior = await manager.createUnit(
      attackerId,
      'warriors',
      10,
      10,
      undefined,
      transport.id
    );
    warrior.movementLeft = manager.getUnitMaxMovement('warriors');

    await expect(manager.moveUnit(warrior.id, 11, 10)).rejects.toThrow(
      'Transported unit must unload before moving'
    );
  });
});
