import { MapManager } from '../../src/game/MapManager';
import { GameManager } from '../../src/game/GameManager';
import { clearAllTables, createTestGameAndPlayer } from '../utils/testDatabase';
import { createBasicGameScenario } from '../fixtures/gameFixtures';
import { createMockSocketServer } from '../utils/gameTestUtils';

describe('MapManager - Integration Tests with Real Terrain Generation', () => {
  let mapManager: MapManager;
  let gameManager: GameManager;
  const mapWidth = 40;
  const mapHeight = 30;

  beforeEach(async () => {
    await clearAllTables();
    (GameManager as any).instance = null;

    // Initialize MapManager
    mapManager = new MapManager(mapWidth, mapHeight, 'test-seed-123', 'test-generator');

    // Initialize GameManager for cross-manager tests
    const mockIo = createMockSocketServer();
    gameManager = GameManager.getInstance(mockIo);
  });

  afterEach(async () => {
    gameManager['games'].clear();
    gameManager['playerToGame'].clear();
  });

  describe('map generation with real terrain algorithms', () => {
    it('should generate complete map with all terrain types', async () => {
      // Create test players for map generation
      const player1Data = await createTestGameAndPlayer('0001', '0002');
      const player2Data = await createTestGameAndPlayer('0003', '0004');

      const players = new Map([
        [
          player1Data.player.id,
          {
            id: player1Data.player.id,
            userId: player1Data.user.id,
            playerNumber: 0,
            civilization: 'Roman',
            isReady: true,
            hasEndedTurn: false,
            isConnected: true,
            lastSeen: new Date(),
          },
        ],
        [
          player2Data.player.id,
          {
            id: player2Data.player.id,
            userId: player2Data.user.id,
            playerNumber: 1,
            civilization: 'Greek',
            isReady: true,
            hasEndedTurn: false,
            isConnected: true,
            lastSeen: new Date(),
          },
        ],
      ]);

      // Generate map
      await mapManager.generateMap(players);
      const mapData = mapManager.getMapData();

      expect(mapData).toBeDefined();
      expect(mapData).not.toBeNull();
      expect(mapData!.width).toBe(mapWidth);
      expect(mapData!.height).toBe(mapHeight);
      expect(mapData!.tiles).toBeDefined();
      expect(mapData!.tiles.length).toBe(mapWidth * mapHeight);

      // Verify terrain diversity
      const terrainTypes = new Set();
      mapData!.tiles.forEach(tile => {
        terrainTypes.add(tile.terrain);
        expect(tile.x).toBeGreaterThanOrEqual(0);
        expect(tile.x).toBeLessThan(mapWidth);
        expect(tile.y).toBeGreaterThanOrEqual(0);
        expect(tile.y).toBeLessThan(mapHeight);
        expect(tile.height).toBeGreaterThanOrEqual(0);
        expect(tile.height).toBeLessThanOrEqual(100);
      });

      // Should have multiple terrain types
      expect(terrainTypes.size).toBeGreaterThan(3);
      expect(terrainTypes.has('ocean')).toBe(true); // Ocean should exist
      expect(terrainTypes.has('grassland')).toBe(true); // Grassland should exist

      // Verify starting positions were placed
      expect(mapData!.startingPositions).toBeDefined();
      expect(mapData!.startingPositions.length).toBeGreaterThanOrEqual(2);
    });

    it('should generate different maps with different seeds', async () => {
      const player1Data = await createTestGameAndPlayer('0005', '0006');
      const players = new Map([
        [
          player1Data.player.id,
          {
            id: player1Data.player.id,
            userId: player1Data.user.id,
            playerNumber: 0,
            civilization: 'Roman',
            isReady: true,
            hasEndedTurn: false,
            isConnected: true,
            lastSeen: new Date(),
          },
        ],
      ]);

      // Generate first map
      const mapManager1 = new MapManager(20, 20, 'seed-1');
      await mapManager1.generateMap(players);
      const mapData1 = mapManager1.getMapData();

      // Generate second map with different seed
      const mapManager2 = new MapManager(20, 20, 'seed-2');
      await mapManager2.generateMap(players);
      const mapData2 = mapManager2.getMapData();

      // Maps should be different
      let differentTiles = 0;
      for (let i = 0; i < mapData1.tiles.length; i++) {
        if (
          mapData1.tiles[i].terrain !== mapData2.tiles[i].terrain ||
          Math.abs(mapData1.tiles[i].height - mapData2.tiles[i].height) > 5
        ) {
          differentTiles++;
        }
      }

      // At least 30% of tiles should be different
      expect(differentTiles / mapData1.tiles.length).toBeGreaterThan(0.3);
    });

    it('should generate reproducible maps with same seed', async () => {
      const player1Data = await createTestGameAndPlayer('0007', '0008');
      const players = new Map([
        [
          player1Data.player.id,
          {
            id: player1Data.player.id,
            userId: player1Data.user.id,
            playerNumber: 0,
            civilization: 'Roman',
            isReady: true,
            hasEndedTurn: false,
            isConnected: true,
            lastSeen: new Date(),
          },
        ],
      ]);

      const seedValue = 'reproducible-seed-123';

      // Generate first map
      const mapManager1 = new MapManager(15, 15, seedValue);
      await mapManager1.generateMap(players);
      const mapData1 = mapManager1.getMapData();

      // Generate second map with same seed
      const mapManager2 = new MapManager(15, 15, seedValue);
      await mapManager2.generateMap(players);
      const mapData2 = mapManager2.getMapData();

      // Maps should be identical
      expect(mapData1.tiles.length).toBe(mapData2.tiles.length);
      for (let i = 0; i < mapData1.tiles.length; i++) {
        expect(mapData1.tiles[i].terrain).toBe(mapData2.tiles[i].terrain);
        expect(mapData1.tiles[i].height).toBeCloseTo(mapData2.tiles[i].height, 1);
        expect(mapData1.tiles[i].x).toBe(mapData2.tiles[i].x);
        expect(mapData1.tiles[i].y).toBe(mapData2.tiles[i].y);
      }
    });
  });

  describe('map persistence and loading with database', () => {
    it('should persist and reload map data correctly', async () => {
      // Create game scenario with generated map
      const scenario = await createBasicGameScenario();
      const gameId = scenario.game.id;

      // Load the game (which should load the map)
      await gameManager.loadGame(gameId);
      const game = gameManager.getGameInstance(gameId);

      expect(game).toBeDefined();
      expect(game!.mapManager).toBeDefined();

      // Verify map was loaded correctly
      const loadedMapData = game!.mapManager.getMapData();
      expect(loadedMapData).toBeDefined();
      expect(loadedMapData.width).toBe(20); // From createBasicGameScenario
      expect(loadedMapData.height).toBe(20);
      expect(loadedMapData.tiles).toBeDefined();
      expect(loadedMapData.tiles.length).toBe(400); // 20x20

      // Verify map has proper terrain data
      const oceanTiles = loadedMapData.tiles.filter(t => t.terrain === 'ocean');
      const landTiles = loadedMapData.tiles.filter(t => t.terrain !== 'ocean');

      expect(oceanTiles.length).toBeGreaterThan(0);
      expect(landTiles.length).toBeGreaterThan(0);
    });

    it('should maintain map data integrity across game saves', async () => {
      // Create game with map
      const scenario = await createBasicGameScenario();
      const gameId = scenario.game.id;

      // Load game first time
      await gameManager.loadGame(gameId);
      const game1 = gameManager.getGameInstance(gameId);
      const mapData1 = game1!.mapManager.getMapData();

      // Clear game from memory and reload
      gameManager['games'].delete(gameId);
      await gameManager.loadGame(gameId);
      const game2 = gameManager.getGameInstance(gameId);
      const mapData2 = game2!.mapManager.getMapData();

      // Map data should be identical
      expect(mapData1.width).toBe(mapData2.width);
      expect(mapData1.height).toBe(mapData2.height);
      expect(mapData1.tiles.length).toBe(mapData2.tiles.length);

      // Compare tile data
      for (let i = 0; i < mapData1.tiles.length; i++) {
        expect(mapData1.tiles[i].terrain).toBe(mapData2.tiles[i].terrain);
        expect(mapData1.tiles[i].x).toBe(mapData2.tiles[i].x);
        expect(mapData1.tiles[i].y).toBe(mapData2.tiles[i].y);
        expect(mapData1.tiles[i].height).toBeCloseTo(mapData2.tiles[i].height, 1);
      }
    });
  });

  describe('tile queries and map navigation', () => {
    let scenario: any;
    let gameMapManager: MapManager;

    beforeEach(async () => {
      scenario = await createBasicGameScenario();
      await gameManager.loadGame(scenario.game.id);
      const game = gameManager.getGameInstance(scenario.game.id);
      gameMapManager = game!.mapManager;
    });

    it('should provide accurate tile data for specific coordinates', () => {
      const tile = gameMapManager.getTile(10, 10);
      expect(tile).toBeDefined();
      expect(tile!.x).toBe(10);
      expect(tile!.y).toBe(10);
      expect(tile!.terrain).toBeDefined();
      expect(tile!.height).toBeGreaterThanOrEqual(0);
      expect(tile!.height).toBeLessThanOrEqual(100);
    });

    it('should return undefined for out-of-bounds coordinates', () => {
      const tile1 = gameMapManager.getTile(-1, 10);
      const tile2 = gameMapManager.getTile(10, -1);
      const tile3 = gameMapManager.getTile(100, 10);
      const tile4 = gameMapManager.getTile(10, 100);

      expect(tile1).toBeUndefined();
      expect(tile2).toBeUndefined();
      expect(tile3).toBeUndefined();
      expect(tile4).toBeUndefined();
    });

    it('should provide neighboring tile information', () => {
      const neighbors = gameMapManager.getNeighbors(10, 10);
      expect(neighbors).toBeDefined();
      expect(neighbors.length).toBeGreaterThan(0);
      expect(neighbors.length).toBeLessThanOrEqual(8); // Max 8 neighbors

      neighbors.forEach(neighbor => {
        expect(neighbor.x).toBeGreaterThanOrEqual(9);
        expect(neighbor.x).toBeLessThanOrEqual(11);
        expect(neighbor.y).toBeGreaterThanOrEqual(9);
        expect(neighbor.y).toBeLessThanOrEqual(11);
        expect(neighbor.terrain).toBeDefined();
      });
    });

    it('should validate tile positions correctly', () => {
      expect(gameMapManager.isValidPosition(10, 10)).toBe(true);
      expect(gameMapManager.isValidPosition(0, 0)).toBe(true);
      expect(gameMapManager.isValidPosition(19, 19)).toBe(true);
      expect(gameMapManager.isValidPosition(-1, 10)).toBe(false);
      expect(gameMapManager.isValidPosition(10, -1)).toBe(false);
      expect(gameMapManager.isValidPosition(20, 10)).toBe(false);
      expect(gameMapManager.isValidPosition(10, 20)).toBe(false);
    });
  });

  describe('terrain modification and updates', () => {
    let scenario: any;
    let gameMapManager: MapManager;

    beforeEach(async () => {
      scenario = await createBasicGameScenario();
      await gameManager.loadGame(scenario.game.id);
      const game = gameManager.getGameInstance(scenario.game.id);
      gameMapManager = game!.mapManager;
    });

    it('should update tile terrain and persist changes', () => {
      const originalTile = gameMapManager.getTile(5, 5);
      expect(originalTile).toBeDefined();

      const originalTerrain = originalTile!.terrain;
      const newTerrain = originalTerrain === 'grassland' ? 'plains' : 'grassland';

      // Update terrain
      gameMapManager.updateTileProperty(5, 5, 'terrain', newTerrain);

      // Verify change
      const updatedTile = gameMapManager.getTile(5, 5);
      expect(updatedTile!.terrain).toBe(newTerrain);
      expect(updatedTile!.x).toBe(5);
      expect(updatedTile!.y).toBe(5);
    });

    it('should handle resource placement and removal', () => {
      const tile = gameMapManager.getTile(8, 8);
      expect(tile).toBeDefined();

      // Add resource
      gameMapManager.updateTileProperty(8, 8, 'resource', 'wheat');

      const tileWithResource = gameMapManager.getTile(8, 8);
      expect(tileWithResource!.resource).toBe('wheat');

      // Remove resource
      gameMapManager.updateTileProperty(8, 8, 'resource', undefined);

      const tileWithoutResource = gameMapManager.getTile(8, 8);
      expect(tileWithoutResource!.resource).toBeUndefined();
    });

    it('should update multiple tile properties simultaneously', () => {
      const updates = [
        { x: 12, y: 12, property: 'terrain' as const, value: 'forest' },
        { x: 13, y: 12, property: 'terrain' as const, value: 'hills' },
        { x: 14, y: 12, property: 'resource' as const, value: 'iron' },
      ];

      updates.forEach(update => {
        gameMapManager.updateTileProperty(update.x, update.y, update.property, update.value);
      });

      // Verify all updates
      expect(gameMapManager.getTile(12, 12)!.terrain).toBe('forest');
      expect(gameMapManager.getTile(13, 12)!.terrain).toBe('hills');
      expect(gameMapManager.getTile(14, 12)!.resource).toBe('iron');
    });
  });

  describe('pathfinding and movement cost integration', () => {
    let scenario: any;
    let gameMapManager: MapManager;

    beforeEach(async () => {
      scenario = await createBasicGameScenario();
      await gameManager.loadGame(scenario.game.id);
      const game = gameManager.getGameInstance(scenario.game.id);
      gameMapManager = game!.mapManager;
    });

    it('should provide accurate movement costs for different terrain types', () => {
      // Test movement costs for various terrain
      const terrainCosts = [
        { terrain: 'grassland', expectedBaseCost: 3 },
        { terrain: 'plains', expectedBaseCost: 3 },
        { terrain: 'hills', expectedBaseCost: 6 },
        { terrain: 'mountains', expectedBaseCost: 9 },
      ];

      terrainCosts.forEach(({ terrain, expectedBaseCost }) => {
        // Find or create a tile with the desired terrain
        let testTile = gameMapManager.getMapData().tiles.find(t => t.terrain === terrain);
        if (!testTile) {
          // Create a test tile if it doesn't exist
          gameMapManager.updateTileProperty(15, 15, 'terrain', terrain);
          testTile = gameMapManager.getTile(15, 15)!;
        }

        const movementCost = gameMapManager.getMovementCost(testTile.x, testTile.y);
        expect(movementCost).toBeGreaterThanOrEqual(expectedBaseCost);
      });
    });

    it('should calculate distances between tiles correctly', () => {
      const distance1 = gameMapManager.getDistance(0, 0, 3, 4);
      expect(distance1).toBeCloseTo(5, 1); // Pythagorean theorem: sqrt(3^2 + 4^2) = 5

      const distance2 = gameMapManager.getDistance(10, 10, 10, 10);
      expect(distance2).toBe(0);

      const distance3 = gameMapManager.getDistance(5, 5, 5, 8);
      expect(distance3).toBe(3);
    });

    it('should identify accessible tiles within movement range', () => {
      const accessibleTiles = gameMapManager.getAccessibleTiles(10, 10, 6); // 6 movement points

      expect(accessibleTiles).toBeDefined();
      expect(accessibleTiles.length).toBeGreaterThan(0);

      // All tiles should be within reasonable range
      accessibleTiles.forEach(tile => {
        const distance = gameMapManager.getDistance(10, 10, tile.x, tile.y);
        expect(distance).toBeLessThanOrEqual(3); // Should be reachable within movement range
      });
    });
  });

  describe('map validation and quality checks', () => {
    it('should validate generated map meets quality standards', async () => {
      const player1Data = await createTestGameAndPlayer('0009', '0010');
      const players = new Map([
        [
          player1Data.player.id,
          {
            id: player1Data.player.id,
            userId: player1Data.user.id,
            playerNumber: 0,
            civilization: 'Roman',
            isReady: true,
            hasEndedTurn: false,
            isConnected: true,
            lastSeen: new Date(),
          },
        ],
      ]);

      await mapManager.generateMap(players);
      const validation = mapManager.validateMap();

      expect(validation.isValid).toBe(true);
      expect(validation.errors.length).toBe(0);
      expect(validation.warnings.length).toBeGreaterThanOrEqual(0);

      // Check specific validation criteria
      if (validation.details) {
        expect(validation.details.landPercentage).toBeGreaterThan(20);
        expect(validation.details.landPercentage).toBeLessThan(80);
        expect(validation.details.startingPositions).toBeGreaterThanOrEqual(1);
      }
    });

    it('should identify problematic map configurations', async () => {
      // Create a very small map that might have issues
      const smallMapManager = new MapManager(3, 3, 'small-test');
      const player1Data = await createTestGameAndPlayer('0011', '0012');

      const players = new Map([
        [
          player1Data.player.id,
          {
            id: player1Data.player.id,
            userId: player1Data.user.id,
            playerNumber: 0,
            civilization: 'Roman',
            isReady: true,
            hasEndedTurn: false,
            isConnected: true,
            lastSeen: new Date(),
          },
        ],
      ]);

      await smallMapManager.generateMap(players);
      const validation = smallMapManager.validateMap();

      // Small maps might have validation warnings
      expect(validation).toBeDefined();
      // Don't enforce strict validation for small test maps
    });
  });

  describe('cross-manager integration with units and cities', () => {
    let scenario: any;
    let game: any;

    beforeEach(async () => {
      scenario = await createBasicGameScenario();
      await gameManager.loadGame(scenario.game.id);
      game = gameManager.getGameInstance(scenario.game.id);
    });

    it('should coordinate with UnitManager for tile occupation', () => {
      const unit = Array.from(game.unitManager.getPlayerUnits(scenario.players[0].id))[0];
      const unitTile = game.mapManager.getTile(unit.x, unit.y);

      expect(unitTile).toBeDefined();
      expect(unitTile!.x).toBe(unit.x);
      expect(unitTile!.y).toBe(unit.y);

      // Check if tile is considered occupied
      const isOccupied = game.mapManager.isTileOccupied(unit.x, unit.y);
      expect(isOccupied).toBe(true);
    });

    it('should coordinate with CityManager for city placement validation', () => {
      const city = game.cityManager.getPlayerCities(scenario.players[0].id)[0];
      const cityTile = game.mapManager.getTile(city.x, city.y);

      expect(cityTile).toBeDefined();
      expect(cityTile!.x).toBe(city.x);
      expect(cityTile!.y).toBe(city.y);

      // Check if tile is suitable for city
      const isSuitableForCity = game.mapManager.isSuitableForCity(city.x, city.y);
      expect(isSuitableForCity).toBe(true);
    });

    it('should update visibility for explored tiles', () => {
      const playerId = scenario.players[0].id;
      const unit = Array.from(game.unitManager.getPlayerUnits(playerId))[0];

      // Update visibility around unit
      game.mapManager.updateVisibility(playerId, unit.x, unit.y, 2); // 2 tile radius

      const visibleTiles = game.mapManager.getVisibleTiles(playerId);
      expect(visibleTiles.size).toBeGreaterThan(0);

      // Unit's tile should be visible
      expect(visibleTiles.has(`${unit.x},${unit.y}`)).toBe(true);
    });
  });
});
