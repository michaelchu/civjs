import { UnitManager } from '@game/managers/UnitManager';
import { EffectsManager } from '@game/managers/EffectsManager';
import { ActionType } from '@app-types/shared/actions';
import { MapTopology, TopologyFlag } from '@game/map/MapTopology';
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('Civ2Civ3 city utility actions', () => {
  const gameId = 'c2c3-utility-actions';
  const playerId = 'player-1';
  const width = 20;
  const height = 20;

  function createManager(
    options: {
      cityAt?: (x: number, y: number) => { id: string; playerId: string } | null;
      executeCityUnitAction?: jest.Mock;
    } = {}
  ) {
    const databaseProvider = createMockDatabaseProvider();
    const executeCityUnitAction =
      options.executeCityUnitAction ??
      jest.fn().mockResolvedValue({ success: true, unitDestroyed: true });
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
        executeCityUnitAction,
      },
      new EffectsManager('civ2civ3'),
      undefined,
      rulesetUnitsService.getUnitTypes('civ2civ3')
    );
    return { manager, executeCityUnitAction };
  }

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:648-663
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:130-138
   * @reference reference/freeciv/common/actions.c:245-254
   * @assertion A HelpWonder Caravan at exactly one movement fragment can contribute to a friendly adjacent Great Wonder and is consumed.
   * @c2c3-action Help Wonder
   * @c2c3-scenario normal, boundary
   */
  it('performs Help Wonder at the c2c3 range and movement boundary', async () => {
    const { manager, executeCityUnitAction } = createManager({
      cityAt: (x, y) => (x === 10 && y === 9 ? { id: 'wonder-city', playerId } : null),
    });
    const caravan = await manager.createUnit(playerId, 'caravan', 10, 10, 'home-city');
    caravan.movementLeft = 1;

    await expect(
      manager.executeUnitAction(caravan.id, ActionType.HELP_WONDER, 10, 9, playerId)
    ).resolves.toMatchObject({ success: true, unitDestroyed: true });
    expect(executeCityUnitAction).toHaveBeenCalledWith(
      ActionType.HELP_WONDER,
      playerId,
      'caravan',
      'home-city',
      10,
      9
    );
    expect(manager.getUnit(caravan.id)).toBeUndefined();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:648-663
   * @assertion Help Wonder is unavailable after the Caravan no longer satisfies MinMoveFrags 1.
   * @c2c3-action Help Wonder
   * @c2c3-scenario rejected
   */
  it('rejects Help Wonder without a c2c3 movement fragment', async () => {
    const { manager, executeCityUnitAction } = createManager({
      cityAt: (x, y) => (x === 10 && y === 9 ? { id: 'wonder-city', playerId } : null),
    });
    const caravan = await manager.createUnit(playerId, 'caravan', 10, 10, 'home-city');
    caravan.movementLeft = 0;

    await expect(
      manager.executeUnitAction(caravan.id, ActionType.HELP_WONDER, 10, 9, playerId)
    ).resolves.toMatchObject({ success: false });
    expect(executeCityUnitAction).not.toHaveBeenCalled();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:648-663
   * @reference reference/freeciv/common/player.c:1523-1565
   * @assertion Help Wonder accepts an allied C2C3 city but rejects the same target once the relation is Peace.
   * @c2c3-action Help Wonder
   * @c2c3-scenario normal, rejected
   */
  it('allows an allied c2c3 city to receive wonder help', async () => {
    const { manager, executeCityUnitAction } = createManager({
      cityAt: (x, y) => (x === 10 && y === 9 ? { id: 'ally-city', playerId: 'player-2' } : null),
    });
    manager.setDiplomaticStateLookup(() => 'alliance');
    const caravan = await manager.createUnit(playerId, 'caravan', 10, 10, 'home-city');

    await expect(
      manager.executeUnitAction(caravan.id, ActionType.HELP_WONDER, 10, 9, playerId)
    ).resolves.toMatchObject({ success: true, unitDestroyed: true });
    expect(executeCityUnitAction).toHaveBeenCalledWith(
      ActionType.HELP_WONDER,
      playerId,
      'caravan',
      'home-city',
      10,
      9
    );

    const rejected = createManager({
      cityAt: (x, y) => (x === 10 && y === 9 ? { id: 'peace-city', playerId: 'player-2' } : null),
    });
    rejected.manager.setDiplomaticStateLookup(() => 'peace');
    const peacefulCaravan = await rejected.manager.createUnit(
      playerId,
      'caravan',
      10,
      10,
      'home-city'
    );
    await expect(
      rejected.manager.executeUnitAction(
        peacefulCaravan.id,
        ActionType.HELP_WONDER,
        11,
        10,
        playerId
      )
    ).resolves.toMatchObject({ success: false });
    expect(rejected.executeCityUnitAction).not.toHaveBeenCalled();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:664-674
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:143-151
   * @reference reference/freeciv/common/actions.c:368-384
   * @assertion A non-EvacuateFirst unit may recover its shields in a friendly adjacent city even with zero movement remaining.
   * @c2c3-action Disband Unit Recover
   * @c2c3-scenario normal, boundary
   */
  it('recovers a c2c3 unit in an adjacent friendly city without movement', async () => {
    const { manager, executeCityUnitAction } = createManager({
      cityAt: (x, y) => (x === 10 && y === 9 ? { id: 'city-1', playerId } : null),
    });
    const caravan = await manager.createUnit(playerId, 'caravan', 10, 10, 'home-city');
    caravan.movementLeft = 0;

    await expect(
      manager.executeUnitAction(caravan.id, ActionType.DISBAND_UNIT_RECOVER, 10, 9, playerId)
    ).resolves.toMatchObject({ success: true, unitDestroyed: true });
    expect(executeCityUnitAction).toHaveBeenCalledWith(
      ActionType.DISBAND_UNIT_RECOVER,
      playerId,
      'caravan',
      'home-city',
      10,
      9
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:664-674
   * @assertion Disband Unit Recover rejects the C2C3 EvacuateFirst Leader actor.
   * @c2c3-action Disband Unit Recover
   * @c2c3-scenario rejected
   */
  it('rejects recovery disband for a c2c3 EvacuateFirst leader', async () => {
    const { manager, executeCityUnitAction } = createManager({
      cityAt: (x, y) => (x === 10 && y === 9 ? { id: 'city-1', playerId } : null),
    });
    const leader = await manager.createUnit(playerId, 'leader', 10, 10);

    await expect(
      manager.executeUnitAction(leader.id, ActionType.DISBAND_UNIT_RECOVER, 10, 9, playerId)
    ).resolves.toMatchObject({ success: false });
    expect(executeCityUnitAction).not.toHaveBeenCalled();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:675-681
   * @reference reference/freeciv/common/actions.c:374-384
   * @assertion A normal C2C3 unit can disband itself with no movement requirement, including at zero remaining fragments.
   * @c2c3-action Disband Unit
   * @c2c3-scenario normal, boundary
   */
  it('disbands a c2c3 warrior at zero movement', async () => {
    const { manager } = createManager();
    const warrior = await manager.createUnit(playerId, 'warriors', 10, 10);
    warrior.movementLeft = 0;

    await expect(
      manager.executeUnitAction(warrior.id, ActionType.DISBAND_UNIT, undefined, undefined, playerId)
    ).resolves.toMatchObject({ success: true, unitDestroyed: true });
    expect(manager.getUnit(warrior.id)).toBeUndefined();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:675-681
   * @assertion Disband Unit rejects the C2C3 EvacuateFirst Leader actor.
   * @c2c3-action Disband Unit
   * @c2c3-scenario rejected
   */
  it('rejects normal disband for a c2c3 EvacuateFirst leader', async () => {
    const { manager } = createManager();
    const leader = await manager.createUnit(playerId, 'leader', 10, 10);

    await expect(
      manager.executeUnitAction(leader.id, ActionType.DISBAND_UNIT, undefined, undefined, playerId)
    ).resolves.toMatchObject({ success: false });
    expect(manager.getUnit(leader.id)).toBeDefined();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:756-764
   * @reference reference/freeciv/common/actions.c:255-264
   * @assertion An AddToCity C2C3 Settler can join a friendly adjacent city at exactly one movement fragment and is consumed.
   * @c2c3-action Join City
   * @c2c3-scenario normal, boundary
   */
  it('joins a c2c3 settler to an adjacent friendly city', async () => {
    const { manager, executeCityUnitAction } = createManager({
      cityAt: (x, y) => (x === 10 && y === 9 ? { id: 'city-1', playerId } : null),
    });
    const settler = await manager.createUnit(playerId, 'settlers', 10, 10, 'home-city');
    settler.movementLeft = 1;

    await expect(
      manager.executeUnitAction(settler.id, ActionType.JOIN_CITY, 10, 9, playerId)
    ).resolves.toMatchObject({ success: true, unitDestroyed: true });
    expect(executeCityUnitAction).toHaveBeenCalledWith(
      ActionType.JOIN_CITY,
      playerId,
      'settlers',
      'home-city',
      10,
      9
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:756-764
   * @assertion Join City rejects a target foreign city under C2C3's non-Foreign relation requirement.
   * @c2c3-action Join City
   * @c2c3-scenario rejected
   */
  it('rejects joining a c2c3 settler to a foreign city', async () => {
    const { manager, executeCityUnitAction } = createManager({
      cityAt: (x, y) => (x === 10 && y === 9 ? { id: 'foreign-city', playerId: 'player-2' } : null),
    });
    const settler = await manager.createUnit(playerId, 'settlers', 10, 10, 'home-city');

    await expect(
      manager.executeUnitAction(settler.id, ActionType.JOIN_CITY, 10, 9, playerId)
    ).resolves.toMatchObject({ success: false });
    expect(executeCityUnitAction).not.toHaveBeenCalled();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:916-940
   * @reference reference/freeciv/common/actions.c:386-395
   * @reference reference/freeciv/server/unithand.c:4198-4222
   * @assertion The C2C3 Diplomat Home City alternate enabler permits a homeless Diplomat to rehome in its friendly current city without spending movement.
   * @c2c3-action Home City
   * @c2c3-scenario normal, boundary
   */
  it('rehomes a homeless c2c3 diplomat without consuming movement', async () => {
    const { manager } = createManager({
      cityAt: (x, y) => (x === 10 && y === 10 ? { id: 'city-2', playerId } : null),
    });
    const diplomat = await manager.createUnit(playerId, 'diplomat', 10, 10);
    diplomat.movementLeft = 0;

    await expect(
      manager.executeUnitAction(diplomat.id, ActionType.CHANGE_HOME_CITY, 10, 10, playerId)
    ).resolves.toMatchObject({ success: true });
    expect(diplomat).toMatchObject({ homeCityId: 'city-2', movementLeft: 0 });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:916-940
   * @assertion Home City rejects a C2C3 NoHome Leader that is not a Diplomat alternate actor.
   * @c2c3-action Home City
   * @c2c3-scenario rejected
   */
  it('rejects rehoming a c2c3 NoHome leader', async () => {
    const { manager } = createManager({
      cityAt: (x, y) => (x === 10 && y === 10 ? { id: 'city-2', playerId } : null),
    });
    const leader = await manager.createUnit(playerId, 'leader', 10, 10);

    await expect(
      manager.executeUnitAction(leader.id, ActionType.CHANGE_HOME_CITY, 10, 10, playerId)
    ).resolves.toMatchObject({ success: false });
    expect(leader.homeCityId).toBeUndefined();
  });
});
