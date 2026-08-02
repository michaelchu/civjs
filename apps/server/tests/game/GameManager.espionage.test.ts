import { GameManager } from '@game/managers/GameManager';
import { ActionType } from '@app-types/shared/actions';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';
import { GoldSpendingType } from '@game/systems/Economic/types/EconomicTypes';

describe('GameManager classic espionage actions', () => {
  const gameId = 'game-1';
  const actorPlayerId = 'player-1';
  const targetPlayerId = 'player-2';
  const mockIo = { to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() } as any;
  let manager: GameManager;

  beforeEach(() => {
    (GameManager as any).instance = null;
    manager = GameManager.getInstance(mockIo, createMockDatabaseProvider());
    (manager as any).diplomacyManager = {
      establishContact: jest.fn(),
      establishEmbassy: jest.fn(),
      getSnapshot: jest.fn().mockResolvedValue({
        nations: [{ id: targetPlayerId, relation: { state: 'war' } }],
      }),
      recordIncident: jest.fn(),
    };
    (manager as any).gameBroadcastManager = {
      broadcastCityData: jest.fn(),
      broadcastUnitInfo: jest.fn(),
      broadcastUnitDestroyed: jest.fn(),
    };
  });

  afterEach(() => manager.clearAllGames());

  function installGame(
    actorType: 'diplomat' | 'spy' | 'explorer',
    overrides: Record<string, unknown> = {}
  ) {
    const actor = {
      id: 'actor',
      gameId,
      playerId: actorPlayerId,
      unitTypeId: actorType,
      x: 4,
      y: 5,
      movementLeft: 3,
      health: 100,
      veteranLevel: 0,
      experience: 0,
      fortified: false,
      homeCityId: 'actor-home',
    };
    const economicManager = {
      getPlayerGold: jest.fn().mockResolvedValue(100),
      spendPlayerGold: jest.fn().mockResolvedValue({ success: true, newBalance: 900 }),
    };
    const game = {
      id: gameId,
      currentTurn: 12,
      random: { next: jest.fn().mockReturnValue(0) },
      players: new Map(),
      visibilityManager: { updateAllPlayersVisibility: jest.fn() },
      mapManager: { getDistance: jest.fn() },
      unitManager: {
        getUnit: jest.fn().mockReturnValue(actor),
        getUnitsAt: jest.fn().mockReturnValue([]),
        getPlayerUnits: jest.fn().mockReturnValue([]),
        removeUnit: jest.fn(),
        finishDiplomatMission: jest.fn(),
        finishBribeMission: jest.fn(),
        maybePromoteAfterDiplomaticAction: jest.fn().mockResolvedValue(false),
        bribeUnit: jest.fn(),
        sabotageUnit: jest.fn(),
      },
      cityManager: {
        getCityAt: jest.fn(),
        getPlayerCities: jest.fn().mockReturnValue([]),
        poisonCity: jest.fn(),
        sabotageCityBuilding: jest.fn(),
        transferCity: jest.fn(),
      },
      researchManager: {
        getResearchedTechs: jest.fn().mockReturnValue([]),
        grantTechnology: jest.fn(),
      },
      turnManager: { getEconomicManager: jest.fn().mockReturnValue(economicManager) },
      governmentManager: { getPlayerGovernment: jest.fn() },
      ...overrides,
    };
    (manager as any).games.set(gameId, game);
    return { actor, game: game as any, economicManager };
  }

  function foreignCity(overrides: Record<string, unknown> = {}) {
    return {
      id: 'city-1',
      name: 'Target',
      playerId: targetPlayerId,
      x: 5,
      y: 5,
      size: 3,
      buildings: [],
      happiness: { happy: 0, content: 3, unhappy: 0, angry: 0 },
      productionStock: 0,
      ...overrides,
    };
  }

  function setRelation(state: string, embassy = false): void {
    (manager as any).diplomacyManager.getSnapshot.mockResolvedValue({
      nations: [{ id: targetPlayerId, relation: { state, embassy } }],
    });
  }

  it('poisons a size-two enemy city only while at war', async () => {
    const city = {
      id: 'city-1',
      name: 'Target',
      playerId: targetPlayerId,
      x: 5,
      y: 5,
      size: 2,
      buildings: [],
    };
    const { game } = installGame('spy');
    game.cityManager.getCityAt.mockReturnValue(city);

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.POISON_WATER, 5, 5)
    ).resolves.toMatchObject({ success: true });
    expect(game.cityManager.poisonCity).toHaveBeenCalledWith(city.id, actorPlayerId);
    expect(game.unitManager.maybePromoteAfterDiplomaticAction).toHaveBeenCalledWith('actor');
    expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
      'actor',
      'Poison City Escape'
    );
  });

  it('applies interception before a covert city mutation', async () => {
    const city = {
      id: 'city-1',
      name: 'Target',
      playerId: targetPlayerId,
      x: 5,
      y: 5,
      size: 2,
      buildings: [],
    };
    const { game } = installGame('spy');
    game.cityManager.getCityAt.mockReturnValue(city);
    game.unitManager.resolveDiplomatAction = jest.fn().mockReturnValue({
      success: false,
      actorSurvives: false,
      successChance: 75,
      escapeChance: 75,
    });

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.POISON_WATER, 5, 5)
    ).resolves.toMatchObject({ success: false, unitDestroyed: true });
    expect(game.cityManager.poisonCity).not.toHaveBeenCalled();
    expect(game.unitManager.removeUnit).toHaveBeenCalledWith('actor');
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:449-461
   * @reference reference/freeciv/common/actions.c:177-186
   * @reference reference/freeciv/server/diplomats.c:476-541
   * @assertion The distinct c2c3 Explorer enabler may also perform Establish Embassy Stay, creating the same real embassy and consuming the explorer actor.
   * @c2c3-action Establish Embassy Stay
   * @c2c3-scenario boundary
   * @c2c3-surface diplomacy-espionage
   * @c2c3-surface-scenario boundary
   */
  it('accepts the c2c3 Explorer alternate embassy actor', async () => {
    const city = {
      id: 'city-1',
      name: 'Target',
      playerId: targetPlayerId,
      x: 5,
      y: 5,
      size: 3,
      buildings: [],
    };
    const { game } = installGame('explorer');
    game.cityManager.getCityAt.mockReturnValue(city);

    await expect(
      manager.executeDiplomatAction(
        gameId,
        actorPlayerId,
        'actor',
        ActionType.ESTABLISH_EMBASSY,
        5,
        5
      )
    ).resolves.toMatchObject({ success: true, unitDestroyed: true });

    expect((manager as any).diplomacyManager.establishEmbassy).toHaveBeenCalledWith(
      gameId,
      actorPlayerId,
      targetPlayerId
    );
    expect(game.unitManager.removeUnit).toHaveBeenCalledWith('actor');
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:421-433
   * @assertion Establish Embassy Stay is unavailable after the acting player already has a real embassy with the target nation.
   * @c2c3-action Establish Embassy Stay
   * @c2c3-scenario rejected
   * @c2c3-surface diplomacy-espionage
   * @c2c3-surface-scenario boundary
   */
  it('rejects a duplicate c2c3 embassy before consuming the actor', async () => {
    const city = {
      id: 'city-1',
      name: 'Target',
      playerId: targetPlayerId,
      x: 5,
      y: 5,
      size: 3,
      buildings: [],
    };
    const { game } = installGame('diplomat');
    game.cityManager.getCityAt.mockReturnValue(city);
    (manager as any).diplomacyManager.getSnapshot.mockResolvedValue({
      nations: [{ id: targetPlayerId, relation: { state: 'war', embassy: true } }],
    });

    await expect(
      manager.executeDiplomatAction(
        gameId,
        actorPlayerId,
        'actor',
        ActionType.ESTABLISH_EMBASSY,
        5,
        5
      )
    ).resolves.toMatchObject({
      success: false,
      message: 'A real embassy already exists with this nation',
    });

    expect((manager as any).diplomacyManager.establishEmbassy).not.toHaveBeenCalled();
    expect(game.unitManager.removeUnit).not.toHaveBeenCalled();
  });

  it('uses a Super Spy as the city defender even without the Diplomat flag', async () => {
    const city = {
      id: 'city-1',
      name: 'Target',
      playerId: targetPlayerId,
      x: 5,
      y: 5,
      size: 2,
      buildings: [],
    };
    const { game } = installGame('spy');
    const superSpy = {
      id: 'super-spy',
      playerId: targetPlayerId,
      unitTypeId: 'leader',
      x: 5,
      y: 5,
      movementLeft: 3,
      health: 100,
      veteranLevel: 0,
      experience: 0,
      fortified: false,
    };
    game.cityManager.getCityAt.mockReturnValue(city);
    game.unitManager.getUnitsAt.mockReturnValue([superSpy]);
    game.unitManager.resolveDiplomatAction = jest.fn().mockReturnValue({
      success: true,
      actorSurvives: true,
    });

    await manager.executeDiplomatAction(
      gameId,
      actorPlayerId,
      'actor',
      ActionType.POISON_WATER,
      5,
      5
    );

    expect(game.unitManager.resolveDiplomatAction).toHaveBeenCalledWith(
      'actor',
      ActionType.POISON_WATER,
      'super-spy'
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:421-433
   * @reference reference/freeciv/common/actions.c:177-186
   * @reference reference/freeciv/server/diplomats.c:476-541
   * @assertion The c2c3 Diplomat-only Establish Embassy Stay action creates a real embassy in an adjacent foreign city and consumes its actor.
   * @c2c3-action Establish Embassy Stay
   * @c2c3-scenario normal
   * @c2c3-surface diplomacy-espionage
   * @c2c3-surface-scenario normal
   */
  it('creates a real embassy and consumes the c2c3 diplomat actor', async () => {
    const city = {
      id: 'city-1',
      name: 'Target',
      playerId: targetPlayerId,
      x: 5,
      y: 5,
      size: 3,
      buildings: [],
    };
    const { game } = installGame('diplomat');
    game.cityManager.getCityAt.mockReturnValue(city);

    await expect(
      manager.executeDiplomatAction(
        gameId,
        actorPlayerId,
        'actor',
        ActionType.ESTABLISH_EMBASSY,
        5,
        5
      )
    ).resolves.toMatchObject({ success: true, unitDestroyed: true });

    expect((manager as any).diplomacyManager.establishContact).toHaveBeenCalledWith(
      gameId,
      actorPlayerId,
      targetPlayerId
    );
    expect((manager as any).diplomacyManager.establishEmbassy).toHaveBeenCalledWith(
      gameId,
      actorPlayerId,
      targetPlayerId
    );
    expect(game.unitManager.removeUnit).toHaveBeenCalledWith('actor');
  });

  it('bribes a lone eligible unit and charges the calculated cost', async () => {
    const target = {
      id: 'target',
      gameId,
      playerId: targetPlayerId,
      unitTypeId: 'warriors',
      x: 5,
      y: 5,
      movementLeft: 3,
      health: 100,
      veteranLevel: 0,
      experience: 0,
      fortified: false,
    };
    const { game, economicManager } = installGame('diplomat');
    game.unitManager.getUnitsAt.mockReturnValue([target]);
    game.cityManager.getCityAt.mockReturnValue(undefined);

    const result = await manager.executeDiplomatAction(
      gameId,
      actorPlayerId,
      'actor',
      ActionType.BRIBE_UNIT,
      5,
      5
    );

    expect(result).toMatchObject({ success: true });
    expect(result.unitDestroyed).toBeUndefined();
    expect(economicManager.spendPlayerGold).toHaveBeenCalledWith(
      actorPlayerId,
      25,
      'Bribed warriors',
      { unitId: target.id, turn: 12 },
      GoldSpendingType.DIPLOMACY
    );
    expect(game.unitManager.bribeUnit).toHaveBeenCalledWith(target.id, actorPlayerId, 'actor-home');
    expect(game.unitManager.finishBribeMission).toHaveBeenCalledWith('actor', 5, 5);
  });

  it('rejects bribing an Unbribable unit without charging gold', async () => {
    const target = {
      id: 'target-leader',
      playerId: targetPlayerId,
      unitTypeId: 'leader',
      x: 5,
      y: 5,
      health: 100,
    };
    const { game, economicManager } = installGame('diplomat');
    game.unitManager.getUnitsAt.mockReturnValue([target]);

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.BRIBE_UNIT, 5, 5)
    ).resolves.toMatchObject({ success: false, message: 'That unit cannot be bribed' });
    expect(economicManager.spendPlayerGold).not.toHaveBeenCalled();
  });

  it('prevents a Diplomat from stealing repeatedly from the same city', async () => {
    const city = {
      id: 'city-1',
      name: 'Target',
      playerId: targetPlayerId,
      x: 5,
      y: 5,
      size: 3,
      buildings: [],
    };
    const thefts = new Map<string, number>();
    const { game } = installGame('diplomat', {
      cityManager: {
        getCityAt: jest.fn().mockReturnValue(city),
        getPlayerCities: jest.fn().mockReturnValue([]),
        getEspionageTheftCount: jest.fn(
          (cityId: string, playerId: string) => thefts.get(`${cityId}:${playerId}`) ?? 0
        ),
        recordEspionageTheft: jest.fn(async (cityId: string, playerId: string) => {
          const key = `${cityId}:${playerId}`;
          thefts.set(key, (thefts.get(key) ?? 0) + 1);
        }),
        poisonCity: jest.fn(),
        sabotageCityBuilding: jest.fn(),
        transferCity: jest.fn(),
      },
      researchManager: {
        getResearchedTechs: jest.fn((playerId: string) =>
          playerId === targetPlayerId ? ['alphabet'] : []
        ),
        grantTechnology: jest.fn(),
      },
    });

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.STEAL_TECH, 5, 5)
    ).resolves.toMatchObject({ success: true });
    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.STEAL_TECH, 5, 5)
    ).resolves.toMatchObject({
      success: false,
      message: 'This city has already been targeted by this diplomat',
    });
    expect(game.researchManager.grantTechnology).toHaveBeenCalledTimes(1);
  });

  it('allows a Spy to make a repeat technology theft attempt', async () => {
    const city = {
      id: 'city-1',
      name: 'Target',
      playerId: targetPlayerId,
      x: 5,
      y: 5,
      size: 3,
      buildings: [],
    };
    const theftCount = jest.fn().mockReturnValue(1);
    const { game } = installGame('spy', {
      cityManager: {
        getCityAt: jest.fn().mockReturnValue(city),
        getPlayerCities: jest.fn().mockReturnValue([]),
        getEspionageTheftCount: theftCount,
        recordEspionageTheft: jest.fn(),
        poisonCity: jest.fn(),
        sabotageCityBuilding: jest.fn(),
        transferCity: jest.fn(),
      },
      researchManager: {
        getResearchedTechs: jest.fn((playerId: string) =>
          playerId === targetPlayerId ? ['alphabet'] : []
        ),
        grantTechnology: jest.fn(),
      },
    });

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.STEAL_TECH, 5, 5)
    ).resolves.toMatchObject({ success: true });
    expect(theftCount).toHaveBeenCalledWith(city.id, actorPlayerId);
    expect(game.researchManager.grantTechnology).toHaveBeenCalledTimes(1);
  });

  it('honors a validated targeted technology selection', async () => {
    const city = {
      id: 'city-1',
      name: 'Target',
      playerId: targetPlayerId,
      x: 5,
      y: 5,
      size: 3,
      buildings: [],
    };
    const { game } = installGame('spy', {
      cityManager: {
        getCityAt: jest.fn().mockReturnValue(city),
        getPlayerCities: jest.fn().mockReturnValue([]),
        getEspionageTheftCount: jest.fn().mockReturnValue(0),
        recordEspionageTheft: jest.fn(),
        poisonCity: jest.fn(),
        sabotageCityBuilding: jest.fn(),
        transferCity: jest.fn(),
      },
      researchManager: {
        getResearchedTechs: jest.fn((playerId: string) =>
          playerId === targetPlayerId ? ['alphabet', 'bronze_working'] : []
        ),
        grantTechnology: jest.fn(),
      },
    });

    await expect(
      manager.executeDiplomatAction(
        gameId,
        actorPlayerId,
        'actor',
        ActionType.STEAL_TECH,
        5,
        5,
        'bronze_working'
      )
    ).resolves.toMatchObject({ success: true, message: expect.stringContaining('bronze_working') });
    expect(game.researchManager.grantTechnology).toHaveBeenCalledWith(
      actorPlayerId,
      'bronze_working'
    );
  });

  it('honors a validated targeted city improvement selection', async () => {
    const city = {
      id: 'city-1',
      name: 'Target',
      playerId: targetPlayerId,
      x: 5,
      y: 5,
      size: 3,
      buildings: ['library', 'marketplace'],
    };
    const sabotageCityBuilding = jest.fn().mockResolvedValue('marketplace');
    installGame('spy', {
      cityManager: {
        getCityAt: jest.fn().mockReturnValue(city),
        getPlayerCities: jest.fn().mockReturnValue([]),
        getEspionageTheftCount: jest.fn().mockReturnValue(0),
        recordEspionageTheft: jest.fn(),
        poisonCity: jest.fn(),
        sabotageCityBuilding,
        transferCity: jest.fn(),
      },
    });

    await expect(
      manager.executeDiplomatAction(
        gameId,
        actorPlayerId,
        'actor',
        ActionType.SABOTAGE_CITY,
        5,
        5,
        undefined,
        'marketplace'
      )
    ).resolves.toMatchObject({ success: true, message: expect.stringContaining('marketplace') });
    expect(sabotageCityBuilding).toHaveBeenCalledWith(city.id, actorPlayerId, 'marketplace');
  });

  it('returns authoritative selectable technology and improvement targets', () => {
    const city = {
      id: 'city-1',
      name: 'Target',
      playerId: targetPlayerId,
      x: 5,
      y: 5,
      size: 3,
      buildings: ['palace', 'library', 'marketplace'],
    };
    installGame('spy', {
      cityManager: {
        getCityAt: jest.fn().mockReturnValue(city),
        getPlayerCities: jest.fn().mockReturnValue([]),
        sabotageCityBuilding: jest.fn(),
        transferCity: jest.fn(),
      },
      researchManager: {
        getResearchedTechs: jest.fn((playerId: string) =>
          playerId === targetPlayerId ? ['alphabet', 'bronze_working'] : ['alphabet']
        ),
      },
    });

    expect(
      manager.getDiplomatActionOptions(gameId, actorPlayerId, 'actor', ActionType.STEAL_TECH, 5, 5)
    ).toEqual({
      success: true,
      options: [{ id: 'bronze_working', label: 'bronze_working' }],
    });
    expect(
      manager.getDiplomatActionOptions(
        gameId,
        actorPlayerId,
        'actor',
        ActionType.SABOTAGE_CITY,
        5,
        5
      )
    ).toEqual({
      success: true,
      options: [
        { id: 'library', label: 'library' },
        { id: 'marketplace', label: 'marketplace' },
      ],
    });
  });

  it('sabotages a target city production stock with a spy', async () => {
    const city = {
      id: 'city-1',
      name: 'Target',
      playerId: targetPlayerId,
      x: 5,
      y: 5,
      size: 3,
      buildings: ['palace'],
      currentProduction: 'factory',
      productionStock: 42,
    };
    const sabotageCityProduction = jest.fn().mockResolvedValue('factory');
    const { game } = installGame('spy', {
      cityManager: {
        getCityAt: jest.fn().mockReturnValue(city),
        getPlayerCities: jest.fn().mockReturnValue([]),
        sabotageCityProduction,
        recordEspionageTheft: jest.fn(),
        transferCity: jest.fn(),
      },
    });

    await expect(
      manager.executeDiplomatAction(
        gameId,
        actorPlayerId,
        'actor',
        ActionType.SABOTAGE_CITY_PRODUCTION,
        5,
        5
      )
    ).resolves.toMatchObject({ success: true, message: expect.stringContaining('factory') });
    expect(sabotageCityProduction).toHaveBeenCalledWith(city.id, actorPlayerId);
    expect(game.cityManager.recordEspionageTheft).toHaveBeenCalledWith(city.id, actorPlayerId);
  });

  it('sabotages a lone unit for half its remaining health', async () => {
    const target = {
      id: 'target',
      playerId: targetPlayerId,
      unitTypeId: 'warriors',
      x: 5,
      y: 5,
      health: 80,
    };
    const { game } = installGame('spy');
    game.unitManager.getUnitsAt.mockReturnValue([target]);
    game.unitManager.sabotageUnit.mockResolvedValue({
      unit: { ...target, health: 40 },
      destroyed: false,
    });

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.SABOTAGE_UNIT, 5, 5)
    ).resolves.toMatchObject({ success: true, targetDestroyed: false });
    expect(game.unitManager.sabotageUnit).toHaveBeenCalledWith(target.id);
  });

  it('incites a non-capital city, charges gold, reduces size, and transfers ownership', async () => {
    const city = {
      id: 'city-1',
      name: 'Target',
      playerId: targetPlayerId,
      x: 5,
      y: 5,
      size: 3,
      buildings: [],
      happiness: { happy: 0, content: 3, unhappy: 0, angry: 0 },
      productionStock: 20,
    };
    const { game, economicManager } = installGame('spy');
    game.cityManager.getCityAt.mockReturnValue(city);
    game.researchManager.getResearchedTechs.mockImplementation((playerId: string) =>
      playerId === targetPlayerId ? ['alphabet'] : []
    );
    game.mapManager.getDistance.mockReturnValue(1);
    game.unitManager.getPlayerUnits.mockReturnValue([
      {
        id: 'defector',
        playerId: targetPlayerId,
        homeCityId: city.id,
        x: 6,
        y: 5,
      },
    ]);

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.INCITE_CITY, 5, 5)
    ).resolves.toMatchObject({ success: true, cityId: city.id });
    expect(economicManager.spendPlayerGold).toHaveBeenCalledWith(
      actorPlayerId,
      188,
      'Incited a revolt in Target',
      { cityId: city.id, turn: 12 },
      GoldSpendingType.DIPLOMACY
    );
    expect(game.cityManager.poisonCity).toHaveBeenCalledWith(city.id, actorPlayerId);
    expect(game.cityManager.transferCity).toHaveBeenCalledWith(city.id, actorPlayerId);
    expect(game.unitManager.bribeUnit).toHaveBeenCalledWith('defector', actorPlayerId, city.id);
    expect(game.researchManager.grantTechnology).toHaveBeenCalledWith(actorPlayerId, 'alphabet');
    expect(city.productionStock).toBe(0);
  });

  it('rejects inciting a capital without charging gold', async () => {
    const { game, economicManager } = installGame('spy');
    game.cityManager.getCityAt.mockReturnValue({
      id: 'capital',
      name: 'Capital',
      playerId: targetPlayerId,
      x: 5,
      y: 5,
      size: 5,
      buildings: ['palace'],
    });

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.INCITE_CITY, 5, 5)
    ).resolves.toMatchObject({ success: false, message: 'A capital cannot be incited' });
    expect(economicManager.spendPlayerGold).not.toHaveBeenCalled();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:435-447
   * @reference reference/freeciv/common/actions.c:177-186
   * @reference reference/freeciv/server/diplomats.c:476-541
   * @assertion A C2C3 Spy establishes an embassy without diplomatic combat, survives, and pays the source action's one-fragment cost.
   * @c2c3-action Establish Embassy
   * @c2c3-scenario normal
   */
  it('keeps a c2c3 spy alive when it establishes an embassy', async () => {
    const city = foreignCity();
    const { game } = installGame('spy');
    game.cityManager.getCityAt.mockReturnValue(city);
    game.unitManager.resolveDiplomatAction = jest.fn();

    await expect(
      manager.executeDiplomatAction(
        gameId,
        actorPlayerId,
        'actor',
        ActionType.ESTABLISH_EMBASSY,
        5,
        5
      )
    ).resolves.toMatchObject({ success: true });

    expect(game.unitManager.resolveDiplomatAction).not.toHaveBeenCalled();
    expect(game.unitManager.removeUnit).not.toHaveBeenCalled();
    expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
      'actor',
      'Establish Embassy'
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:435-447
   * @assertion Establish Embassy is disabled for a C2C3 barbarian target nation before the actor is consumed or its movement changes.
   * @c2c3-action Establish Embassy
   * @c2c3-scenario rejected
   */
  it('rejects establishing a c2c3 embassy in a barbarian city', async () => {
    const city = foreignCity();
    const { game } = installGame('spy', {
      players: new Map([[targetPlayerId, { id: targetPlayerId, nation: 'barbarian' }]]),
    });
    game.cityManager.getCityAt.mockReturnValue(city);

    await expect(
      manager.executeDiplomatAction(
        gameId,
        actorPlayerId,
        'actor',
        ActionType.ESTABLISH_EMBASSY,
        5,
        5
      )
    ).resolves.toMatchObject({
      success: false,
      message: 'This action cannot target a barbarian city',
    });
    expect(game.unitManager.removeUnit).not.toHaveBeenCalled();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:435-447
   * @assertion The MinMoveFrags 1 embassy enabler accepts exactly one remaining movement fragment.
   * @c2c3-action Establish Embassy
   * @c2c3-scenario boundary
   */
  it('accepts the c2c3 spy embassy boundary of one movement fragment', async () => {
    const city = foreignCity();
    const { actor, game } = installGame('spy');
    actor.movementLeft = 1;
    game.cityManager.getCityAt.mockReturnValue(city);

    await expect(
      manager.executeDiplomatAction(
        gameId,
        actorPlayerId,
        'actor',
        ActionType.ESTABLISH_EMBASSY,
        5,
        5
      )
    ).resolves.toMatchObject({ success: true });
    expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
      'actor',
      'Establish Embassy'
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:464-489
   * @reference reference/freeciv/common/actions.c:205-216
   * @reference reference/freeciv/server/diplomats.c:310-420
   * @assertion All three C2C3 Investigate City enablers report city details without diplomatic combat or consuming Diplomat, Spy, or Explorer actors.
   * @c2c3-action Investigate City
   * @c2c3-scenario normal
   */
  it('keeps every c2c3 investigate actor alive and out of diplomatic combat', async () => {
    for (const actorType of ['diplomat', 'spy', 'explorer'] as const) {
      const city = foreignCity({ buildings: ['library'] });
      const { game } = installGame(actorType);
      game.cityManager.getCityAt.mockReturnValue(city);
      game.unitManager.resolveDiplomatAction = jest.fn();

      await expect(
        manager.executeDiplomatAction(
          gameId,
          actorPlayerId,
          'actor',
          ActionType.INVESTIGATE_CITY,
          5,
          5
        )
      ).resolves.toMatchObject({
        success: true,
        message: expect.stringContaining('1 improvements'),
      });
      expect(game.unitManager.resolveDiplomatAction).not.toHaveBeenCalled();
      expect(game.unitManager.removeUnit).not.toHaveBeenCalled();
      expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
        'actor',
        'Investigate City'
      );
    }
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:464-489
   * @assertion Investigate City is unavailable once the actor no longer satisfies MinMoveFrags 1.
   * @c2c3-action Investigate City
   * @c2c3-scenario rejected
   */
  it('rejects c2c3 investigation with no movement left', async () => {
    const city = foreignCity();
    const { actor, game } = installGame('explorer');
    actor.movementLeft = 0;
    game.cityManager.getCityAt.mockReturnValue(city);

    await expect(
      manager.executeDiplomatAction(
        gameId,
        actorPlayerId,
        'actor',
        ActionType.INVESTIGATE_CITY,
        5,
        5
      )
    ).resolves.toMatchObject({ success: false, message: 'The diplomat has no movement remaining' });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:464-489
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:4517-4524
   * @assertion The exact one-fragment Investigate City boundary succeeds and retains the source action identity for its one-fragment cost.
   * @c2c3-action Investigate City
   * @c2c3-scenario boundary
   */
  it('accepts c2c3 investigation with exactly one movement fragment', async () => {
    const city = foreignCity();
    const { actor, game } = installGame('diplomat');
    actor.movementLeft = 1;
    game.cityManager.getCityAt.mockReturnValue(city);

    await expect(
      manager.executeDiplomatAction(
        gameId,
        actorPlayerId,
        'actor',
        ActionType.INVESTIGATE_CITY,
        5,
        5
      )
    ).resolves.toMatchObject({ success: true });
    expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
      'actor',
      'Investigate City'
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:491-518
   * @reference reference/freeciv/common/actions.c:187-196
   * @assertion The normal C2C3 Diplomat Steal Tech action chooses an available technology and consumes the non-spy actor.
   * @c2c3-action Steal Tech
   * @c2c3-scenario normal
   */
  it('performs the c2c3 random diplomat technology theft', async () => {
    const city = foreignCity();
    const { game } = installGame('diplomat', {
      cityManager: {
        getCityAt: jest.fn().mockReturnValue(city),
        getPlayerCities: jest.fn().mockReturnValue([]),
        getEspionageTheftCount: jest.fn().mockReturnValue(0),
        recordEspionageTheft: jest.fn(),
        sabotageCityBuilding: jest.fn(),
        transferCity: jest.fn(),
      },
      researchManager: {
        getResearchedTechs: jest.fn((playerId: string) =>
          playerId === targetPlayerId ? ['alphabet'] : []
        ),
        grantTechnology: jest.fn(),
      },
    });

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.STEAL_TECH, 5, 5)
    ).resolves.toMatchObject({ success: true, unitDestroyed: true });
    expect(game.researchManager.grantTechnology).toHaveBeenCalledWith(actorPlayerId, 'alphabet');
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:506-518
   * @reference reference/freeciv/common/actions.c:187-196
   * @assertion A Spy may repeat C2C3 random technology thefts and escapes after a successful action.
   * @c2c3-action Steal Tech Escape Expected
   * @c2c3-scenario normal
   */
  it('performs the c2c3 spy repeat technology theft', async () => {
    const city = foreignCity();
    const { game } = installGame('spy', {
      cityManager: {
        getCityAt: jest.fn().mockReturnValue(city),
        getPlayerCities: jest.fn().mockReturnValue([]),
        getEspionageTheftCount: jest.fn().mockReturnValue(1),
        recordEspionageTheft: jest.fn(),
        sabotageCityBuilding: jest.fn(),
        transferCity: jest.fn(),
      },
      researchManager: {
        getResearchedTechs: jest.fn((playerId: string) =>
          playerId === targetPlayerId ? ['alphabet'] : []
        ),
        grantTechnology: jest.fn(),
      },
    });

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.STEAL_TECH, 5, 5)
    ).resolves.toMatchObject({ success: true });
    expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
      'actor',
      'Steal Tech Escape Expected'
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:520-532
   * @reference reference/freeciv/common/actions.c:197-205
   * @assertion The C2C3 targeted theft action lets a Spy choose only an available technology and escapes after success.
   * @c2c3-action Targeted Steal Tech Escape Expected
   * @c2c3-scenario normal
   */
  it('performs a c2c3 targeted spy technology theft', async () => {
    const city = foreignCity();
    const { game } = installGame('spy', {
      cityManager: {
        getCityAt: jest.fn().mockReturnValue(city),
        getPlayerCities: jest.fn().mockReturnValue([]),
        getEspionageTheftCount: jest.fn().mockReturnValue(0),
        recordEspionageTheft: jest.fn(),
        sabotageCityBuilding: jest.fn(),
        transferCity: jest.fn(),
      },
      researchManager: {
        getResearchedTechs: jest.fn((playerId: string) =>
          playerId === targetPlayerId ? ['alphabet', 'bronze_working'] : []
        ),
        grantTechnology: jest.fn(),
      },
    });

    await expect(
      manager.executeDiplomatAction(
        gameId,
        actorPlayerId,
        'actor',
        ActionType.STEAL_TECH,
        5,
        5,
        'bronze_working'
      )
    ).resolves.toMatchObject({ success: true });
    expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
      'actor',
      'Targeted Steal Tech Escape Expected'
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:491-532
   * @assertion All C2C3 theft variants reject a request when the target has no technology unknown to the actor; targeted theft additionally rejects a non-Spy chooser.
   * @c2c3-action Steal Tech, Steal Tech Escape Expected, Targeted Steal Tech Escape Expected
   * @c2c3-scenario rejected
   */
  it('rejects unavailable c2c3 technology theft targets', async () => {
    for (const actorType of ['diplomat', 'spy'] as const) {
      const city = foreignCity();
      const { game } = installGame(actorType, {
        cityManager: {
          getCityAt: jest.fn().mockReturnValue(city),
          getPlayerCities: jest.fn().mockReturnValue([]),
          getEspionageTheftCount: jest.fn().mockReturnValue(0),
          recordEspionageTheft: jest.fn(),
          sabotageCityBuilding: jest.fn(),
          transferCity: jest.fn(),
        },
        researchManager: {
          getResearchedTechs: jest.fn().mockReturnValue(['alphabet']),
          grantTechnology: jest.fn(),
        },
      });

      await expect(
        manager.executeDiplomatAction(
          gameId,
          actorPlayerId,
          'actor',
          ActionType.STEAL_TECH,
          5,
          5,
          actorType === 'spy' ? 'alphabet' : undefined
        )
      ).resolves.toMatchObject({
        success: false,
        message: expect.stringContaining('available to steal'),
      });
      expect(game.researchManager.grantTechnology).not.toHaveBeenCalled();
    }

    const city = foreignCity();
    installGame('diplomat', {
      cityManager: {
        getCityAt: jest.fn().mockReturnValue(city),
        getPlayerCities: jest.fn().mockReturnValue([]),
        getEspionageTheftCount: jest.fn().mockReturnValue(0),
        recordEspionageTheft: jest.fn(),
        sabotageCityBuilding: jest.fn(),
        transferCity: jest.fn(),
      },
      researchManager: {
        getResearchedTechs: jest.fn((playerId: string) =>
          playerId === targetPlayerId ? ['alphabet'] : []
        ),
        grantTechnology: jest.fn(),
      },
    });
    await expect(
      manager.executeDiplomatAction(
        gameId,
        actorPlayerId,
        'actor',
        ActionType.STEAL_TECH,
        5,
        5,
        'alphabet'
      )
    ).resolves.toMatchObject({
      success: false,
      message: 'Only spies may choose a technology to steal',
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:491-532
   * @assertion Each C2C3 technology-theft enabler accepts exactly one remaining movement fragment.
   * @c2c3-action Steal Tech, Steal Tech Escape Expected, Targeted Steal Tech Escape Expected
   * @c2c3-scenario boundary
   */
  it('accepts every c2c3 technology theft variant at one movement fragment', async () => {
    const cases = [
      { actorType: 'diplomat' as const, requestedTechnologyId: undefined, sourceAction: undefined },
      {
        actorType: 'spy' as const,
        requestedTechnologyId: undefined,
        sourceAction: 'Steal Tech Escape Expected',
      },
      {
        actorType: 'spy' as const,
        requestedTechnologyId: 'bronze_working',
        sourceAction: 'Targeted Steal Tech Escape Expected',
      },
    ];
    for (const testCase of cases) {
      const city = foreignCity();
      const { actor, game } = installGame(testCase.actorType, {
        cityManager: {
          getCityAt: jest.fn().mockReturnValue(city),
          getPlayerCities: jest.fn().mockReturnValue([]),
          getEspionageTheftCount: jest.fn().mockReturnValue(0),
          recordEspionageTheft: jest.fn(),
          sabotageCityBuilding: jest.fn(),
          transferCity: jest.fn(),
        },
        researchManager: {
          getResearchedTechs: jest.fn((playerId: string) =>
            playerId === targetPlayerId ? ['alphabet', 'bronze_working'] : []
          ),
          grantTechnology: jest.fn(),
        },
      });
      actor.movementLeft = 1;

      await expect(
        manager.executeDiplomatAction(
          gameId,
          actorPlayerId,
          'actor',
          ActionType.STEAL_TECH,
          5,
          5,
          testCase.requestedTechnologyId
        )
      ).resolves.toMatchObject({ success: true });
      if (testCase.sourceAction) {
        expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
          'actor',
          testCase.sourceAction
        );
      } else {
        expect(game.unitManager.removeUnit).toHaveBeenCalledWith('actor');
      }
    }
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:379-389
   * @reference reference/freeciv/common/actions.c:138-146
   * @reference reference/freeciv/server/diplomats.c:1462-1575
   * @assertion The non-Spy C2C3 Sabotage City action chooses a valid city improvement at war and consumes its Diplomat actor.
   * @c2c3-action Sabotage City
   * @c2c3-scenario normal
   */
  it('performs normal c2c3 diplomat city sabotage', async () => {
    const city = foreignCity({ buildings: ['library'] });
    const { game } = installGame('diplomat');
    game.cityManager.getCityAt.mockReturnValue(city);
    game.cityManager.sabotageCityBuilding.mockResolvedValue('library');

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.SABOTAGE_CITY, 5, 5)
    ).resolves.toMatchObject({ success: true, unitDestroyed: true });
    expect(game.cityManager.sabotageCityBuilding).toHaveBeenCalledWith(
      city.id,
      actorPlayerId,
      undefined
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:391-399
   * @reference reference/freeciv/common/actions.c:138-146
   * @reference reference/freeciv/server/diplomats.c:1462-1575
   * @assertion The C2C3 Spy Sabotage City Escape action may take the same random improvement path while preserving the escaping actor.
   * @c2c3-action Sabotage City Escape
   * @c2c3-scenario normal
   */
  it('keeps a c2c3 spy alive after normal city sabotage', async () => {
    const city = foreignCity({ buildings: ['library'] });
    const { game } = installGame('spy');
    game.cityManager.getCityAt.mockReturnValue(city);
    game.cityManager.sabotageCityBuilding.mockResolvedValue('library');

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.SABOTAGE_CITY, 5, 5)
    ).resolves.toMatchObject({ success: true });
    expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
      'actor',
      'Sabotage City Escape'
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:401-409
   * @reference reference/freeciv/common/actions.c:147-163
   * @reference reference/freeciv/server/diplomats.c:1462-1575
   * @assertion Targeted Sabotage City Escape lets a Spy choose an existing, sabotagable improvement and preserves the actor on success.
   * @c2c3-action Targeted Sabotage City Escape
   * @c2c3-scenario normal
   */
  it('performs c2c3 targeted spy city sabotage', async () => {
    const city = foreignCity({ buildings: ['library', 'marketplace'] });
    const { game } = installGame('spy');
    game.cityManager.getCityAt.mockReturnValue(city);
    game.cityManager.sabotageCityBuilding.mockResolvedValue('marketplace');

    await expect(
      manager.executeDiplomatAction(
        gameId,
        actorPlayerId,
        'actor',
        ActionType.SABOTAGE_CITY,
        5,
        5,
        undefined,
        'marketplace'
      )
    ).resolves.toMatchObject({ success: true });
    expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
      'actor',
      'Targeted Sabotage City Escape'
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:411-419
   * @reference reference/freeciv/common/actions.c:147-163
   * @assertion Sabotage City Production Escape requires a Spy and a current production target, then leaves the Spy alive after success.
   * @c2c3-action Sabotage City Production Escape
   * @c2c3-scenario normal
   */
  it('performs c2c3 spy production sabotage', async () => {
    const city = foreignCity({ currentProduction: 'factory', productionStock: 42 });
    const { game } = installGame('spy');
    const sabotageCityProduction = jest.fn().mockResolvedValue('factory');
    game.cityManager.getCityAt.mockReturnValue(city);
    game.cityManager.sabotageCityProduction = sabotageCityProduction;

    await expect(
      manager.executeDiplomatAction(
        gameId,
        actorPlayerId,
        'actor',
        ActionType.SABOTAGE_CITY_PRODUCTION,
        5,
        5
      )
    ).resolves.toMatchObject({ success: true });
    expect(sabotageCityProduction).toHaveBeenCalledWith(city.id, actorPlayerId);
    expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
      'actor',
      'Sabotage City Production Escape'
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:379-419
   * @assertion Every C2C3 city-sabotage variant requires an at-war diplomatic relation before it can mutate the target city.
   * @c2c3-action Sabotage City, Sabotage City Escape, Targeted Sabotage City Escape, Sabotage City Production Escape
   * @c2c3-scenario rejected
   */
  it('rejects every c2c3 city-sabotage variant outside war', async () => {
    setRelation('peace');
    const cases = [
      { actorType: 'diplomat' as const, action: ActionType.SABOTAGE_CITY, building: undefined },
      { actorType: 'spy' as const, action: ActionType.SABOTAGE_CITY, building: undefined },
      { actorType: 'spy' as const, action: ActionType.SABOTAGE_CITY, building: 'library' },
      {
        actorType: 'spy' as const,
        action: ActionType.SABOTAGE_CITY_PRODUCTION,
        building: undefined,
      },
    ];
    for (const testCase of cases) {
      const city = foreignCity({
        buildings: ['library'],
        currentProduction: 'factory',
        productionStock: 42,
      });
      const { game } = installGame(testCase.actorType);
      game.cityManager.getCityAt.mockReturnValue(city);

      await expect(
        manager.executeDiplomatAction(
          gameId,
          actorPlayerId,
          'actor',
          testCase.action,
          5,
          5,
          undefined,
          testCase.building
        )
      ).resolves.toMatchObject({
        success: false,
        message: 'Sabotaging a city requires a state of war',
      });
      expect(game.cityManager.sabotageCityBuilding).not.toHaveBeenCalled();
    }
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:379-419
   * @assertion Every C2C3 city-sabotage enabler accepts the exact MinMoveFrags 1 boundary, preserving its distinct consuming or escape outcome.
   * @c2c3-action Sabotage City, Sabotage City Escape, Targeted Sabotage City Escape, Sabotage City Production Escape
   * @c2c3-scenario boundary
   */
  it('accepts every c2c3 city-sabotage variant at one movement fragment', async () => {
    const cases = [
      {
        actorType: 'diplomat' as const,
        action: ActionType.SABOTAGE_CITY,
        building: undefined,
        sourceAction: undefined,
      },
      {
        actorType: 'spy' as const,
        action: ActionType.SABOTAGE_CITY,
        building: undefined,
        sourceAction: 'Sabotage City Escape',
      },
      {
        actorType: 'spy' as const,
        action: ActionType.SABOTAGE_CITY,
        building: 'library',
        sourceAction: 'Targeted Sabotage City Escape',
      },
      {
        actorType: 'spy' as const,
        action: ActionType.SABOTAGE_CITY_PRODUCTION,
        building: undefined,
        sourceAction: 'Sabotage City Production Escape',
      },
    ];
    for (const testCase of cases) {
      const city = foreignCity({
        buildings: ['library'],
        currentProduction: 'factory',
        productionStock: 42,
      });
      const { actor, game } = installGame(testCase.actorType);
      actor.movementLeft = 1;
      game.cityManager.getCityAt.mockReturnValue(city);
      game.cityManager.sabotageCityBuilding.mockResolvedValue('library');
      game.cityManager.sabotageCityProduction = jest.fn().mockResolvedValue('factory');

      await expect(
        manager.executeDiplomatAction(
          gameId,
          actorPlayerId,
          'actor',
          testCase.action,
          5,
          5,
          undefined,
          testCase.building
        )
      ).resolves.toMatchObject({ success: true });
      if (testCase.sourceAction) {
        expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
          'actor',
          testCase.sourceAction
        );
      } else {
        expect(game.unitManager.removeUnit).toHaveBeenCalledWith('actor');
      }
    }
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:534-546
   * @reference reference/freeciv/common/actions.c:99-107
   * @assertion Poison City Escape lets a Spy reduce an at-war size-two city and escape after success.
   * @c2c3-action Poison City Escape
   * @c2c3-scenario normal
   */
  it('performs c2c3 poison-city escape', async () => {
    const city = foreignCity({ size: 2 });
    const { game } = installGame('spy');
    game.cityManager.getCityAt.mockReturnValue(city);

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.POISON_WATER, 5, 5)
    ).resolves.toMatchObject({ success: true });
    expect(game.cityManager.poisonCity).toHaveBeenCalledWith(city.id, actorPlayerId);
    expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
      'actor',
      'Poison City Escape'
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:534-546
   * @assertion Poison City Escape rejects a Spy that is not on a C2C3 OnLivableTile source tile.
   * @c2c3-action Poison City Escape
   * @c2c3-scenario rejected
   */
  it('rejects c2c3 poison-city escape from ocean', async () => {
    const city = foreignCity({ size: 2 });
    const { game } = installGame('spy');
    game.cityManager.getCityAt.mockImplementation((x: number, y: number) =>
      x === city.x && y === city.y ? city : undefined
    );
    game.mapManager.getTile = jest.fn().mockReturnValue({ terrain: 'ocean' });

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.POISON_WATER, 5, 5)
    ).resolves.toMatchObject({
      success: false,
      message: 'The diplomatic unit must be on a livable tile',
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:534-546
   * @assertion Poison City Escape accepts exactly one remaining movement fragment when the foreign city has its minimum size of two.
   * @c2c3-action Poison City Escape
   * @c2c3-scenario boundary
   */
  it('accepts c2c3 poison-city escape at its movement and city-size boundaries', async () => {
    const city = foreignCity({ size: 2 });
    const { actor, game } = installGame('spy');
    actor.movementLeft = 1;
    game.cityManager.getCityAt.mockReturnValue(city);

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.POISON_WATER, 5, 5)
    ).resolves.toMatchObject({ success: true });
    expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
      'actor',
      'Poison City Escape'
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:587-603
   * @reference reference/freeciv/common/actions.c:128-137
   * @reference reference/freeciv/server/diplomats.c:644-786
   * @assertion C2C3 Bribe Unit transfers an eligible lone foreign unit, keeps the diplomatic actor alive, forces it to the target tile, and spends its movement.
   * @c2c3-action Bribe Unit
   * @c2c3-scenario normal
   */
  it('performs c2c3 Bribe Unit as a surviving forced-move action', async () => {
    const target = {
      id: 'target',
      playerId: targetPlayerId,
      unitTypeId: 'warriors',
      x: 5,
      y: 5,
      health: 100,
    };
    const { game } = installGame('diplomat');
    game.unitManager.getUnitsAt.mockReturnValue([target]);
    game.cityManager.getCityAt.mockReturnValue(undefined);

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.BRIBE_UNIT, 5, 5)
    ).resolves.toMatchObject({ success: true });
    expect(game.unitManager.removeUnit).not.toHaveBeenCalled();
    expect(game.unitManager.bribeUnit).toHaveBeenCalledWith(target.id, actorPlayerId, 'actor-home');
    expect(game.unitManager.finishBribeMission).toHaveBeenCalledWith('actor', 5, 5);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:587-603
   * @assertion Bribe Unit is rejected for a C2C3 actor that lacks its required home city.
   * @c2c3-action Bribe Unit
   * @c2c3-scenario rejected
   */
  it('rejects c2c3 Bribe Unit without a home city', async () => {
    const target = {
      id: 'target',
      playerId: targetPlayerId,
      unitTypeId: 'warriors',
      x: 5,
      y: 5,
      health: 100,
    };
    const { actor, game, economicManager } = installGame('diplomat');
    (actor as { homeCityId?: string }).homeCityId = undefined;
    game.unitManager.getUnitsAt.mockReturnValue([target]);
    game.cityManager.getCityAt.mockReturnValue(undefined);

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.BRIBE_UNIT, 5, 5)
    ).resolves.toMatchObject({
      success: false,
      message: 'A home city is required to bribe a unit',
    });
    expect(economicManager.spendPlayerGold).not.toHaveBeenCalled();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:587-603
   * @assertion Bribe Unit accepts exactly one remaining movement fragment.
   * @c2c3-action Bribe Unit
   * @c2c3-scenario boundary
   */
  it('accepts c2c3 Bribe Unit at one movement fragment', async () => {
    const target = {
      id: 'target',
      playerId: targetPlayerId,
      unitTypeId: 'warriors',
      x: 5,
      y: 5,
      health: 100,
    };
    const { actor, game } = installGame('spy');
    actor.movementLeft = 1;
    game.unitManager.getUnitsAt.mockReturnValue([target]);
    game.cityManager.getCityAt.mockReturnValue(undefined);

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.BRIBE_UNIT, 5, 5)
    ).resolves.toMatchObject({ success: true });
    expect(game.unitManager.finishBribeMission).toHaveBeenCalledWith('actor', 5, 5);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:549-585
   * @reference reference/freeciv/common/actions.c:164-176
   * @reference reference/freeciv/server/diplomats.c:1242-1460
   * @assertion The non-Spy C2C3 Incite City action transfers an eligible foreign city and consumes its Diplomat actor.
   * @c2c3-action Incite City
   * @c2c3-scenario normal
   */
  it('performs the consuming c2c3 diplomat city incitement action', async () => {
    const city = foreignCity({ productionStock: 20 });
    const { game } = installGame('diplomat');
    game.cityManager.getCityAt.mockReturnValue(city);
    game.mapManager.getDistance.mockReturnValue(1);

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.INCITE_CITY, 5, 5)
    ).resolves.toMatchObject({ success: true, cityId: city.id, unitDestroyed: true });
    expect(game.cityManager.transferCity).toHaveBeenCalledWith(city.id, actorPlayerId);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:569-585
   * @reference reference/freeciv/common/actions.c:164-176
   * @reference reference/freeciv/server/diplomats.c:1242-1460
   * @assertion Incite City Escape gives a C2C3 Spy the same successful city transfer while retaining the escaping actor.
   * @c2c3-action Incite City Escape
   * @c2c3-scenario normal
   */
  it('performs the escaping c2c3 spy city incitement action', async () => {
    const city = foreignCity({ productionStock: 20 });
    const { game } = installGame('spy');
    game.cityManager.getCityAt.mockReturnValue(city);
    game.mapManager.getDistance.mockReturnValue(1);

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.INCITE_CITY, 5, 5)
    ).resolves.toMatchObject({ success: true, cityId: city.id });
    expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
      'actor',
      'Incite City Escape'
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:549-585
   * @assertion Both C2C3 Incite City variants reject allied or team targets, city Courthouses, and an owner-wide Mausoleum of Mausolos.
   * @c2c3-action Incite City, Incite City Escape
   * @c2c3-scenario rejected
   */
  it('enforces c2c3 incitement relation and building protections', async () => {
    setRelation('team');
    const teamCity = foreignCity();
    const { game: teamGame } = installGame('spy');
    teamGame.cityManager.getCityAt.mockReturnValue(teamCity);
    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.INCITE_CITY, 5, 5)
    ).resolves.toMatchObject({
      success: false,
      message: 'An allied or team city cannot be incited',
    });

    setRelation('war');
    const courthouseCity = foreignCity({ buildings: ['courthouse'] });
    const { game: courthouseGame } = installGame('diplomat');
    courthouseGame.cityManager.getCityAt.mockReturnValue(courthouseCity);
    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.INCITE_CITY, 5, 5)
    ).resolves.toMatchObject({ success: false, message: 'This city is protected from incitement' });

    const mausoleumCity = foreignCity();
    const { game: mausoleumGame } = installGame('spy');
    mausoleumGame.cityManager.getCityAt.mockReturnValue(mausoleumCity);
    mausoleumGame.cityManager.getPlayerCities.mockImplementation((playerId: string) =>
      playerId === targetPlayerId
        ? [foreignCity({ id: 'other-city', buildings: ['mausoleum_of_mausolos'] })]
        : []
    );
    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.INCITE_CITY, 5, 5)
    ).resolves.toMatchObject({ success: false, message: 'This city is protected from incitement' });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:549-585
   * @assertion The Diplomat and Spy incitement enablers both accept exactly one remaining movement fragment.
   * @c2c3-action Incite City, Incite City Escape
   * @c2c3-scenario boundary
   */
  it('accepts both c2c3 city-incitement variants at one movement fragment', async () => {
    for (const actorType of ['diplomat', 'spy'] as const) {
      const city = foreignCity({ productionStock: 20 });
      const { actor, game } = installGame(actorType);
      actor.movementLeft = 1;
      game.cityManager.getCityAt.mockReturnValue(city);
      game.mapManager.getDistance.mockReturnValue(1);

      await expect(
        manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.INCITE_CITY, 5, 5)
      ).resolves.toMatchObject({ success: true });
      if (actorType === 'spy') {
        expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
          'actor',
          'Incite City Escape'
        );
      } else {
        expect(game.unitManager.removeUnit).toHaveBeenCalledWith('actor');
      }
    }
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:606-617
   * @reference reference/freeciv/common/actions.c:120-128
   * @reference reference/freeciv/server/diplomats.c:549-635
   * @assertion Sabotage Unit Escape halves the hit points of a lone eligible at-war unit and lets the C2C3 Spy escape.
   * @c2c3-action Sabotage Unit Escape
   * @c2c3-scenario normal
   */
  it('performs c2c3 unit sabotage escape', async () => {
    const target = {
      id: 'target',
      playerId: targetPlayerId,
      unitTypeId: 'warriors',
      x: 5,
      y: 5,
      health: 80,
    };
    const { game } = installGame('spy');
    game.unitManager.getUnitsAt.mockReturnValue([target]);
    game.unitManager.sabotageUnit.mockResolvedValue({
      unit: { ...target, health: 40 },
      destroyed: false,
    });

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.SABOTAGE_UNIT, 5, 5)
    ).resolves.toMatchObject({ success: true, targetDestroyed: false });
    expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
      'actor',
      'Sabotage Unit Escape'
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:606-617
   * @assertion Sabotage Unit Escape rejects a target tile that violates the C2C3 MaxUnitsOnTile 1 requirement.
   * @c2c3-action Sabotage Unit Escape
   * @c2c3-scenario rejected
   */
  it('rejects c2c3 unit sabotage against a stack', async () => {
    const target = {
      id: 'target',
      playerId: targetPlayerId,
      unitTypeId: 'warriors',
      x: 5,
      y: 5,
      health: 80,
    };
    const { game } = installGame('spy');
    game.unitManager.getUnitsAt.mockReturnValue([target, { ...target, id: 'other-target' }]);

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.SABOTAGE_UNIT, 5, 5)
    ).resolves.toMatchObject({
      success: false,
      message: 'An adjacent, single foreign unit is required',
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:606-617
   * @assertion Sabotage Unit Escape accepts exactly one movement fragment and the minimum eligible target health of two.
   * @c2c3-action Sabotage Unit Escape
   * @c2c3-scenario boundary
   */
  it('accepts c2c3 unit sabotage at its movement and hit-point boundaries', async () => {
    const target = {
      id: 'target',
      playerId: targetPlayerId,
      unitTypeId: 'warriors',
      x: 5,
      y: 5,
      health: 2,
    };
    const { actor, game } = installGame('spy');
    actor.movementLeft = 1;
    game.unitManager.getUnitsAt.mockReturnValue([target]);
    game.unitManager.sabotageUnit.mockResolvedValue({
      unit: { ...target, health: 1 },
      destroyed: false,
    });

    await expect(
      manager.executeDiplomatAction(gameId, actorPlayerId, 'actor', ActionType.SABOTAGE_UNIT, 5, 5)
    ).resolves.toMatchObject({ success: true });
    expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith(
      'actor',
      'Sabotage Unit Escape'
    );
  });
});
