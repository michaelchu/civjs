import { Socket } from 'socket.io';
import { CityProductionHandler } from '@network/handlers/CityProductionHandler';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import { BUILDING_TYPES } from '@game/managers/CityManager';

// Mock dependencies with proper Jest mock typing
const mockSocket = {
  emit: jest.fn(),
  broadcast: {
    emit: jest.fn(),
  },
} as unknown as Socket & { emit: jest.MockedFunction<any> };

const mockResearchManager = {
  hasPlayerResearched: jest.fn(),
};

describe('CityProductionHandler', () => {
  let handler: CityProductionHandler;
  let mockCities: Map<string, any>;
  let mockPlayers: Map<string, any>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock data
    mockCities = new Map();
    mockPlayers = new Map();

    // Mock city data
    const mockCity = {
      id: 'city-1',
      name: 'Test City',
      playerId: 'player-1',
      x: 10,
      y: 10,
      size: 3,
      buildings: ['granary'],
      shieldStock: 10,
      currentProduction: 'warrior',
      productionType: 'unit',
      surplus: {
        shields: 5,
        food: 2,
        trade: 3,
      },
    };

    // Mock player data
    const mockPlayer = {
      id: 'player-1',
      userId: 'user-1',
      civilization: 'american',
      researched: ['pottery', 'bronze_working'],
    };

    mockCities.set('city-1', mockCity);
    mockPlayers.set('player-1', mockPlayer);

    handler = new CityProductionHandler(mockCities, mockPlayers, mockResearchManager);

    // Setup research manager mock
    mockResearchManager.hasPlayerResearched.mockReturnValue(true);
  });

  describe('getAvailableProductions', () => {
    it('should return available productions for a valid city and player', async () => {
      await handler.getAvailableProductions(mockSocket, {
        cityId: 'city-1',
        playerId: 'player-1',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('city:availableProductions', {
        cityId: 'city-1',
        productions: expect.arrayContaining([
          expect.objectContaining({
            id: 'warrior',
            name: 'Warrior',
            type: 'unit',
            cost: expect.any(Number),
            available: true,
          }),
          expect.objectContaining({
            id: 'granary',
            name: 'Granary',
            type: 'building',
            cost: expect.any(Number),
            available: false, // Already built
          }),
        ]),
      });
    });

    it('should emit error for non-existent city', async () => {
      await handler.getAvailableProductions(mockSocket, {
        cityId: 'non-existent',
        playerId: 'player-1',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'City not found',
      });
    });

    it('should emit error for wrong player', async () => {
      await handler.getAvailableProductions(mockSocket, {
        cityId: 'city-1',
        playerId: 'wrong-player',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'City does not belong to player',
      });
    });

    it('should emit error for non-existent player', async () => {
      await handler.getAvailableProductions(mockSocket, {
        cityId: 'city-1',
        playerId: 'non-existent-player',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'City does not belong to player',
      });
    });

    it('should filter out buildings already built', async () => {
      await handler.getAvailableProductions(mockSocket, {
        cityId: 'city-1',
        playerId: 'player-1',
      });

      const call = (mockSocket.emit as jest.MockedFunction<any>).mock.calls.find(
        (call: any) => call[0] === 'city:availableProductions'
      );
      const productions = call[1].productions;

      const granary = productions.find((p: any) => p.id === 'granary');
      expect(granary.available).toBe(false);
    });

    it('should respect technology requirements', async () => {
      // Mock that player doesn't have required tech
      mockResearchManager.hasPlayerResearched.mockImplementation(
        (_playerId: string, techId: string) => techId !== 'advanced_tech'
      );

      await handler.getAvailableProductions(mockSocket, {
        cityId: 'city-1',
        playerId: 'player-1',
      });

      const call = (mockSocket.emit as jest.MockedFunction<any>).mock.calls.find(
        (call: any) => call[0] === 'city:availableProductions'
      );
      expect(call).toBeDefined();
    });
  });

  describe('changeProduction', () => {
    it('should successfully change production to a valid unit', async () => {
      await handler.changeProduction(mockSocket, {
        cityId: 'city-1',
        playerId: 'player-1',
        productionId: 'archer',
        productionType: 'unit',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('city:productionChanged', {
        cityId: 'city-1',
        production: expect.objectContaining({
          target: expect.any(String),
          type: 'unit',
          progress: expect.any(Number),
          cost: expect.any(Number),
          turnsToComplete: expect.any(Number),
        }),
        shieldStock: expect.any(Number),
        penalty: expect.any(Number),
        previousProduction: 'warrior',
        previousType: 'unit',
      });
    });

    it('should apply production change penalty', async () => {
      const city = mockCities.get('city-1');
      city.shieldStock = 20;

      await handler.changeProduction(mockSocket, {
        cityId: 'city-1',
        playerId: 'player-1',
        productionId: 'archer',
        productionType: 'unit',
      });

      const call = (mockSocket.emit as jest.MockedFunction<any>).mock.calls.find(
        (call: any) => call[0] === 'city:productionChanged'
      );

      expect(call[1].penalty).toBeGreaterThan(0);
      expect(call[1].shieldStock).toBeLessThan(20);
    });

    it('should emit error for unavailable production', async () => {
      // Mock that the unit can't be built
      const unitSpy = jest.spyOn(handler as any, 'canCityBuild').mockReturnValue(false);

      await handler.changeProduction(mockSocket, {
        cityId: 'city-1',
        playerId: 'player-1',
        productionId: 'invalid-unit',
        productionType: 'unit',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'Production not available',
      });

      unitSpy.mockRestore();
    });

    it('should emit error for non-existent city', async () => {
      await handler.changeProduction(mockSocket, {
        cityId: 'non-existent',
        playerId: 'player-1',
        productionId: 'warrior',
        productionType: 'unit',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('error', {
        message: 'City not found',
      });
    });

    it('should handle building production change', async () => {
      await handler.changeProduction(mockSocket, {
        cityId: 'city-1',
        playerId: 'player-1',
        productionId: 'barracks',
        productionType: 'building',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('city:productionChanged', {
        cityId: 'city-1',
        production: expect.objectContaining({
          type: 'building',
        }),
        shieldStock: expect.any(Number),
        penalty: expect.any(Number),
        previousProduction: 'warrior',
        previousType: 'unit',
      });
    });
  });

  describe('canCityBuildUnit', () => {
    it('should allow building warrior with no tech requirements', () => {
      const city = mockCities.get('city-1');
      const player = mockPlayers.get('player-1');
      const unitType = UNIT_TYPES.warrior;

      const result = (handler as any).canCityBuildUnit(city, unitType, player);
      expect(result).toBe(true);
    });

    it('should prevent building settler in size 1 city', () => {
      const city = mockCities.get('city-1');
      city.size = 1;
      const player = mockPlayers.get('player-1');
      const unitType = UNIT_TYPES.settler;

      const result = (handler as any).canCityBuildUnit(city, unitType, player);
      expect(result).toBe(false);
    });

    it('should check technology requirements', () => {
      const city = mockCities.get('city-1');
      const player = mockPlayers.get('player-1');
      const unitType = { ...UNIT_TYPES.warrior, requiredTech: 'missing_tech' };

      mockResearchManager.hasPlayerResearched.mockReturnValue(false);

      const result = (handler as any).canCityBuildUnit(city, unitType, player);
      expect(result).toBe(false);
    });
  });

  describe('canCityBuildBuilding', () => {
    it('should prevent building duplicate buildings', () => {
      const city = mockCities.get('city-1');
      const player = mockPlayers.get('player-1');
      const buildingType = BUILDING_TYPES.granary;

      const result = (handler as any).canCityBuildBuilding(city, buildingType, player);
      expect(result).toBe(false);
    });

    it('should allow building new buildings', () => {
      const city = mockCities.get('city-1');
      const player = mockPlayers.get('player-1');
      const buildingType = BUILDING_TYPES.barracks;

      const result = (handler as any).canCityBuildBuilding(city, buildingType, player);
      expect(result).toBe(true);
    });

    it('should check technology requirements for buildings', () => {
      const city = mockCities.get('city-1');
      const player = mockPlayers.get('player-1');
      const buildingType = { ...BUILDING_TYPES.barracks, requiredTech: 'missing_tech' };

      mockResearchManager.hasPlayerResearched.mockReturnValue(false);

      const result = (handler as any).canCityBuildBuilding(city, buildingType, player);
      expect(result).toBe(false);
    });
  });

  describe('calculateProductionChangePenalty', () => {
    it('should return 0 penalty for same production', () => {
      const city = mockCities.get('city-1');

      const penalty = (handler as any).calculateProductionChangePenalty(city, 'warrior', 'unit');

      expect(penalty).toBe(0);
    });

    it('should apply 50% penalty for production change', () => {
      const city = mockCities.get('city-1');
      city.shieldStock = 20;

      const penalty = (handler as any).calculateProductionChangePenalty(city, 'archer', 'unit');

      expect(penalty).toBe(10); // 50% of 20
    });

    it('should handle no shield stock gracefully', () => {
      const city = mockCities.get('city-1');
      city.shieldStock = 0;

      const penalty = (handler as any).calculateProductionChangePenalty(city, 'archer', 'unit');

      expect(penalty).toBe(0);
    });
  });

  describe('getUnitDescription', () => {
    it('should generate description for combat unit', () => {
      const unitType = { combat: 5, movement: 3 };
      const description = (handler as any).getUnitDescription(unitType);

      expect(description).toContain('Attack: 5');
      expect(description).toContain('Movement: 1');
    });

    it('should handle special abilities', () => {
      const unitType = {
        combat: 0,
        movement: 3,
        canFoundCity: true,
        canBuildImprovements: true,
      };
      const description = (handler as any).getUnitDescription(unitType);

      expect(description).toContain('Can found cities');
      expect(description).toContain('Can build improvements');
    });

    it('should return fallback for units with no features', () => {
      const unitType = {};
      const description = (handler as any).getUnitDescription(unitType);

      expect(description).toBe('Basic unit');
    });
  });

  describe('getBuildingDescription', () => {
    it('should generate description from effects', () => {
      const buildingType = {
        effects: {
          foodBonus: 25,
          happinessEffect: 2,
          scienceBonus: 50,
        },
      };

      const description = (handler as any).getBuildingDescription(buildingType);

      expect(description).toContain('+25% food storage');
      expect(description).toContain('Makes 2 citizens happy');
      expect(description).toContain('+50% science');
    });

    it('should return fallback for buildings with no effects', () => {
      const buildingType = {};
      const description = (handler as any).getBuildingDescription(buildingType);

      expect(description).toBe('City improvement');
    });
  });
});
