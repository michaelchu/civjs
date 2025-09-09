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
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('CityManager', () => {
  let cityManager: CityManager;
  const gameId = 'test-game-id';

  beforeEach(() => {
    const mockDbProvider = createMockDatabaseProvider();
    cityManager = new CityManager(gameId, mockDbProvider);
    jest.clearAllMocks();
  });

  describe('building types', () => {
    it('should have valid building type definitions', () => {
      expect(BUILDING_TYPES.palace).toBeDefined();
      expect(BUILDING_TYPES.palace.name).toBe('Palace');
      expect(BUILDING_TYPES.palace.cost).toBe(100);
      expect(BUILDING_TYPES.palace.effects.defenseBonus).toBe(100);

      expect(BUILDING_TYPES.library).toBeDefined();
      expect(BUILDING_TYPES.library.name).toBe('Library');
      expect(BUILDING_TYPES.library.effects.scienceBonus).toBe(50);

      expect(BUILDING_TYPES.granary).toBeDefined();
      expect(BUILDING_TYPES.granary.effects.foodBonus).toBe(50);
    });
  });

  describe('city founding', () => {
    it('should found a city successfully', async () => {
      const cityId = await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);

      // Should return a generated city ID
      expect(cityId).toBeDefined();
      expect(typeof cityId).toBe('string');

      const city = cityManager.getCity(cityId);
      expect(city).toBeDefined();
      expect(city!.name).toBe('TestCity');
      expect(city!.population).toBe(1);
    });
  });

  describe('city refresh', () => {
    let cityId: string;

    beforeEach(async () => {
      cityId = await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);
    });

    it('should calculate basic city outputs', () => {
      cityManager.refreshCity(cityId);

      const city = cityManager.getCity(cityId);
      expect(city).toBeDefined();

      // City center gives 2 food, 1 shield, 1 trade
      // Population of 1 eats 2 food
      expect(city!.foodPerTurn).toBe(0); // 2 food - 2 upkeep = 0
      expect(city!.productionPerTurn).toBe(1); // 1 shield
      // With 1 trade: Math.floor(1/2) = 0 for each science and gold
      expect(city!.sciencePerTurn).toBe(0); // Math.floor(1 trade / 2) = 0
      expect(city!.goldPerTurn).toBe(0); // Math.floor(1 trade / 2) = 0
      expect(city!.luxuryPerTurn).toBe(0); // No specialists initially
      expect(city!.granarySize).toBe(20); // (1 + 1) * 10 = 20
      expect(city!.granaryTurns).toBe(0); // No surplus food, so blocked growth
    });

    it('should apply building bonuses correctly', () => {
      const city = cityManager.getCity(cityId)!;
      city.buildings.push('library'); // +50% science
      city.buildings.push('marketplace'); // +50% gold

      cityManager.refreshCity(cityId);

      // With bonuses: tradeAfterBonus = Math.floor(1 * (100 + 50 + 50) / 100) = 2
      // Split: Math.floor(2/2) = 1 each for science and gold
      expect(city.sciencePerTurn).toBe(1); // Math.floor(2/2) = 1
      expect(city.goldPerTurn).toBe(1); // Math.floor(2/2) = 1
      expect(city.happinessLevel).toBe(50); // No happiness buildings
    });

    it('should calculate defense bonuses', () => {
      const city = cityManager.getCity(cityId)!;
      city.buildings.push('walls'); // +200% defense
      city.buildings.push('barracks'); // +50% defense

      cityManager.refreshCity(cityId);

      expect(city.defenseStrength).toBe(3); // 1 base * (100% + 200% + 50%) / 100 = 3.5 -> floor = 3
    });
  });

  describe('production management', () => {
    let cityId: string;

    beforeEach(async () => {
      cityId = await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);
    });

    it('should set unit production successfully', async () => {
      await cityManager.setCityProduction(cityId, 'warrior', 'unit');

      const city = cityManager.getCity(cityId)!;
      expect(city.currentProduction).toBe('warrior');
      expect(city.productionType).toBe('unit');
      expect(city.turnsToComplete).toBeGreaterThan(0);
    });

    it('should set building production successfully', async () => {
      await cityManager.setCityProduction(cityId, 'granary', 'building');

      const city = cityManager.getCity(cityId)!;
      expect(city.currentProduction).toBe('granary');
      expect(city.productionType).toBe('building');
      expect(city.turnsToComplete).toBe(60); // Granary costs 60, production 1 per turn
    });

    it('should reject invalid unit type', async () => {
      await expect(cityManager.setCityProduction(cityId, 'invalid-unit', 'unit')).rejects.toThrow(
        'Unknown unit type: invalid-unit'
      );
    });

    it('should reject invalid building type', async () => {
      await expect(
        cityManager.setCityProduction(cityId, 'invalid-building', 'building')
      ).rejects.toThrow('Unknown building type: invalid-building');
    });
  });

  // City growth is handled by the turn system
  // Individual growth methods are not exposed in the public API

  describe('utility functions', () => {
    it('should cleanup cities correctly', async () => {
      const cityId = await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);
      expect(cityManager.getCity(cityId)).toBeDefined();

      cityManager.cleanup();
      expect(cityManager.getCity(cityId)).toBeUndefined();
    });

    it('should provide debug information', async () => {
      await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);

      const debugInfo = cityManager.getDebugInfo();
      expect(debugInfo).toEqual({
        gameId: gameId,
        cityCount: 1,
        cities: expect.arrayContaining([
          expect.objectContaining({
            name: 'TestCity',
            population: 1,
          }),
        ]),
      });
    });
  });

  describe('specialist management', () => {
    let cityId: string;

    beforeEach(async () => {
      cityId = await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);
    });

    it('should initialize cities with no specialists', () => {
      const city = cityManager.getCity(cityId)!;

      expect(city.specialists[SpecialistType.SCIENTIST]).toBe(0);
      expect(city.specialists[SpecialistType.TAX_COLLECTOR]).toBe(0);
      expect(city.specialists[SpecialistType.ENTERTAINER]).toBe(0);
      expect(city.specialists[SpecialistType.WORKER]).toBe(0);
      expect(city.specialists[SpecialistType.ENGINEER]).toBe(0);
      expect(city.specialists[SpecialistType.MERCHANT]).toBe(0);
    });

    it('should change specialist types successfully', async () => {
      const city = cityManager.getCity(cityId)!;

      // Manually add a scientist to test conversion
      city.specialists[SpecialistType.SCIENTIST] = 1;

      await cityManager.changeSpecialist(
        cityId,
        SpecialistType.SCIENTIST,
        SpecialistType.TAX_COLLECTOR,
        'player-123'
      );

      expect(city.specialists[SpecialistType.SCIENTIST]).toBe(0);
      expect(city.specialists[SpecialistType.TAX_COLLECTOR]).toBe(1);
    });

    it('should handle auto-cycling without Adam Smith wonder', async () => {
      const city = cityManager.getCity(cityId)!;
      city.specialists[SpecialistType.ENTERTAINER] = 1;

      // Auto-cycle (should cycle through first 3 specialists only)
      await cityManager.changeSpecialist(
        cityId,
        SpecialistType.ENTERTAINER, // From 2
        -1, // Auto-cycle
        'player-123',
        false // No Adam Smith
      );

      expect(city.specialists[SpecialistType.ENTERTAINER]).toBe(0);
      expect(city.specialists[SpecialistType.SCIENTIST]).toBe(1); // 2+1 % 3 = 0
    });

    it('should handle auto-cycling with Adam Smith wonder', async () => {
      const city = cityManager.getCity(cityId)!;
      city.specialists[SpecialistType.MERCHANT] = 1; // Specialist 5

      await cityManager.changeSpecialist(
        cityId,
        SpecialistType.MERCHANT,
        -1, // Auto-cycle
        'player-123',
        true // Has Adam Smith
      );

      expect(city.specialists[SpecialistType.MERCHANT]).toBe(0);
      expect(city.specialists[SpecialistType.SCIENTIST]).toBe(1); // 5+1 % 6 = 0
    });

    it('should reject extended specialists without Adam Smith wonder', async () => {
      const city = cityManager.getCity(cityId)!;
      city.specialists[SpecialistType.SCIENTIST] = 1;

      await expect(
        cityManager.changeSpecialist(
          cityId,
          SpecialistType.SCIENTIST,
          SpecialistType.WORKER, // Extended specialist
          'player-123',
          false // No Adam Smith
        )
      ).rejects.toThrow("Extended specialists require Adam Smith's Trading Company");
    });

    it('should calculate specialist outputs correctly', () => {
      const city = cityManager.getCity(cityId)!;

      // Add specialists: 1 scientist, 1 tax collector, 1 entertainer
      city.specialists[SpecialistType.SCIENTIST] = 1;
      city.specialists[SpecialistType.TAX_COLLECTOR] = 1;
      city.specialists[SpecialistType.ENTERTAINER] = 1;

      cityManager.refreshCity(cityId);

      // Base trade = 1, specialists add: 3 science, 3 gold, 3 luxury
      expect(city.sciencePerTurn).toBe(3); // 0 from trade + 3 from specialist
      expect(city.goldPerTurn).toBe(3); // 0 from trade + 3 from specialist
      expect(city.luxuryPerTurn).toBe(3); // 3 from specialist
    });
  });

  describe('production queue and worklist', () => {
    let cityId: string;

    beforeEach(async () => {
      cityId = await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);
    });

    it('should initialize cities with empty worklist', () => {
      const city = cityManager.getCity(cityId)!;
      expect(city.worklist).toEqual([]);
    });

    it('should add items to worklist successfully', async () => {
      // First set some production so worklist doesn't get consumed
      await cityManager.setCityProduction(cityId, 'warrior', 'unit');

      const items = [
        { kind: 'unit' as const, value: 'warrior', name: 'Warrior', cost: 10, vutKind: VUT_UTYPE },
        {
          kind: 'building' as const,
          value: 'granary',
          name: 'Granary',
          cost: 60,
          vutKind: VUT_IMPROVEMENT,
        },
      ];

      await cityManager.addToWorklist(cityId, items);

      const city = cityManager.getCity(cityId)!;
      expect(city.worklist).toHaveLength(2);
      expect(city.worklist[0].name).toBe('Warrior');
      expect(city.worklist[1].name).toBe('Granary');
    });

    it('should generate available production options', () => {
      const availableProductions = cityManager.getAvailableProductions(cityId);

      // Should include units and buildings with VUT constants
      const unitProduction = availableProductions.find(p => p.kind === 'unit');
      const buildingProduction = availableProductions.find(p => p.kind === 'building');

      expect(unitProduction).toBeDefined();
      expect(unitProduction?.vutKind).toBe(VUT_UTYPE);

      expect(buildingProduction).toBeDefined();
      expect(buildingProduction?.vutKind).toBe(VUT_IMPROVEMENT);
    });

    it('should prevent duplicate buildings in queue', async () => {
      const city = cityManager.getCity(cityId)!;
      city.buildings.push('granary'); // Already built

      const items = [{ kind: 'building' as const, value: 'granary', name: 'Granary', cost: 60 }];

      await expect(cityManager.addToWorklist(cityId, items)).rejects.toThrow(
        'Cannot queue Granary: requirements not met'
      );
    });
  });

  describe('granary mechanics', () => {
    let cityId: string;

    beforeEach(async () => {
      cityId = await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);
    });

    it('should calculate granary size correctly', () => {
      const city = cityManager.getCity(cityId)!;

      expect(city.granarySize).toBe(20); // (1 + 1) * 10 = 20

      // Simulate growth
      city.population = 3;
      cityManager.refreshCity(cityId);

      expect(city.granarySize).toBe(40); // (3 + 1) * 10 = 40
    });

    it('should calculate growth turns correctly', () => {
      const city = cityManager.getCity(cityId)!;

      // Set up conditions for proper calculation - need to modify before refresh
      city.foodStock = 10;
      city.foodPerTurn = 2; // This gets overwritten by refresh, so we need to set it manually after

      cityManager.refreshCity(cityId);

      // Override the calculated foodPerTurn for this test
      city.foodPerTurn = 2;
      city.granaryTurns = cityManager['calculateGranaryTurns'](
        city.population,
        city.foodStock,
        city.foodPerTurn
      );

      // Need 20 food for next growth, have 10, gaining 2 per turn
      // (20 - 10) / 2 = 5 turns
      expect(city.granaryTurns).toBe(5);
    });

    it('should handle starvation calculations', () => {
      const city = cityManager.getCity(cityId)!;
      city.population = 2; // Can starve

      city.foodStock = 4;
      city.foodPerTurn = -2; // Losing food
      cityManager.refreshCity(cityId);

      // 4 food / 2 loss per turn = 2 turns to starvation
      expect(city.granaryTurns).toBe(-2);
    });
  });

  describe('VUT constants and freeciv-web compliance', () => {
    it('should define correct VUT constants', () => {
      expect(VUT_UTYPE).toBe(0);
      expect(VUT_IMPROVEMENT).toBe(1);
    });

    it('should convert between VUT and string types', () => {
      expect(vutToProductionKind(VUT_UTYPE)).toBe('unit');
      expect(vutToProductionKind(VUT_IMPROVEMENT)).toBe('building');

      expect(productionKindToVut('unit')).toBe(VUT_UTYPE);
      expect(productionKindToVut('building')).toBe(VUT_IMPROVEMENT);
    });

    it('should have correct specialist definitions', () => {
      expect(SPECIALIST_TYPES[SpecialistType.SCIENTIST].name).toBe('Scientist');
      expect(SPECIALIST_TYPES[SpecialistType.SCIENTIST].outputType).toBe('science');
      expect(SPECIALIST_TYPES[SpecialistType.SCIENTIST].outputAmount).toBe(3);

      expect(SPECIALIST_TYPES[SpecialistType.WORKER].requiredWonder).toBe(
        "Adam Smith's Trading Company"
      );
    });
  });

  describe('happiness system', () => {
    let cityId: string;

    beforeEach(async () => {
      cityId = await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);
    });

    it('should initialize cities with basic happiness', () => {
      const city = cityManager.getCity(cityId)!;

      expect(city.happiness.happy).toBe(1);
      expect(city.happiness.content).toBe(0);
      expect(city.happiness.unhappy).toBe(0);
      expect(city.happiness.angry).toBe(0);
    });

    it('should calculate detailed happiness breakdown', () => {
      const result = cityManager.calculateDetailedHappiness(cityId, 'despotism', 0);

      expect(result.breakdown).toBeDefined();
      expect(result.breakdown.luxuryEffect).toBe(0); // No luxury initially
      expect(result.breakdown.buildingHappiness).toBe(0); // No buildings
    });

    it('should detect unhappy cities', () => {
      const city = cityManager.getCity(cityId)!;
      city.happiness.unhappy = 2;
      city.happiness.happy = 1;

      expect(cityManager.isCityUnhappy(cityId)).toBe(true);
    });

    it('should get city state descriptions', () => {
      expect(cityManager.getCityStateDescription(cityId)).toBe('Peace');

      const city = cityManager.getCity(cityId)!;
      city.population = 2; // Must be > 1 to starve
      city.foodPerTurn = -1;

      expect(cityManager.getCityStateDescription(cityId)).toBe('Famine');
    });
  });
});
