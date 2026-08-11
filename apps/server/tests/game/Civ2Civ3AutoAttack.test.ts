import { EffectsManager } from '@game/managers/EffectsManager';
import { UnitManager } from '@game/managers/UnitManager';
import { MapTopology, TopologyFlag } from '@game/map/MapTopology';
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('Civ2Civ3 server-side auto-attack', () => {
  const width = 20;
  const height = 20;
  const destination = { x: 10, y: 10 };
  const baseUnitTypes = rulesetUnitsService.getUnitTypes('civ2civ3');

  function testUnitTypes() {
    return {
      ...baseUnitTypes,
      warriors: {
        ...baseUnitTypes.warriors,
        attack: 1,
        defense: 1,
      },
      strong_target: {
        ...baseUnitTypes.warriors,
        id: 'strong_target',
        name: 'Strong Target',
        attack: 2,
        defense: 1,
      },
      provoking_target: {
        ...baseUnitTypes.warriors,
        id: 'provoking_target',
        name: 'Provoking Target',
        flags: [...(baseUnitTypes.warriors.flags ?? []), 'Provoking'],
      },
    };
  }

  function createManager(
    cityAt: (x: number, y: number) => { id: string; playerId: string } | null = () => null
  ) {
    const databaseProvider = createMockDatabaseProvider();
    const topology = new MapTopology(width, height, {
      topologyId: TopologyFlag.ISO | TopologyFlag.HEX,
      wrapId: 0,
    });
    const manager = new UnitManager(
      'c2c3-auto-attack',
      databaseProvider,
      width,
      height,
      {
        getTile: jest.fn(() => ({ terrain: 'grassland', improvements: [] })),
        getTopology: jest.fn(() => topology),
      } as any,
      {
        foundCity: jest.fn(),
        requestPath: jest.fn(),
        broadcastUnitMoved: jest.fn(),
        broadcastUnitInfo: jest.fn(),
        getCityAt: cityAt,
        getPlayerNation: () => 'roman',
      },
      new EffectsManager('civ2civ3'),
      () => 0.999,
      testUnitTypes()
    );
    manager.setAlliedPlayersProvider(() => new Set());
    manager.setHostilePlayersProvider(() => new Set());
    manager.setHostilityProvider(async () => true);
    manager.setAutoAttackEnabled(true);
    return { manager, topology };
  }

  function movementPositions(topology: MapTopology) {
    const neighbors = topology.getNeighbors(destination.x, destination.y);
    if (neighbors.length < 2) throw new Error('Auto-attack fixture needs two adjacent tiles');
    return { source: neighbors[0]!, attacker: neighbors[1]! };
  }

  /**
   * @evidence parity
   * @reference reference/freeciv/common/game.h:676
   * @reference reference/freeciv/server/settings.c:2448-2453
   * @reference reference/freeciv/server/unittools.c:3523-3531
   * @assertion Auto-attack is disabled by Freeciv's default server setting.
   * @c2c3-action Attack
   * @c2c3-scenario boundary
   */
  it('does not react to adjacent movement when the server setting is disabled', async () => {
    const { manager, topology } = createManager();
    manager.setAutoAttackEnabled(false);
    const positions = movementPositions(topology);
    const moved = await manager.createUnit(
      'player-1',
      'strong_target',
      positions.source.x,
      positions.source.y
    );
    const attacker = await manager.createUnit(
      'player-2',
      'warriors',
      positions.attacker.x,
      positions.attacker.y
    );

    await manager.moveUnit(moved.id, destination.x, destination.y);

    expect(manager.getUnit(moved.id)).toMatchObject({ x: destination.x, y: destination.y });
    expect(manager.getUnit(attacker.id)).toBeDefined();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:10-31
   * @reference reference/freeciv/server/unittools.c:3540-3607
   * @assertion An eligible adjacent attacker reacts after movement when its
   * success probability clears the ordinary 25% threshold and the mover's
   * reciprocal odds do not make the attack unfavorable.
   * @c2c3-action Attack
   * @c2c3-scenario normal
   */
  it('auto-attacks an eligible adjacent mover using authoritative combat', async () => {
    const { manager, topology } = createManager();
    const positions = movementPositions(topology);
    const moved = await manager.createUnit(
      'player-1',
      'strong_target',
      positions.source.x,
      positions.source.y
    );
    const attacker = await manager.createUnit(
      'player-2',
      'warriors',
      positions.attacker.x,
      positions.attacker.y
    );
    await manager.seedUnitState(moved.id, { movementLeft: 12 });

    expect(manager.calculateUnitWinChance(attacker, moved)).toBeGreaterThan(0.25);

    await manager.moveUnit(moved.id, destination.x, destination.y);

    expect(manager.getUnit(moved.id)).toBeUndefined();
    expect(manager.getUnit(attacker.id)).toBeDefined();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/server/unittools.c:3568-3604
   * @assertion A solitary unit in a city is protected by the stricter 90%
   * auto-attack threshold, even when the ordinary odds comparison allows the
   * reaction.
   * @c2c3-action Attack
   * @c2c3-scenario boundary
   */
  it('uses the 90% threshold for a solitary city defender', async () => {
    const { manager, topology } = createManager((x, y) =>
      x === destination.x && y === destination.y
        ? null
        : x === topology.getNeighbors(destination.x, destination.y)[1]?.x &&
            y === topology.getNeighbors(destination.x, destination.y)[1]?.y
          ? { id: 'city', playerId: 'player-2' }
          : null
    );
    const positions = movementPositions(topology);
    const moved = await manager.createUnit(
      'player-1',
      'strong_target',
      positions.source.x,
      positions.source.y
    );
    const attacker = await manager.createUnit(
      'player-2',
      'warriors',
      positions.attacker.x,
      positions.attacker.y
    );

    expect(manager.calculateUnitWinChance(attacker, moved)).toBeLessThan(0.9);
    expect(manager.calculateUnitWinChance(attacker, moved)).toBeGreaterThan(0.25);

    await manager.moveUnit(moved.id, destination.x, destination.y);

    expect(manager.getUnit(moved.id)).toMatchObject({
      x: destination.x,
      y: destination.y,
      health: 100,
    });
    expect(manager.getUnit(attacker.id)).toMatchObject({
      x: positions.attacker.x,
      y: positions.attacker.y,
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/unittype.h:202-205
   * @reference reference/freeciv/server/unittools.c:3598-3604
   * @assertion Provoking forces an auto-attack despite the mover having equal
   * reciprocal odds, while the ordinary strict comparison would reject it.
   * @c2c3-action Attack
   * @c2c3-scenario normal
   */
  it('honors the Provoking unit flag', async () => {
    const { manager, topology } = createManager();
    const positions = movementPositions(topology);
    const moved = await manager.createUnit(
      'player-1',
      'provoking_target',
      positions.source.x,
      positions.source.y
    );
    const attacker = await manager.createUnit(
      'player-2',
      'warriors',
      positions.attacker.x,
      positions.attacker.y
    );

    expect(manager.calculateUnitWinChance(attacker, moved)).toBeCloseTo(0.5);
    expect(manager.calculateUnitWinChance(moved, attacker)).toBeCloseTo(0.5);

    await manager.moveUnit(moved.id, destination.x, destination.y);

    expect(manager.getUnit(moved.id)).toBeUndefined();
    expect(manager.getUnit(attacker.id)).toBeDefined();
  });
});
