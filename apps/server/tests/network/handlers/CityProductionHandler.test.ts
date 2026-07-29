import { Socket } from 'socket.io';
import { CityProductionHandler } from '@network/handlers/CityProductionHandler';
import { BUILDING_TYPES } from '@game/managers/CityManager';
import { UNIT_TYPES } from '@game/constants/UnitConstants';

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
      currentProduction: 'warriors',
      productionType: 'unit',
      productionPerTurn: 4, // Realistic shield production for size 3 city
      surplus: {
        shields: 4,
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
    mockResearchManager.hasPlayerResearched.mockImplementation(
      (_playerId: string, techId: string) => techId !== 'guerilla_warfare'
    );
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
            id: 'explorer',
            name: 'Explorer',
            type: 'unit',
            cost: 30,
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

    it('exposes unclaimed classic Great Wonders through normal building production', async () => {
      await handler.getAvailableProductions(mockSocket, {
        cityId: 'city-1',
        playerId: 'player-1',
      });

      const call = (mockSocket.emit as jest.MockedFunction<any>).mock.calls.find(
        (entry: any) => entry[0] === 'city:availableProductions'
      );
      expect(call[1].productions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'colossus',
            name: 'Colossus',
            type: 'building',
            available: true,
          }),
        ])
      );
    });

    it('prevents another city from building a claimed Great Wonder', async () => {
      mockCities.set('city-2', {
        id: 'city-2',
        playerId: 'player-2',
        buildings: ['colossus'],
      });

      await handler.getAvailableProductions(mockSocket, {
        cityId: 'city-1',
        playerId: 'player-1',
      });

      const call = (mockSocket.emit as jest.MockedFunction<any>).mock.calls.find(
        (entry: any) => entry[0] === 'city:availableProductions'
      );
      expect(call[1].productions.find((production: any) => production.id === 'colossus')).toEqual(
        expect.objectContaining({ available: false })
      );
    });

    it('offers repeatable spaceship parts after Apollo until the national cap', async () => {
      mockCities.get('city-1').buildings.push('apollo_program', 'factory');
      mockPlayers.get('player-1').spaceshipState = {
        structurals: 1,
        components: 0,
        modules: 0,
      };

      await handler.getAvailableProductions(mockSocket, {
        cityId: 'city-1',
        playerId: 'player-1',
      });
      let call = (mockSocket.emit as jest.MockedFunction<any>).mock.calls.find(
        (entry: any) => entry[0] === 'city:availableProductions'
      );
      expect(
        call[1].productions.find((production: any) => production.id === 'space_structural')
      ).toEqual(expect.objectContaining({ available: true }));

      mockPlayers.get('player-1').spaceshipState.structurals = 32;
      (mockSocket.emit as jest.MockedFunction<any>).mockClear();
      await handler.getAvailableProductions(mockSocket, {
        cityId: 'city-1',
        playerId: 'player-1',
      });
      call = (mockSocket.emit as jest.MockedFunction<any>).mock.calls.find(
        (entry: any) => entry[0] === 'city:availableProductions'
      );
      expect(
        call[1].productions.find((production: any) => production.id === 'space_structural')
      ).toEqual(expect.objectContaining({ available: false }));
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

    it("uses ResearchManager's canonical technology lookup for building prerequisites", async () => {
      const canonicalResearchManager = {
        hasResearchedTech: jest.fn((_playerId: string, techId: string) => techId !== 'writing'),
      };
      const canonicalHandler = new CityProductionHandler(
        mockCities,
        mockPlayers,
        canonicalResearchManager
      );

      await canonicalHandler.getAvailableProductions(mockSocket, {
        cityId: 'city-1',
        playerId: 'player-1',
      });

      const call = (mockSocket.emit as jest.MockedFunction<any>).mock.calls.find(
        (entry: any) => entry[0] === 'city:availableProductions'
      );
      const library = call[1].productions.find((production: any) => production.id === 'library');
      expect(library.available).toBe(false);
      expect(canonicalResearchManager.hasResearchedTech).toHaveBeenCalledWith(
        'player-1',
        'writing'
      );
    });
  });

  describe('changeProduction', () => {
    it('delegates accepted production changes to the authoritative city manager', async () => {
      const persistProduction = jest.fn().mockResolvedValue(true);
      const authoritativeHandler = new CityProductionHandler(
        mockCities,
        mockPlayers,
        mockResearchManager,
        persistProduction
      );

      await authoritativeHandler.changeProduction(mockSocket, {
        cityId: 'city-1',
        playerId: 'player-1',
        productionId: 'explorer',
        productionType: 'unit',
      });

      expect(persistProduction).toHaveBeenCalledWith('city-1', 'unit', 'explorer', 'player-1');
    });

    it('should successfully change production to a valid unit', async () => {
      await handler.changeProduction(mockSocket, {
        cityId: 'city-1',
        playerId: 'player-1',
        productionId: 'explorer',
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
        previousProduction: 'warriors',
        previousType: 'unit',
      });
    });

    it('preserves shields when changing within the unit production class', async () => {
      const city = mockCities.get('city-1');
      city.shieldStock = 20;

      await handler.changeProduction(mockSocket, {
        cityId: 'city-1',
        playerId: 'player-1',
        productionId: 'explorer',
        productionType: 'unit',
      });

      const call = (mockSocket.emit as jest.MockedFunction<any>).mock.calls.find(
        (call: any) => call[0] === 'city:productionChanged'
      );

      expect(call[1].penalty).toBe(0);
      expect(call[1].shieldStock).toBe(20);
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
        productionId: 'warriors',
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
        previousProduction: 'warriors',
        previousType: 'unit',
      });
    });
  });

  describe('canCityBuildUnit', () => {
    it('allows Workers before any technology is researched', () => {
      const city = mockCities.get('city-1');
      const player = mockPlayers.get('player-1');
      mockResearchManager.hasPlayerResearched.mockReturnValue(false);

      expect((handler as any).canCityBuildUnit(city, UNIT_TYPES.worker, player)).toBe(true);
    });

    it('should allow building warrior with no tech requirements', () => {
      const city = mockCities.get('city-1');
      const player = mockPlayers.get('player-1');
      // Create a mock warrior unit type without required tech
      const unitType = {
        id: 'warriors',
        name: 'Warriors',
        cost: 10,
        attack: 1,
        defense: 1,
        hitpoints: 10,
        firepower: 1,
        move_rate: 3,
        // No requiredTech property - basic unit
      };

      const result = (handler as any).canCityBuildUnit(city, unitType, player);
      expect(result).toBe(true);
    });

    it('hides a unit when its researched replacement is buildable', () => {
      const city = mockCities.get('city-1');
      const player = mockPlayers.get('player-1');
      mockResearchManager.hasPlayerResearched.mockReturnValue(true);

      expect(
        (handler as any).canCityBuildUnit(
          city,
          {
            id: 'archers',
            obsolete_by: 'pikemen',
            flags: [],
          },
          player
        )
      ).toBe(false);
    });

    it('should prevent building settlers in size 1 city', () => {
      const city = mockCities.get('city-1');
      city.size = 1;
      const player = mockPlayers.get('player-1');
      // Create a mock settlers unit type
      const unitType = {
        id: 'settlers',
        name: 'Settlers',
        cost: 40,
        attack: 0,
        defense: 1,
        hitpoints: 20,
        firepower: 1,
        move_rate: 3,
      };

      const result = (handler as any).canCityBuildUnit(city, unitType, player);
      expect(result).toBe(false);
    });

    it('should check technology requirements', () => {
      const city = mockCities.get('city-1');
      const player = mockPlayers.get('player-1');
      // Create a unit type that requires technology
      const unitType = {
        id: 'advanced_unit',
        name: 'Advanced Unit',
        cost: 30,
        attack: 2,
        defense: 2,
        hitpoints: 15,
        firepower: 1,
        move_rate: 3,
        requiredTech: 'missing_tech',
      };

      mockResearchManager.hasPlayerResearched.mockReturnValue(false);

      const result = (handler as any).canCityBuildUnit(city, unitType, player);
      expect(result).toBe(false);
    });
  });

  describe('canCityBuildBuilding', () => {
    it('should prevent building duplicate buildings', async () => {
      const city = mockCities.get('city-1');
      const player = mockPlayers.get('player-1');
      const buildingType = BUILDING_TYPES.granary;

      const result = await (handler as any).canCityBuildBuilding(city, buildingType, player);
      expect(result).toBe(false);
    });

    it('should allow building new buildings', async () => {
      const city = mockCities.get('city-1');
      const player = mockPlayers.get('player-1');
      const buildingType = BUILDING_TYPES.barracks;

      const result = await (handler as any).canCityBuildBuilding(city, buildingType, player);
      expect(result).toBe(true);
    });

    it('should check technology requirements for buildings', async () => {
      const city = mockCities.get('city-1');
      const player = mockPlayers.get('player-1');
      const buildingType = { ...BUILDING_TYPES.barracks, requiredTech: 'missing_tech' };

      mockResearchManager.hasPlayerResearched.mockReturnValue(false);

      const result = await (handler as any).canCityBuildBuilding(city, buildingType, player);
      expect(result).toBe(false);
    });

    it('should enforce ruleset culture requirements', async () => {
      const requirementsManager = {
        evaluateRulesetCultureRequirements: jest.fn().mockResolvedValue({
          satisfied: false,
          reason: 'requires minimum 100 culture',
        }),
      };
      const cultureHandler = new CityProductionHandler(
        mockCities,
        mockPlayers,
        mockResearchManager,
        undefined,
        requirementsManager
      );
      const city = mockCities.get('city-1');
      const player = mockPlayers.get('player-1');
      const buildingType = {
        ...BUILDING_TYPES.barracks,
        cultureRequirements: [{ type: 'MinCulture', value: 100, range: 'City', present: true }],
      };

      await expect(
        (cultureHandler as any).canCityBuildBuilding(city, buildingType, player)
      ).resolves.toBe(false);
      expect(requirementsManager.evaluateRulesetCultureRequirements).toHaveBeenCalledWith(
        buildingType.cultureRequirements,
        expect.objectContaining({ cityId: city.id, playerId: player.id })
      );
    });
  });

  describe('calculateProductionChangePenalty', () => {
    it('should return 0 penalty for same production', () => {
      const city = mockCities.get('city-1');

      const penalty = (handler as any).calculateProductionChangePenalty(city, 'warriors', 'unit');

      expect(penalty).toBe(0);
    });

    it('does not penalize a change within the unit class', () => {
      const city = mockCities.get('city-1');
      city.shieldStock = 20;

      const penalty = (handler as any).calculateProductionChangePenalty(city, 'explorer', 'unit');

      expect(penalty).toBe(0);
    });

    it('retains half the shields when crossing production classes', () => {
      const city = mockCities.get('city-1');
      city.shieldStock = 20;

      const penalty = (handler as any).calculateProductionChangePenalty(
        city,
        'barracks',
        'building'
      );

      expect(penalty).toBe(10);
    });

    it('should handle no shield stock gracefully', () => {
      const city = mockCities.get('city-1');
      city.shieldStock = 0;

      const penalty = (handler as any).calculateProductionChangePenalty(
        city,
        'barracks',
        'building'
      );

      expect(penalty).toBe(0);
    });
  });

  describe('getUnitDescription', () => {
    it('should generate description for combat unit', () => {
      const unitType = { combat: 5, movement: 1 };
      const description = (handler as any).getUnitDescription(unitType);

      expect(description).toContain('Attack: 5');
      expect(description).toContain('Movement: 1');
    });

    it('should handle special abilities', () => {
      const unitType = {
        combat: 0,
        movement: 1,
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
    it('describes Wealth as an ongoing shield-to-gold conversion', () => {
      const description = (handler as any).getBuildingDescription({
        genus: 'Convert',
        flags: 'Gold',
      });

      expect(description).toBe('Converts shields to gold while selected');
    });

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
