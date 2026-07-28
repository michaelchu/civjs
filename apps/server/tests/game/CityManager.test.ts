import {
  CityManager,
  BUILDING_TYPES,
  SpecialistType,
  SPECIALIST_TYPES,
  VUT_UTYPE,
  VUT_IMPROVEMENT,
  vutToProductionKind,
  productionKindToVut,
} from '@game/managers/CityManager';
import { EffectsManager } from '@game/managers/EffectsManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { MapManager } from '@game/managers/MapManager';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('CityManager', () => {
  let cityManager: CityManager;
  let effectsManager: EffectsManager;
  let mockMapManager: MapManager;
  let mockDbProvider: ReturnType<typeof createMockDatabaseProvider>;
  const gameId = 'test-game-id';

  beforeEach(async () => {
    mockDbProvider = createMockDatabaseProvider();
    effectsManager = new EffectsManager();

    // Create a mock MapManager with required methods
    mockMapManager = {
      getMapData: jest.fn().mockReturnValue({
        width: 80,
        height: 50,
        tiles: Array(80 * 50)
          .fill(null)
          .map((_, index) => ({
            x: index % 80,
            y: Math.floor(index / 80),
            terrain: 'grassland',
            special: null,
            improvement: null,
            city: null,
            units: [],
            isVisible: true,
          })),
      }),
      getTileAt: jest.fn().mockReturnValue({
        x: 10,
        y: 10,
        terrain: 'grassland',
        special: null,
        improvement: null,
        city: null,
        units: [],
        isVisible: true,
      }),
      getTile: jest.fn().mockReturnValue({
        x: 10,
        y: 10,
        terrain: 'grassland',
        special: null,
        improvement: null,
        city: null,
        units: [],
        isVisible: true,
      }),
      isValidPosition: jest.fn().mockReturnValue(true),
      updateTileProperty: jest.fn(),
    } as any;

    cityManager = new CityManager(gameId, mockDbProvider, effectsManager);
    cityManager.setPlayerGovernmentProvider(() => 'despotism');

    // Set the MapManager dependency before initialization
    cityManager.setMapManager(mockMapManager);

    // Initialize the services
    await cityManager.initialize();
    jest.clearAllMocks();
  });

  describe('building types', () => {
    it('should have valid building type definitions', () => {
      const classicBuildings = rulesetLoader.getBuildings();

      expect(BUILDING_TYPES.granary).toBeDefined();
      expect(BUILDING_TYPES.granary.name).toBe('Granary');
      expect(BUILDING_TYPES.granary.cost).toBe(classicBuildings.granary.cost);
      expect(BUILDING_TYPES.granary.effects.foodBonus).toBe(
        classicBuildings.granary.effects.foodBonus
      );

      expect(BUILDING_TYPES.library).toBeDefined();
      expect(BUILDING_TYPES.library.name).toBe('Library');
      expect(BUILDING_TYPES.library.effects.scienceBonus).toBe(
        classicBuildings.library.effects.scienceBonus
      );

      expect(BUILDING_TYPES.temple).toBeDefined();
      expect(BUILDING_TYPES.temple.effects.happinessEffect).toBe(
        classicBuildings.temple.effects.happinessBonus
      );
    });
  });

  describe('Milestone 14 unit-to-city outcomes', () => {
    it('joins population and recovers full unit shields into production', async () => {
      const city = await cityManager.foundCity(10, 10, 'Target', 'player-123');
      city.currentProduction = 'warriors';

      await expect(cityManager.joinCity(city.id, 'player-123', 1)).resolves.toBe(true);
      await expect(cityManager.recoverUnitShields(city.id, 'player-123', 20)).resolves.toBe(true);

      expect(city.population).toBe(2);
      expect(city.size).toBe(2);
      expect(city.productionStock).toBe(20);
    });

    it('accepts wonder help only for a friendly Great Wonder production target', async () => {
      const city = await cityManager.foundCity(10, 10, 'Wonder', 'player-123');
      city.currentProduction = 'colossus';

      await expect(cityManager.helpWonder(city.id, 'player-123', 50)).resolves.toBe(true);
      expect(city.productionStock).toBe(50);

      city.currentProduction = 'marketplace';
      await expect(cityManager.helpWonder(city.id, 'player-123', 50)).resolves.toBe(false);
      await expect(cityManager.helpWonder(city.id, 'player-456', 50)).resolves.toBe(false);
    });
  });

  describe('Milestone 15 nuclear consequences', () => {
    it('applies the classic rounded 49 percent population loss in the blast radius', async () => {
      const city = await cityManager.foundCity(10, 10, 'Target', 'player-456');
      city.population = 10;
      city.size = 10;

      await expect(cityManager.applyNuclearExplosion(10, 10, 1, 'player-123')).resolves.toEqual([
        city.id,
      ]);

      expect(city.population).toBe(5);
      expect(city.size).toBe(5);
    });
  });

  describe('airport airlift usage', () => {
    it('requires source capacity while allowing unlimited classic destinations', async () => {
      const source = {
        id: 'source-city',
        playerId: 'player-123',
        buildings: ['airport'],
      };
      const destination = {
        id: 'destination-city',
        playerId: 'player-123',
        buildings: [],
      };
      (cityManager as any).cities.set(source.id, source);
      (cityManager as any).cities.set(destination.id, destination);

      await expect(
        cityManager.reserveAirlift(source.id, destination.id, 'player-123', 12)
      ).resolves.toBe(true);
      await expect(
        cityManager.reserveAirlift(source.id, destination.id, 'player-123', 12)
      ).resolves.toBe(false);
      await expect(
        cityManager.reserveAirlift(source.id, destination.id, 'player-123', 13)
      ).resolves.toBe(true);

      expect(source).toMatchObject({ airliftUsedTurn: 13 });
      expect(destination).toMatchObject({ airliftUsedTurn: 13 });
    });
  });

  describe('VUT conversion functions', () => {
    it('should convert between VUT and production kinds', () => {
      expect(vutToProductionKind(VUT_UTYPE)).toBe('unit');
      expect(vutToProductionKind(VUT_IMPROVEMENT)).toBe('building');

      expect(productionKindToVut('unit')).toBe(VUT_UTYPE);
      expect(productionKindToVut('building')).toBe(VUT_IMPROVEMENT);
    });
  });

  describe('city founding', () => {
    it('records the authoritative turn when founding a city', async () => {
      cityManager.setCurrentTurnProvider(() => 7);

      const city = await cityManager.foundCity(10, 10, 'Turn Seven', 'player-123');

      expect(city.founded).toBe(7);
    });

    it('should found a city successfully', async () => {
      const city = await cityManager.foundCity(10, 10, 'TestCity', 'player-123');

      expect(city).toBeDefined();
      expect(city!.name).toBe('TestCity');
      expect(city!.population).toBe(1);
      expect(city!.x).toBe(10);
      expect(city!.y).toBe(10);
      expect(city!.playerId).toBe('player-123');
      expect(city!.buildings).toEqual(['palace']);
      expect(city!.specialists[SpecialistType.SCIENTIST]).toBe(0);
      expect(city!.specialists[SpecialistType.ENTERTAINER]).toBe(0);
    });

    it('rolls back provisional city state when persistence fails', async () => {
      const database = mockDbProvider.getDatabase() as any;
      database.values.mockRejectedValueOnce(new Error('database schema is outdated'));

      await expect(cityManager.foundCity(10, 10, 'Failed City', 'player-123')).rejects.toThrow(
        'database schema is outdated'
      );
      expect(cityManager.getPlayerCities('player-123')).toHaveLength(0);

      database.values.mockReturnThis();
      const retriedCity = await cityManager.foundCity(10, 10, 'Retried City', 'player-123');
      expect(retriedCity.buildings).toContain('palace');
    });

    it('safely disbands a non-capital city but never the player’s only city', async () => {
      const capital = await cityManager.foundCity(10, 10, 'Capital', 'player-123');
      const second = await cityManager.foundCity(20, 20, 'Second', 'player-123');

      await expect(cityManager.disbandCity(second.id, 'player-123')).resolves.toEqual({
        success: true,
      });
      expect(cityManager.getCity(second.id)).toBeUndefined();
      await expect(cityManager.disbandCity(capital.id, 'player-123')).resolves.toEqual({
        success: false,
        reason: 'Cannot disband your only city',
      });
    });

    it('sells improvements for the classic shield cost and credits the treasury', async () => {
      const city = await cityManager.foundCity(10, 10, 'Capital', 'player-123');
      city.buildings.push('granary');
      const addGold = jest.fn().mockResolvedValue(true);
      cityManager.setTradeProviders(addGold, jest.fn(), jest.fn().mockResolvedValue('peace'));

      await expect(
        cityManager.sellBuildingForPlayer(city.id, 'granary', 'player-123')
      ).resolves.toEqual({ success: true, goldReceived: 40 });
      expect(addGold).toHaveBeenCalledWith('player-123', 40);
      expect(city.buildings).not.toContain('granary');
    });

    it('rejects a city two tiles from another player city', async () => {
      await cityManager.foundCity(10, 10, 'AI City', 'ai-player');

      await expect(cityManager.foundCity(12, 10, 'Player City', 'player-123')).rejects.toThrow(
        'Too close to existing city'
      );
    });

    it('allows a city at the three-tile minimum distance', async () => {
      await cityManager.foundCity(10, 10, 'FirstCity', 'player-123');

      await expect(
        cityManager.foundCity(13, 10, 'SecondCity', 'player-123')
      ).resolves.toMatchObject({
        x: 13,
        y: 10,
      });
    });
  });

  describe('city calculations', () => {
    let city: any;

    beforeEach(async () => {
      city = await cityManager.foundCity(10, 10, 'TestCity', 'player-123');
    });

    it('should calculate basic city outputs', () => {
      const outputs = cityManager.calculateCityOutputs(city.id);

      expect(outputs).toBeDefined();
      expect(outputs.food).toBeGreaterThanOrEqual(0);
      expect(outputs.shields).toBeGreaterThanOrEqual(0);
      expect(outputs.trade).toBeGreaterThanOrEqual(0);
      expect(outputs.science).toBeGreaterThanOrEqual(0);
      expect(outputs.gold).toBeGreaterThanOrEqual(0);
      expect(outputs.luxury).toBeGreaterThanOrEqual(0);
    });

    it('should calculate happiness', () => {
      const happiness = cityManager.calculateHappiness(city.id);

      expect(happiness).toBeDefined();
      expect(happiness.happy).toBeGreaterThanOrEqual(0);
      expect(happiness.content).toBeGreaterThanOrEqual(0);
      expect(happiness.unhappy).toBeGreaterThanOrEqual(0);
      expect(happiness.angry).toBeGreaterThanOrEqual(0);
    });

    it('should calculate detailed happiness', () => {
      const detailedHappiness = cityManager.calculateDetailedHappiness(city.id);

      expect(detailedHappiness).toBeDefined();
      expect(detailedHappiness.stage).toBe(5); // FEELING_FINAL
      expect(detailedHappiness.luxuryEffect).toBeGreaterThanOrEqual(0);
      expect(detailedHappiness.buildingEffect).toBeGreaterThanOrEqual(0);
      expect(detailedHappiness.unitEffect).toBeGreaterThanOrEqual(0);
    });

    it('places deterministic pollution on a workable land tile', async () => {
      city.pollution = 100;
      city.workableTiles = [
        { x: 10, y: 10, isCenter: true, isWorked: true },
        { x: 11, y: 10, isCenter: false, isWorked: false },
      ];
      (mockMapManager.getTile as jest.Mock).mockImplementation((x: number, y: number) => ({
        x,
        y,
        terrain: 'grassland',
        improvements: [],
      }));

      await expect(cityManager.checkPollution(city.id, 4)).resolves.toBe(true);
      expect(mockMapManager.updateTileProperty).toHaveBeenCalledWith(11, 10, 'improvements', [
        'pollution',
      ]);
    });
  });

  describe('specialist management', () => {
    let city: any;

    beforeEach(async () => {
      city = await cityManager.foundCity(10, 10, 'TestCity', 'player-123');
      city.specialists[SpecialistType.ENTERTAINER] = 1;
    });

    it('should change specialists', async () => {
      await cityManager.changeSpecialist(
        city.id,
        SpecialistType.ENTERTAINER,
        SpecialistType.SCIENTIST,
        'player-123'
      );

      const updatedCity = cityManager.getCity(city.id);
      expect(updatedCity!.specialists[SpecialistType.ENTERTAINER]).toBe(0);
      expect(updatedCity!.specialists[SpecialistType.SCIENTIST]).toBe(1);
    });

    it('should validate specialist types', () => {
      expect(SPECIALIST_TYPES[SpecialistType.SCIENTIST]).toBeDefined();
      expect(SPECIALIST_TYPES[SpecialistType.SCIENTIST].outputType).toBe('science');
      expect(SPECIALIST_TYPES[SpecialistType.SCIENTIST].outputAmount).toBe(3);

      expect(SPECIALIST_TYPES[SpecialistType.ENTERTAINER]).toBeDefined();
      expect(SPECIALIST_TYPES[SpecialistType.ENTERTAINER].outputType).toBe('luxury');
      expect(SPECIALIST_TYPES[SpecialistType.ENTERTAINER].outputAmount).toBe(2);
    });
  });

  describe('production management', () => {
    let city: any;

    beforeEach(async () => {
      city = await cityManager.foundCity(10, 10, 'TestCity', 'player-123');
    });

    it('should set city production', async () => {
      const success = await cityManager.setCityProduction(
        city.id,
        'building',
        'granary',
        'player-123'
      );

      expect(success).toBe(true);
      const updatedCity = cityManager.getCity(city.id);
      expect(updatedCity!.currentProduction).toBe('granary');
      expect(updatedCity!.productionType).toBe('building');
    });

    it('should process city turns', async () => {
      await cityManager.processCityTurn(city.id, 1);

      const updatedCity = cityManager.getCity(city.id);
      expect(updatedCity).toBeDefined();
      // City should still exist after processing
      expect(updatedCity!.id).toBe(city.id);
    });

    it('activates the first queued item when the city is idle', async () => {
      city.currentProduction = null;
      city.productionType = null;

      await expect(
        cityManager.addToWorklist(city.id, [{ kind: 'unit', value: 'warriors' }], 'player-123')
      ).resolves.toBe(true);

      expect(city.currentProduction).toBe('warriors');
      expect(city.productionType).toBe('unit');
      expect(city.worklist).toEqual([]);
    });
  });

  describe('service delegation', () => {
    let city: any;

    beforeEach(async () => {
      city = await cityManager.foundCity(10, 10, 'TestCity', 'player-123');
    });

    it('should delegate to building service', () => {
      const canBuild = cityManager.canCityBuildBuilding(city.id, 'granary');
      expect(typeof canBuild).toBe('boolean');
    });

    it('should delegate to production service', () => {
      const buyCost = cityManager.calculateBuyCost(city.id);
      expect(buyCost).toBeDefined();
      expect(buyCost.canBuy).toBe(true); // City now defaults to warrior production
    });

    it('should delegate to trade route service', () => {
      const tradeRevenue = cityManager.getCityTradeRouteRevenue(city.id);
      expect(typeof tradeRevenue).toBe('number');
    });

    it('should delegate to capture service', async () => {
      const captureResult = await cityManager.captureCity(city.id, 'player-123', 'unit-123');
      expect(captureResult).toBeDefined();
      expect(captureResult.success).toBe(false); // Cannot capture own city
    });

    it('destroys a size-one city through the normal city-destruction path', async () => {
      const captureResult = await cityManager.captureCity(city.id, 'player-456', 'unit-123');

      expect(captureResult).toEqual(
        expect.objectContaining({
          success: true,
          populationLoss: 1,
          cityDestroyed: true,
        })
      );
      expect(cityManager.getCity(city.id)).toBeUndefined();
    });
  });

  describe('city queries', () => {
    beforeEach(async () => {
      await cityManager.foundCity(10, 10, 'City1', 'player-123');
      await cityManager.foundCity(20, 20, 'City2', 'player-123');
      await cityManager.foundCity(30, 30, 'City3', 'player-456');
    });

    it('should get player cities', () => {
      const player123Cities = cityManager.getPlayerCities('player-123');
      const player456Cities = cityManager.getPlayerCities('player-456');

      expect(player123Cities).toHaveLength(2);
      expect(player456Cities).toHaveLength(1);
    });

    it('should count player cities', () => {
      expect(cityManager.getPlayerCityCount('player-123')).toBe(2);
      expect(cityManager.getPlayerCityCount('player-456')).toBe(1);
      expect(cityManager.getPlayerCityCount('nonexistent')).toBe(0);
    });

    it('should get all cities', () => {
      const allCities = cityManager.getAllCities();
      expect(allCities).toHaveLength(3);
    });

    it('should get total city count', () => {
      expect(cityManager.getCityCount()).toBe(3);
    });

    it('should check if player can support more cities', () => {
      expect(cityManager.canPlayerSupportMoreCities('player-123')).toBe(true);
      expect(cityManager.canPlayerSupportMoreCities('player-456')).toBe(true);
    });
  });

  describe('classic espionage mutations', () => {
    it('poisoning removes one citizen while retaining food stock', async () => {
      const city = await cityManager.foundCity(10, 10, 'Target', 'player-456');
      city.size = 3;
      city.population = 3;
      city.foodStock = 17;

      const poisoned = await cityManager.poisonCity(city.id, 'player-123');

      expect(poisoned).toMatchObject({ size: 2, population: 2, foodStock: 17 });
    });

    it('rejects poisoning a size-one city', async () => {
      const city = await cityManager.foundCity(10, 10, 'Target', 'player-456');

      await expect(cityManager.poisonCity(city.id, 'player-123')).rejects.toThrow(
        'at least two citizens'
      );
    });

    it('persists a diplomatic city transfer through the authoritative manager', async () => {
      const city = await cityManager.foundCity(10, 10, 'Target', 'player-456');

      await expect(cityManager.transferCity(city.id, 'player-123')).resolves.toBe(true);

      expect(city.playerId).toBe('player-123');
      expect((mockDbProvider.getDatabase() as any).values).toHaveBeenLastCalledWith(
        expect.arrayContaining([expect.objectContaining({ playerId: 'player-123' })])
      );
    });
  });

  describe('services access', () => {
    it('should provide access to specialized services', async () => {
      expect(cityManager.getTileManagementService()).toBeDefined();
      expect(cityManager.getBuildingService()).toBeDefined();
      expect(cityManager.getTradeRouteService()).toBeDefined();
      expect(cityManager.getProductionService()).toBeDefined();
      expect(cityManager.getGovernorService()).toBeDefined();
      expect(cityManager.getCaptureService()).toBeDefined();
    });
  });
});
