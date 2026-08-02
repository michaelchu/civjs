import { beforeAll } from '@jest/globals';
import { VisibilityManager } from '@game/managers/VisibilityManager';
import { UnitManager } from '@game/managers/UnitManager';
import { MapManager } from '@game/managers/MapManager';
import { WrapFlag } from '@game/map/MapTopology';
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

    // Database operations handled by MockDatabaseProvider

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

    it('permanently reveals the classic hut map-scroll radius', () => {
      const explored = visibilityManager.revealArea('player-123', 10, 10, 30);

      expect(explored).toContain('10,10');
      expect(explored).toContain('15,10');
      expect(explored).not.toContain('16,10');
      expect(visibilityManager.getVisibleTiles('player-123')).toEqual(new Set());
    });

    it('uses the classic city vision radius as a vision source', () => {
      visibilityManager.setCityVisionProvider(playerId =>
        playerId === 'player-123' ? [{ x: 10, y: 10 }] : []
      );

      visibilityManager.updatePlayerVisibility('player-123');

      const visible = visibilityManager.getVisibleTiles('player-123');
      expect(visible.has('10,10')).toBe(true);
      expect(visible.has('12,10')).toBe(true);
      expect(visible.has('10,12')).toBe(true);
      expect(visible.has('13,10')).toBe(false);
    });

    it('persists explored knowledge after recalculating current vision', async () => {
      const persist = jest.fn(async () => undefined);
      const persistentManager = new VisibilityManager(
        gameId,
        unitManager,
        mapManager,
        undefined,
        undefined,
        persist
      );
      persistentManager.restorePlayerVisibility('player-123', ['3,4']);

      persistentManager.updatePlayerVisibility('player-123');
      await new Promise(resolve => setImmediate(resolve));

      expect(persist).toHaveBeenCalledWith('player-123', ['3,4'], [], {}, {});
    });

    it('serves the last observed tile state while a tile is fogged', () => {
      visibilityManager.setCityVisionProvider(playerId =>
        playerId === 'player-123' ? [{ x: 10, y: 10 }] : []
      );
      const tile = mapManager.getTile(10, 10)!;
      tile.hasRoad = false;
      visibilityManager.updatePlayerVisibility('player-123');

      tile.hasRoad = true;
      visibilityManager.setCityVisionProvider(() => []);
      visibilityManager.updatePlayerVisibility('player-123');

      expect(visibilityManager.getPlayerMapView('player-123')!.tiles[10][10]).toMatchObject({
        hasRoad: false,
        isVisible: false,
        isExplored: true,
      });
    });

    it('requires the matching detection layer for hidden units', async () => {
      visibilityManager.setCityVisionProvider(playerId =>
        playerId === 'player-123' ? [{ x: 10, y: 10, visionRadiusSq: 8 }] : []
      );
      const stealth = await unitManager.createUnit('enemy', 'stealth_fighter', 12, 10);
      const normal = await unitManager.createUnit('enemy', 'warriors', 12, 11);
      visibilityManager.updatePlayerVisibility('player-123');

      const visibleTiles = visibilityManager.getVisibleTiles('player-123');
      const units = unitManager.getVisibleUnits(
        'player-123',
        visibleTiles,
        visibilityManager.getDetectionTiles('player-123')
      );

      expect(units.map(unit => unit.id)).toContain(normal.id);
      expect(units.map(unit => unit.id)).not.toContain(stealth.id);
    });
  });

  describe('visibility updates', () => {
    it('calculates visibility on the first update for a player', async () => {
      await unitManager.createUnit('new-player', 'warriors', 10, 10);

      visibilityManager.updatePlayerVisibility('new-player');

      expect(visibilityManager.getVisibleTiles('new-player').has('10,10')).toBe(true);
    });

    beforeEach(() => {
      visibilityManager.initializePlayerVisibility('player-123');
    });

    it('should update visibility when player has units', async () => {
      // Create a warrior at position (10, 10)
      await unitManager.createUnit('player-123', 'warriors', 10, 10);

      // Update visibility
      visibilityManager.updatePlayerVisibility('player-123');

      const visibleTiles = visibilityManager.getVisibleTiles('player-123');
      const exploredTiles = visibilityManager.getExploredTiles('player-123');

      // Warrior has sight range 2, so should see tiles in a 2-tile radius
      expect(visibleTiles.size).toBeGreaterThan(0);
      expect(exploredTiles.size).toBeGreaterThan(0);
      expect(exploredTiles.size).toBeGreaterThanOrEqual(visibleTiles.size);
    });

    it('includes allied unit vision when shared vision is enabled', async () => {
      await unitManager.createUnit('ally', 'warriors', 3, 3);
      visibilityManager.setSharedVisionProvider(playerId =>
        playerId === 'player-123' ? new Set(['ally']) : new Set()
      );

      visibilityManager.updatePlayerVisibility('player-123');

      expect(visibilityManager.getVisibleTiles('player-123').has('3,3')).toBe(true);
      expect(visibilityManager.getExploredTiles('player-123').has('3,3')).toBe(true);
    });

    it('should calculate correct sight range for different unit types', async () => {
      // Create warrior (sight 2) and explorer (sight 2)
      await unitManager.createUnit('player-123', 'warriors', 10, 10);
      await unitManager.createUnit('player-123', 'explorer', 15, 15);

      // The generated test map is intentionally random. Keep this test focused
      // on base unit sight rather than terrain or base vision effects, which can
      // legitimately extend vision when either source tile is a mountain.
      for (const [x, y] of [
        [10, 10],
        [15, 15],
      ] as const) {
        const tile = mapManager.getTile(x, y)!;
        tile.terrain = 'grassland';
        tile.improvements = [];
        tile.cityId = undefined;
      }

      visibilityManager.updatePlayerVisibility('player-123');

      const visibleTiles = visibilityManager.getVisibleTiles('player-123');

      // Should see tiles around both units
      expect(visibleTiles.has('10,10')).toBe(true); // Warrior position
      expect(visibleTiles.has('15,15')).toBe(true); // Explorer position

      // Check warrior sight range (vision_radius_sq=2, so distance <= sqrt(2) ≈ 1.41)
      expect(visibleTiles.has('9,10')).toBe(true); // 1 tile west (distance 1)
      expect(visibleTiles.has('11,10')).toBe(true); // 1 tile east (distance 1)
      expect(visibleTiles.has('8,10')).toBe(false); // 2 tiles west (distance 2, outside range)
      expect(visibleTiles.has('12,10')).toBe(false); // 2 tiles east (distance 2, outside range)

      // Check explorer sight range (both have same vision in freeciv)
      expect(visibleTiles.has('14,15')).toBe(true); // 1 tile west from explorer (distance 1)
      expect(visibleTiles.has('16,15')).toBe(true); // 1 tile east from explorer (distance 1)
      expect(visibleTiles.has('13,15')).toBe(false); // 2 tiles west from explorer (distance 2, outside range)
      expect(visibleTiles.has('17,15')).toBe(false); // 2 tiles east from explorer (distance 2, outside range)
    });

    it('applies the classic mountain vision effect using the unit and tile context', async () => {
      await unitManager.createUnit('player-123', 'warriors', 10, 10);
      const unitTile = mapManager.getTile(10, 10)!;
      unitTile.terrain = 'mountains';

      visibilityManager.updatePlayerVisibility('player-123');

      // Warrior base vision is 2; classic mountains add 4 squared tiles.
      // @reference reference/freeciv/data/classic/effects.ruleset:132-139
      expect(visibilityManager.getVisibleTiles('player-123').has('12,10')).toBe(true);
    });

    it('applies tech-gated fortress vision only after the player has Invention', async () => {
      await unitManager.createUnit('player-123', 'warriors', 10, 10);
      const unitTile = mapManager.getTile(10, 10)!;
      unitTile.improvements = ['fortress'];

      visibilityManager = new VisibilityManager(
        gameId,
        unitManager,
        mapManager,
        undefined,
        () => new Set(['invention'])
      );
      visibilityManager.updatePlayerVisibility('player-123');

      // Warrior base vision is 2; a fortress adds 8 only with Invention.
      // @reference reference/freeciv/data/classic/effects.ruleset:121-130
      expect(visibilityManager.getVisibleTiles('player-123').has('13,10')).toBe(true);
    });

    it('should handle units at map edges', async () => {
      // Create unit at map edge
      await unitManager.createUnit('player-123', 'warriors', 0, 0);

      visibilityManager.updatePlayerVisibility('player-123');

      const visibleTiles = visibilityManager.getVisibleTiles('player-123');

      // Should see the unit's position and valid nearby tiles (vision_radius_sq=2)
      expect(visibleTiles.has('0,0')).toBe(true);
      expect(visibleTiles.has('1,1')).toBe(true); // Distance sqrt(2) ≈ 1.41, within range
      expect(visibleTiles.has('2,0')).toBe(false); // Distance 2, outside range
      expect(visibleTiles.has('1,0')).toBe(true); // Distance 1, within range
      expect(visibleTiles.has('0,1')).toBe(true); // Distance 1, within range

      // Should not try to see beyond map boundaries
      expect(visibleTiles.has('-1,-1')).toBe(false);
    });

    it('should accumulate explored tiles over time', async () => {
      // Create unit and update visibility
      await unitManager.createUnit('player-123', 'warriors', 10, 10);
      visibilityManager.updatePlayerVisibility('player-123');

      const initialExplored = visibilityManager.getExploredTiles('player-123');

      // Reset movement and move unit (warriors have 1 movement in freeciv)
      await unitManager.resetMovement('player-123');
      const unit = unitManager.getPlayerUnits('player-123')[0];
      await unitManager.moveUnit(unit.id, 11, 10); // Only 1 tile away (warrior's max movement)
      visibilityManager.updatePlayerVisibility('player-123');

      const newExplored = visibilityManager.getExploredTiles('player-123');

      // Should have explored more tiles
      expect(newExplored.size).toBeGreaterThan(initialExplored.size);

      // Should still remember previously explored tiles
      expect(newExplored.has('10,10')).toBe(true);
      expect(newExplored.has('11,10')).toBe(true); // New position
    });
  });

  describe('tile visibility queries', () => {
    beforeEach(async () => {
      visibilityManager.initializePlayerVisibility('player-123');
      await unitManager.createUnit('player-123', 'warriors', 10, 10);
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
      expect(visibleTile.lastSeen).toBeInstanceOf(Date);

      const unknownTile = visibilityManager.getTileVisibility('player-123', 0, 0);
      expect(unknownTile.isVisible).toBe(false);
      expect(unknownTile.isExplored).toBe(false);
      expect(unknownTile.lastSeen).toBeUndefined();
    });

    it('retains the actual observation time after a tile becomes fogged', () => {
      visibilityManager.restorePlayerVisibility('historian', ['4,5'], [], {
        '4,5': '2001-02-03T04:05:06.000Z',
      });

      expect(visibilityManager.getTileVisibility('historian', 4, 5)).toEqual({
        isVisible: false,
        isExplored: true,
        lastSeen: new Date('2001-02-03T04:05:06.000Z'),
      });
    });
  });

  describe('map view filtering', () => {
    beforeEach(async () => {
      visibilityManager.initializePlayerVisibility('player-123');
      await unitManager.createUnit('player-123', 'warriors', 10, 10);
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
      // Keep the movement path deterministic; generated maps may otherwise
      // place ocean between these coordinates and leave the unit in sight.
      mapManager.getTile(11, 10)!.terrain = 'grassland';
      mapManager.getTile(12, 10)!.terrain = 'grassland';

      // Reset movement and move unit away to create fog of war
      await unitManager.resetMovement('player-123');
      const unit = unitManager.getPlayerUnits('player-123')[0];
      // Move unit far enough to be outside vision range (vision_radius_sq = 2, so need distance > sqrt(2))
      await unitManager.moveUnit(unit.id, 11, 10); // First move (1 tile away)
      await unitManager.resetMovement('player-123'); // Give more movement for testing
      await unitManager.moveUnit(unit.id, 12, 10); // Second move (2 tiles away from original)
      visibilityManager.updatePlayerVisibility('player-123');

      const mapView = visibilityManager.getPlayerMapView('player-123');

      // Original position should be explored but not visible (fog of war)
      const fogTile = mapView?.tiles[10][10];
      expect(fogTile.isVisible).toBe(false); // Should not be visible after unit moved away
      expect(fogTile.isExplored).toBe(true); // Should still be explored
      expect(fogTile.terrain).toBeDefined(); // Terrain should be known for explored tiles

      // New position should be visible
      const currentTile = mapView?.tiles[12][10];
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

      await unitManager.createUnit('player-123', 'warriors', 10, 10);
      visibilityManager.onUnitCreated('player-123');

      const newVisible = visibilityManager.getVisibleTiles('player-123');
      expect(newVisible.size).toBeGreaterThan(0);
    });

    it('should update visibility when unit moves', async () => {
      await unitManager.createUnit('player-123', 'warriors', 10, 10);
      visibilityManager.onUnitCreated('player-123');

      // Reset movement and move unit
      await unitManager.resetMovement('player-123');
      const unit = unitManager.getPlayerUnits('player-123')[0];
      await unitManager.moveUnit(unit.id, 11, 10); // Only 1 tile away (warrior's movement)
      visibilityManager.onUnitMoved('player-123');

      const newVisible = visibilityManager.getVisibleTiles('player-123');

      // Should see new area
      expect(newVisible.has('11,10')).toBe(true);
      expect(newVisible.has('12,10')).toBe(true); // Adjacent to new position

      // Should still see old area since it's within range (warrior sight = 2, distance = 1)
      expect(newVisible.has('10,10')).toBe(true);
    });

    it('should update visibility when unit is destroyed', async () => {
      await unitManager.createUnit('player-123', 'warriors', 10, 10);
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

      await unitManager.createUnit('player-1', 'warriors', 5, 5);
      await unitManager.createUnit('player-2', 'warriors', 15, 15);

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
    it('applies wrapping when calculating visibility', async () => {
      const wrappedMap = new MapManager(
        10,
        10,
        'visibility-wrap',
        'random',
        undefined,
        undefined,
        false,
        50,
        { wrapId: WrapFlag.X }
      );
      await wrappedMap.generateMap(new Map());
      const wrappedUnits = new UnitManager(
        gameId,
        createMockDatabaseProvider(),
        10,
        10,
        wrappedMap
      );
      const wrappedVisibility = new VisibilityManager(gameId, wrappedUnits, wrappedMap);
      await wrappedUnits.createUnit('edge-player', 'warriors', 0, 5);

      wrappedVisibility.updatePlayerVisibility('edge-player');

      expect(wrappedVisibility.getVisibleTiles('edge-player').has('9,5')).toBe(true);
    });

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
      await unitManager.createUnit('player-123', 'warriors', 10, 10);
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
