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

  function installGame(actorType: 'diplomat' | 'spy', overrides: Record<string, unknown> = {}) {
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
    expect(game.unitManager.finishDiplomatMission).toHaveBeenCalledWith('actor');
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

    expect(result).toMatchObject({ success: true, unitDestroyed: true });
    expect(economicManager.spendPlayerGold).toHaveBeenCalledWith(
      actorPlayerId,
      25,
      'Bribed warriors',
      { unitId: target.id, turn: 12 },
      GoldSpendingType.DIPLOMACY
    );
    expect(game.unitManager.bribeUnit).toHaveBeenCalledWith(target.id, actorPlayerId, undefined);
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
});
