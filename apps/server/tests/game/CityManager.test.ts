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
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('CityManager', () => {
  let cityManager: CityManager;
  let mockEffectsManager: EffectsManager;
  const gameId = 'test-game-id';

  beforeEach(async () => {
    const mockDbProvider = createMockDatabaseProvider();
    mockEffectsManager = {} as EffectsManager;
    cityManager = new CityManager(gameId, mockDbProvider, mockEffectsManager);

    // Initialize the services
    await cityManager.initialize();
    jest.clearAllMocks();
  });

  describe('building types', () => {
    it('should have valid building type definitions', () => {
      expect(BUILDING_TYPES.granary).toBeDefined();
      expect(BUILDING_TYPES.granary.name).toBe('Granary');
      expect(BUILDING_TYPES.granary.cost).toBe(60);
      expect(BUILDING_TYPES.granary.effects.foodBonus).toBe(50);

      expect(BUILDING_TYPES.library).toBeDefined();
      expect(BUILDING_TYPES.library.name).toBe('Library');
      expect(BUILDING_TYPES.library.effects.scienceBonus).toBe(50);

      expect(BUILDING_TYPES.temple).toBeDefined();
      expect(BUILDING_TYPES.temple.effects.happinessEffect).toBe(2);
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
    it('should found a city successfully', async () => {
      const city = await cityManager.foundCity(10, 10, 'TestCity', 'player-123');

      expect(city).toBeDefined();
      expect(city!.name).toBe('TestCity');
      expect(city!.population).toBe(1);
      expect(city!.x).toBe(10);
      expect(city!.y).toBe(10);
      expect(city!.playerId).toBe('player-123');
      expect(city!.buildings).toEqual([]);
      expect(city!.specialists[SpecialistType.SCIENTIST]).toBe(0);
      expect(city!.specialists[SpecialistType.ENTERTAINER]).toBe(0);
    });

    it('should reject cities founded too close together', async () => {
      await cityManager.foundCity(10, 10, 'FirstCity', 'player-123');

      // Try to found a city too close (within minimum distance)
      const secondCity = await cityManager.foundCity(11, 11, 'SecondCity', 'player-123');

      expect(secondCity).toBeNull();
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
      expect(SPECIALIST_TYPES[SpecialistType.ENTERTAINER].outputAmount).toBe(3);
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
      expect(buyCost.canBuy).toBe(false); // No production set
    });

    it('should delegate to trade route service', () => {
      const tradeRevenue = cityManager.getCityTradeRouteRevenue(city.id);
      expect(typeof tradeRevenue).toBe('number');
    });

    it('should delegate to capture service', async () => {
      const captureResult = await cityManager.captureCity(city.id, 'enemy-player', 'unit-123');
      expect(captureResult).toBeDefined();
      expect(captureResult.success).toBe(false); // Cannot capture own city
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

  describe('services access', () => {
    it('should provide access to specialized services', async () => {
      expect(cityManager.getTileManagementService()).toBeDefined();
      expect(cityManager.getBuildingService()).toBeDefined();
      expect(cityManager.getTradeRouteService()).toBeDefined();
      expect(cityManager.getProductionService()).toBeDefined();
      expect(cityManager.getGovernorService()).toBeDefined();
      expect(cityManager.getCaptureService()).toBeDefined();
      expect(cityManager.getManagementService()).toBeDefined();
    });
  });
});
