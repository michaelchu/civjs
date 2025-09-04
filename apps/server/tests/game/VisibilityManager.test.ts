import { beforeAll } from '@jest/globals';
import { VisibilityManager } from '../../src/game/VisibilityManager';
import { UnitManager } from '../../src/game/UnitManager';
import { MapManager } from '../../src/game/MapManager';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('VisibilityManager', () => {
  let visibilityManager: VisibilityManager;
  let unitManager: UnitManager;
  let mapManager: MapManager;
  const gameId = 'test-game-id';
  const mapWidth = 20;
  const mapHeight = 20;

  beforeAll(() => {
    // Terrain ruleset loaded synchronously on first access
  });

  beforeEach(async () => {
    // Setup managers
    const mockDbProvider = createMockDatabaseProvider();
    unitManager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight);
    mapManager = new MapManager(mapWidth, mapHeight);
    visibilityManager = new VisibilityManager(gameId, unitManager, mapManager);

    // Mock database operations for UnitManager
    let unitCounter = 0;
    mockDb.insert = jest.fn().mockReturnThis();
    mockDb.values = jest.fn().mockReturnThis();
    mockDb.returning = jest.fn().mockImplementation(() => {
      const unitId = `unit-${++unitCounter}`;
      return Promise.resolve([
        {
          id: unitId,
          gameId,
          playerId: 'player-123',
          unitType: 'warrior',
          x: 10,
          y: 10,
          health: 100,
          movementPoints: '2',
          veteranLevel: 0,
          isFortified: false,
        },
      ]);
    });
    mockDb.update = jest.fn().mockReturnThis();
    mockDb.set = jest.fn().mockReturnThis();
    mockDb.where = jest.fn().mockReturnThis();
    mockDb.select = jest.fn().mockReturnThis();
    mockDb.from = jest.fn().mockReturnThis();
    mockDb.delete = jest.fn().mockReturnThis();

    // Generate a simple test map
    await mapManager.generateMap(new Map());

    jest.clearAllMocks();
  });

  describe('player initialization', () => {
    it('should initialize visibility for a new player', () => {
      visibilityManager.initializePlayerVisibility('player-123');

      const visibleTiles = visibilityManager.getVisibleTiles('player-123');
      const exploredTiles = visibilityManager.getExploredTiles('player-123');

      expect(visibleTiles.size).toBe(0);
      expect(exploredTiles.size).toBe(0);
    });

    it('should handle multiple players independently', () => {
      visibilityManager.initializePlayerVisibility('player-1');
      visibilityManager.initializePlayerVisibility('player-2');

      const player1Visible = visibilityManager.getVisibleTiles('player-1');
      const player2Visible = visibilityManager.getVisibleTiles('player-2');

      expect(player1Visible).not.toBe(player2Visible);
      expect(player1Visible.size).toBe(0);
      expect(player2Visible.size).toBe(0);
    });
  });

  describe('visibility updates', () => {
    beforeEach(() => {
      visibilityManager.initializePlayerVisibility('player-123');
    });

    it('should update visibility when player has units', async () => {
      // Create a warrior at position (10, 10)
      await unitManager.createUnit('player-123', 'warrior', 10, 10);

      // Update visibility
      visibilityManager.updatePlayerVisibility('player-123');

      const visibleTiles = visibilityManager.getVisibleTiles('player-123');
      const exploredTiles = visibilityManager.getExploredTiles('player-123');

      // Warrior has sight range 2, so should see tiles in a 2-tile radius
      expect(visibleTiles.size).toBeGreaterThan(0);
      expect(exploredTiles.size).toBeGreaterThan(0);
      expect(exploredTiles.size).toBeGreaterThanOrEqual(visibleTiles.size);
    });

    it('should calculate correct sight range for different unit types', async () => {
      // Create warrior (sight 2) and scout (sight 3)
      await unitManager.createUnit('player-123', 'warrior', 10, 10);
      await unitManager.createUnit('player-123', 'scout', 15, 15);

      visibilityManager.updatePlayerVisibility('player-123');

      const visibleTiles = visibilityManager.getVisibleTiles('player-123');

      // Should see tiles around both units
      expect(visibleTiles.has('10,10')).toBe(true); // Warrior position
      expect(visibleTiles.has('15,15')).toBe(true); // Scout position

      // Check warrior sight range (should see tiles within distance 2)
      expect(visibleTiles.has('8,10')).toBe(true); // 2 tiles west
      expect(visibleTiles.has('12,10')).toBe(true); // 2 tiles east

      // Check scout sight range (should see 3 tiles away)
      expect(visibleTiles.has('12,15')).toBe(true); // 3 tiles west from scout
      expect(visibleTiles.has('18,15')).toBe(true); // 3 tiles east from scout
    });

    it('should handle units at map edges', async () => {
      // Create unit at map edge
      await unitManager.createUnit('player-123', 'warrior', 0, 0);

      visibilityManager.updatePlayerVisibility('player-123');

      const visibleTiles = visibilityManager.getVisibleTiles('player-123');

      // Should see the unit's position and valid nearby tiles
      expect(visibleTiles.has('0,0')).toBe(true);
      expect(visibleTiles.has('1,1')).toBe(true);
      expect(visibleTiles.has('2,0')).toBe(true); // Distance 2, within warrior sight

      // Should not try to see beyond map boundaries
      expect(visibleTiles.has('-1,-1')).toBe(false);
    });

    it('should accumulate explored tiles over time', async () => {
      // Create unit and update visibility
      await unitManager.createUnit('player-123', 'warrior', 10, 10);
      visibilityManager.updatePlayerVisibility('player-123');

      const initialExplored = visibilityManager.getExploredTiles('player-123');

      // Reset movement and move unit
      await unitManager.resetMovement('player-123');
      const unit = unitManager.getPlayerUnits('player-123')[0];
      await unitManager.moveUnit(unit.id, 12, 10); // Only 2 tiles away
      visibilityManager.updatePlayerVisibility('player-123');

      const newExplored = visibilityManager.getExploredTiles('player-123');

      // Should have explored more tiles
      expect(newExplored.size).toBeGreaterThan(initialExplored.size);

      // Should still remember previously explored tiles
      expect(newExplored.has('10,10')).toBe(true);
      expect(newExplored.has('12,10')).toBe(true);
    });
  });

  describe('tile visibility queries', () => {
    beforeEach(async () => {
      visibilityManager.initializePlayerVisibility('player-123');
      await unitManager.createUnit('player-123', 'warrior', 10, 10);
      visibilityManager.updatePlayerVisibility('player-123');
    });

    it('should correctly identify visible tiles', () => {
      expect(visibilityManager.isTileVisible('player-123', 10, 10)).toBe(true);
      expect(visibilityManager.isTileVisible('player-123', 11, 10)).toBe(true);
      expect(visibilityManager.isTileVisible('player-123', 9, 10)).toBe(true);

      // Should not see tiles outside sight range
      expect(visibilityManager.isTileVisible('player-123', 0, 0)).toBe(false);
      expect(visibilityManager.isTileVisible('player-123', 19, 19)).toBe(false);
    });

    it('should correctly identify explored tiles', () => {
      expect(visibilityManager.isTileExplored('player-123', 10, 10)).toBe(true);
      expect(visibilityManager.isTileExplored('player-123', 11, 10)).toBe(true);

      // Should not have explored distant tiles
      expect(visibilityManager.isTileExplored('player-123', 0, 0)).toBe(false);
    });

    it('should return correct tile visibility info', () => {
      const visibleTile = visibilityManager.getTileVisibility('player-123', 10, 10);
      expect(visibleTile.isVisible).toBe(true);
      expect(visibleTile.isExplored).toBe(true);

      const unknownTile = visibilityManager.getTileVisibility('player-123', 0, 0);
      expect(unknownTile.isVisible).toBe(false);
      expect(unknownTile.isExplored).toBe(false);
    });
  });

  describe('map view filtering', () => {
    beforeEach(async () => {
      visibilityManager.initializePlayerVisibility('player-123');
      await unitManager.createUnit('player-123', 'warrior', 10, 10);
      visibilityManager.updatePlayerVisibility('player-123');
    });

    it('should return filtered map view for player', () => {
      const mapView = visibilityManager.getPlayerMapView('player-123');

      expect(mapView).toBeDefined();
      expect(mapView?.width).toBe(mapWidth);
      expect(mapView?.height).toBe(mapHeight);
      expect(mapView?.tiles).toBeDefined();

      // Check that visible tiles have full info (tiles are stored as 2D array [x][y])
      const visibleTile = mapView?.tiles[10][10];
      expect(visibleTile.isVisible).toBe(true);
      expect(visibleTile.isExplored).toBe(true);
      expect(visibleTile.terrain).toBeDefined();

      // Check that unknown tiles are hidden
      const unknownTile = mapView?.tiles[0][0];
      expect(unknownTile.isVisible).toBe(false); // Tile (0,0) should not be visible from unit at (10,10)
      expect(unknownTile.isExplored).toBe(false);
      expect(unknownTile.terrain).toBe('unknown'); // Should be 'unknown' for unexplored tiles
    });

    it('should handle fog of war correctly', async () => {
      // Reset movement and move unit away to create fog of war
      await unitManager.resetMovement('player-123');
      const unit = unitManager.getPlayerUnits('player-123')[0];
      await unitManager.moveUnit(unit.id, 12, 12); // Only 2 tiles away in each direction
      visibilityManager.updatePlayerVisibility('player-123');

      const mapView = visibilityManager.getPlayerMapView('player-123');

      // Original position should be explored but not visible (fog of war)
      const fogTile = mapView?.tiles[10][10];
      expect(fogTile.isVisible).toBe(false); // Should not be visible after unit moved away
      expect(fogTile.isExplored).toBe(true); // Should still be explored
      expect(fogTile.terrain).toBeDefined(); // Terrain should be known for explored tiles

      // New position should be visible
      const currentTile = mapView?.tiles[12][12];
      expect(currentTile.isVisible).toBe(true);
      expect(currentTile.isExplored).toBe(true);
    });
  });

  describe('unit events', () => {
    beforeEach(() => {
      visibilityManager.initializePlayerVisibility('player-123');
    });

    it('should update visibility when unit is created', async () => {
      const initialVisible = visibilityManager.getVisibleTiles('player-123');
      expect(initialVisible.size).toBe(0);

      await unitManager.createUnit('player-123', 'warrior', 10, 10);
      visibilityManager.onUnitCreated('player-123');

      const newVisible = visibilityManager.getVisibleTiles('player-123');
      expect(newVisible.size).toBeGreaterThan(0);
    });

    it('should update visibility when unit moves', async () => {
      await unitManager.createUnit('player-123', 'warrior', 10, 10);
      visibilityManager.onUnitCreated('player-123');

      // Reset movement and move unit
      await unitManager.resetMovement('player-123');
      const unit = unitManager.getPlayerUnits('player-123')[0];
      await unitManager.moveUnit(unit.id, 12, 10); // Only 2 tiles away
      visibilityManager.onUnitMoved('player-123');

      const newVisible = visibilityManager.getVisibleTiles('player-123');

      // Should see new area
      expect(newVisible.has('12,10')).toBe(true);
      expect(newVisible.has('13,10')).toBe(true);

      // Should still see old area since it's within range (warrior sight = 2, distance = 2)
      expect(newVisible.has('10,10')).toBe(true);
    });

    it('should update visibility when unit is destroyed', async () => {
      await unitManager.createUnit('player-123', 'warrior', 10, 10);
      visibilityManager.onUnitCreated('player-123');

      const visibleBeforeDestroy = visibilityManager.getVisibleTiles('player-123');
      expect(visibleBeforeDestroy.size).toBeGreaterThan(0);

      // Simulate unit destruction by removing it
      const unit = unitManager.getPlayerUnits('player-123')[0];
      await unitManager['destroyUnit'](unit.id);
      visibilityManager.onUnitDestroyed('player-123');

      const visibleAfterDestroy = visibilityManager.getVisibleTiles('player-123');
      expect(visibleAfterDestroy.size).toBe(0);
    });
  });

  describe('multiple players', () => {
    beforeEach(async () => {
      visibilityManager.initializePlayerVisibility('player-1');
      visibilityManager.initializePlayerVisibility('player-2');

      await unitManager.createUnit('player-1', 'warrior', 5, 5);
      await unitManager.createUnit('player-2', 'warrior', 15, 15);

      visibilityManager.updatePlayerVisibility('player-1');
      visibilityManager.updatePlayerVisibility('player-2');
    });

    it('should maintain separate visibility for each player', () => {
      const player1Visible = visibilityManager.getVisibleTiles('player-1');
      const player2Visible = visibilityManager.getVisibleTiles('player-2');

      expect(player1Visible.has('5,5')).toBe(true);
      expect(player1Visible.has('15,15')).toBe(false);

      expect(player2Visible.has('15,15')).toBe(true);
      expect(player2Visible.has('5,5')).toBe(false);
    });

    it('should handle visibility updates for all players', () => {
      const playerIds = ['player-1', 'player-2'];
      visibilityManager.updateAllPlayersVisibility(playerIds);

      // Both players should have visibility
      expect(visibilityManager.getVisibleTiles('player-1').size).toBeGreaterThan(0);
      expect(visibilityManager.getVisibleTiles('player-2').size).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle non-existent players gracefully', () => {
      const visibleTiles = visibilityManager.getVisibleTiles('non-existent');
      const exploredTiles = visibilityManager.getExploredTiles('non-existent');

      expect(visibleTiles.size).toBe(0);
      expect(exploredTiles.size).toBe(0);
    });

    it('should handle empty unit manager', () => {
      visibilityManager.initializePlayerVisibility('player-123');
      visibilityManager.updatePlayerVisibility('player-123');

      const visibleTiles = visibilityManager.getVisibleTiles('player-123');
      expect(visibleTiles.size).toBe(0);
    });

    it('should handle map without generated data', () => {
      const emptyMapManager = new MapManager(10, 10);
      const emptyVisibilityManager = new VisibilityManager(gameId, unitManager, emptyMapManager);

      emptyVisibilityManager.initializePlayerVisibility('player-123');
      emptyVisibilityManager.updatePlayerVisibility('player-123');

      const mapView = emptyVisibilityManager.getPlayerMapView('player-123');
      expect(mapView).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should clean up all data', () => {
      visibilityManager.initializePlayerVisibility('player-1');
      visibilityManager.initializePlayerVisibility('player-2');

      const debugInfo = visibilityManager.getDebugInfo();
      expect(Object.keys(debugInfo.players)).toHaveLength(2);

      visibilityManager.cleanup();

      const debugInfoAfter = visibilityManager.getDebugInfo();
      expect(Object.keys(debugInfoAfter.players)).toHaveLength(0);
    });
  });

  describe('debug information', () => {
    it('should provide useful debug information', async () => {
      visibilityManager.initializePlayerVisibility('player-123');
      await unitManager.createUnit('player-123', 'warrior', 10, 10);
      visibilityManager.updatePlayerVisibility('player-123');

      const debugInfo = visibilityManager.getDebugInfo();

      expect(debugInfo.gameId).toBe(gameId);
      expect(debugInfo.players).toBeDefined();
      expect(debugInfo.players['player-123']).toBeDefined();
      expect(debugInfo.players['player-123'].visibleTileCount).toBeGreaterThan(0);
      expect(debugInfo.players['player-123'].exploredTileCount).toBeGreaterThan(0);
      expect(debugInfo.players['player-123'].lastUpdated).toBeInstanceOf(Date);
    });
  });
});
