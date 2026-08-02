import { UnitManager } from '@game/managers/UnitManager';
import { EffectsManager } from '@game/managers/EffectsManager';
import { ActionType } from '@app-types/shared/actions';
import { MapTopology, TopologyFlag } from '@game/map/MapTopology';
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('Civ2Civ3 capture and ransom actions', () => {
  const gameId = 'c2c3-capture-actions';
  const attackerId = 'player-1';
  const defenderId = 'player-2';
  const barbarianId = 'barbarian-player';
  const width = 20;
  const height = 20;

  function createManager(
    options: {
      cityAt?: (x: number, y: number) => { id: string; playerId: string } | null;
    } = {}
  ) {
    const databaseProvider = createMockDatabaseProvider();
    const manager = new UnitManager(
      gameId,
      databaseProvider,
      width,
      height,
      {
        getTile: jest.fn(() => ({ terrain: 'grassland', improvements: [] })),
        getTopology: jest.fn(
          () =>
            new MapTopology(width, height, {
              topologyId: TopologyFlag.ISO | TopologyFlag.HEX,
              wrapId: 0,
            })
        ),
      } as any,
      {
        foundCity: jest.fn(),
        requestPath: jest.fn(),
        broadcastUnitMoved: jest.fn(),
        getCityAt: options.cityAt ?? (() => null),
        getPlayerNation: playerId => (playerId === barbarianId ? 'barbarian' : 'roman'),
      },
      new EffectsManager('civ2civ3'),
      undefined,
      rulesetUnitsService.getUnitTypes('civ2civ3')
    );
    return { manager, databaseProvider };
  }

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:681-695
   * @reference reference/freeciv/common/actions.c:249-257
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:4487-4495
   * @reference reference/freeciv/server/unithand.c:282-496
   * @assertion A Capturer at the exact ISO-hex range of one transfers a Capturable foreign unit, preserves the captured unit's remaining movement, assigns the capturer's home city, and pays the six-fragment Capture Units cost.
   * @c2c3-action Capture Units
   * @c2c3-scenario normal, boundary
   */
  it('captures an adjacent c2c3 Capturable unit and charges the source action cost', async () => {
    const { manager } = createManager();
    manager.setHostilityProvider(async () => true);
    const capturer = await manager.createUnit(attackerId, 'warriors', 10, 10, 'home-city');
    const caravan = await manager.createUnit(defenderId, 'caravan', 11, 10, 'enemy-home');
    capturer.movementLeft = 7;
    caravan.movementLeft = 2;

    await expect(
      manager.executeUnitAction(capturer.id, ActionType.CAPTURE_UNITS, 11, 10, attackerId)
    ).resolves.toMatchObject({
      success: true,
      affectedUnitIds: [caravan.id],
      newMovementLeft: 1,
    });
    expect(capturer.movementLeft).toBe(1);
    expect(caravan).toMatchObject({
      playerId: attackerId,
      homeCityId: 'home-city',
      movementLeft: 2,
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/actions.c:249-257
   * @reference reference/freeciv/server/unithand.c:282-496
   * @assertion Once a C2C3 Capturable, non-transporting unit makes the foreign stack legal, Capture Units transfers every foreign unit on that stack rather than only the qualifying target.
   * @c2c3-action Capture Units
   * @c2c3-scenario normal
   */
  it('captures the complete foreign stack after a Capturable unit enables the action', async () => {
    const { manager } = createManager();
    manager.setHostilityProvider(async () => true);
    const capturer = await manager.createUnit(attackerId, 'warriors', 10, 10, 'home-city');
    const escort = await manager.createUnit(defenderId, 'warriors', 11, 10, 'enemy-home');
    const caravan = await manager.createUnit(defenderId, 'caravan', 11, 10, 'enemy-home');

    await expect(
      manager.executeUnitAction(capturer.id, ActionType.CAPTURE_UNITS, 11, 10, attackerId)
    ).resolves.toMatchObject({
      success: true,
      affectedUnitIds: [escort.id, caravan.id],
    });
    expect(escort.playerId).toBe(attackerId);
    expect(caravan.playerId).toBe(attackerId);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/actions.c:249-257
   * @assertion Capture Units rejects a target stack containing even one domestic unit.
   * @c2c3-action Capture Units
   * @c2c3-scenario rejected
   */
  it('rejects a c2c3 Capture Units stack containing a domestic unit', async () => {
    const { manager } = createManager();
    manager.setHostilityProvider(async () => true);
    const capturer = await manager.createUnit(attackerId, 'warriors', 10, 10, 'home-city');
    const caravan = await manager.createUnit(defenderId, 'caravan', 11, 10, 'enemy-home');
    await manager.createUnit(attackerId, 'warriors', 11, 10, 'home-city');

    await expect(
      manager.executeUnitAction(capturer.id, ActionType.CAPTURE_UNITS, 11, 10, attackerId)
    ).resolves.toMatchObject({ success: false });
    expect(caravan.playerId).toBe(defenderId);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:681-695
   * @assertion Capture Units rejects a foreign Capturable target when the required state of War is absent.
   * @c2c3-action Capture Units
   * @c2c3-scenario rejected
   */
  it('rejects Capture Units outside C2C3 war', async () => {
    const { manager } = createManager();
    manager.setHostilityProvider(async () => false);
    const capturer = await manager.createUnit(attackerId, 'warriors', 10, 10, 'home-city');
    const caravan = await manager.createUnit(defenderId, 'caravan', 11, 10, 'enemy-home');

    await expect(
      manager.executeUnitAction(capturer.id, ActionType.CAPTURE_UNITS, 11, 10, attackerId)
    ).resolves.toMatchObject({ success: false });
    expect(caravan.playerId).toBe(defenderId);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:690-695
   * @assertion Capture Units rejects a Capturable unit on a city-center tile.
   * @c2c3-action Capture Units
   * @c2c3-scenario rejected
   */
  it('rejects Capture Units on a C2C3 city center', async () => {
    const { manager } = createManager({
      cityAt: (x, y) => (x === 11 && y === 10 ? { id: 'city-1', playerId: defenderId } : null),
    });
    manager.setHostilityProvider(async () => true);
    const capturer = await manager.createUnit(attackerId, 'warriors', 10, 10, 'home-city');
    const caravan = await manager.createUnit(defenderId, 'caravan', 11, 10, 'enemy-home');

    await expect(
      manager.executeUnitAction(capturer.id, ActionType.CAPTURE_UNITS, 11, 10, attackerId)
    ).resolves.toMatchObject({ success: false });
    expect(caravan.playerId).toBe(defenderId);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:827-870
   * @reference reference/freeciv/common/actions.c:817-825
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:4555-4573
   * @reference reference/freeciv/server/unittools.c:2646-2725
   * @assertion A native, non-missile C2C3 attacker can collect ransom from an adjacent all-ProvidesRansom barbarian stack, pays the six-fragment action cost, and forced-moves into the cleared tile.
   * @c2c3-action Collect Ransom
   * @c2c3-scenario normal, boundary
   */
  it('collects c2c3 ransom from an adjacent barbarian leader', async () => {
    const { manager, databaseProvider } = createManager();
    (databaseProvider.getDatabase() as any).query.players.findFirst.mockResolvedValue({
      nation: 'barbarian',
      civilization: 'Barbarian',
      gold: 500,
    });
    manager.setHostilityProvider(async () => true);
    const collector = await manager.createUnit(attackerId, 'warriors', 10, 10);
    const leader = await manager.createUnit(barbarianId, 'barbarian_leader', 11, 10);
    collector.movementLeft = 7;

    await expect(
      manager.executeUnitAction(collector.id, ActionType.COLLECT_RANSOM, 11, 10, attackerId)
    ).resolves.toMatchObject({
      success: true,
      targetDestroyed: true,
      affectedUnitIds: [leader.id],
      newMovementLeft: 1,
      newPosition: { x: 11, y: 10 },
    });
    expect(collector).toMatchObject({ movementLeft: 1, x: 11, y: 10 });
    expect(manager.getUnit(leader.id)).toBeUndefined();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:827-870
   * @reference reference/freeciv/data/civ2civ3/units.ruleset:421-423
   * @assertion Collect Ransom rejects a barbarian leader protected by a unit without ProvidesRansom.
   * @c2c3-action Collect Ransom
   * @c2c3-scenario rejected
   */
  it('rejects a protected c2c3 ransom stack', async () => {
    const { manager, databaseProvider } = createManager();
    (databaseProvider.getDatabase() as any).query.players.findFirst.mockResolvedValue({
      nation: 'barbarian',
      civilization: 'Barbarian',
      gold: 500,
    });
    manager.setHostilityProvider(async () => true);
    const collector = await manager.createUnit(attackerId, 'warriors', 10, 10);
    const leader = await manager.createUnit(barbarianId, 'barbarian_leader', 11, 10);
    const escort = await manager.createUnit(barbarianId, 'warriors', 11, 10);

    await expect(
      manager.executeUnitAction(collector.id, ActionType.COLLECT_RANSOM, 11, 10, attackerId)
    ).resolves.toMatchObject({ success: false });
    expect(manager.getUnit(leader.id)).toBeDefined();
    expect(manager.getUnit(escort.id)).toBeDefined();
  });
});
