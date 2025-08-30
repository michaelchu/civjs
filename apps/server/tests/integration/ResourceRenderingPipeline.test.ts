/**
 * End-to-End Resource Rendering Pipeline Integration Test
 *
 * This test validates the complete resource rendering pipeline from server
 * generation through protocol transmission to client rendering readiness.
 *
 * Tests all phases of the resource rendering compliance fix:
 * - Phase 1: Protocol schema includes resource field
 * - Phase 2: Data flows correctly through visibility system
 * - Phase 3: Client sprite mapping works correctly
 */

import { GameManager } from '../../src/game/GameManager';
import { mockDatabase } from '../fixtures/databaseMocks';
import type { TileInfo } from '../../src/types/packet';

describe('Resource Rendering Pipeline Integration', () => {
  let gameManager: GameManager;

  beforeEach(async () => {
    const mockDb = mockDatabase();
    gameManager = new GameManager(mockDb.db, mockDb.redis);
  });

  describe('Complete Pipeline Validation', () => {
    test('should successfully flow resource data from generation to client-ready format', async () => {
      // Step 1: Generate map with resources (server-side)
      const mapConfig = {
        width: 50,
        height: 35,
        landmass: 30,
        temperature: 50,
        wetness: 50,
        seed: 42069, // Fixed seed for reproducible test
        startingUnits: 'standard',
        topology: 'standard',
        generator: 'island' as const,
      };

      await gameManager['mapManager'].generateMapWithIslands(mapConfig);

      // Step 2: Create test game and player
      const gameId = 'integration-test-game';
      const playerId = 'integration-test-player';

      await gameManager.createGame({
        id: gameId,
        name: 'Resource Pipeline Test',
        maxPlayers: 2,
        mapWidth: mapConfig.width,
        mapHeight: mapConfig.height,
        creatorId: 'test-creator',
      });

      // Step 3: Add player and set up visibility
      await gameManager.addPlayerToGame(gameId, {
        id: playerId,
        name: 'Test Player',
        isCreator: false,
      });

      // Get all tiles with resources
      const allTiles = gameManager['mapManager'].getAllTiles();
      const tilesWithResources = allTiles.filter(tile => tile.resource);

      console.log(`Generated ${tilesWithResources.length} tiles with resources`);
      expect(tilesWithResources.length).toBeGreaterThan(0);

      // Step 4: Make resource tiles visible to player
      const sampleResourceTiles = tilesWithResources.slice(0, 20); // Test with first 20
      sampleResourceTiles.forEach(tile => {
        gameManager['visibilityManager'].setTileVisibility(playerId, tile.x, tile.y, true);
        gameManager['visibilityManager'].setTileKnown(playerId, tile.x, tile.y, true);
      });

      // Step 5: Get tiles as they would be sent to client (protocol format)
      const visibleTiles = gameManager['visibilityManager'].getVisibleTiles(playerId);
      const visibleResourceTiles = visibleTiles.filter(tile => tile.resource);

      console.log(`${visibleResourceTiles.length} resource tiles visible to client`);
      expect(visibleResourceTiles.length).toBeGreaterThan(0);

      // Step 6: Validate protocol compliance (Phase 1)
      visibleResourceTiles.forEach(tile => {
        expect(tile.resource).toBeDefined();
        expect(typeof tile.resource).toBe('string');
        expect(tile.resource!.length).toBeGreaterThan(0);
      });

      // Step 7: Validate data integrity (Phase 2)
      visibleResourceTiles.forEach(tile => {
        const originalTile = sampleResourceTiles.find(
          orig => orig.x === tile.x && orig.y === tile.y
        );
        expect(originalTile).toBeDefined();
        expect(tile.resource).toBe(originalTile!.resource);
      });

      // Step 8: Validate client sprite mapping readiness (Phase 3)
      const clientSpriteMapping = visibleResourceTiles.map(tile => {
        return {
          position: { x: tile.x, y: tile.y },
          resource: tile.resource,
          expectedSpriteKey: `ts.${tile.resource}:0`, // Expected client-side sprite key
          terrain: tile.terrain,
        };
      });

      // Ensure all resources can be mapped to sprite keys
      clientSpriteMapping.forEach(mapping => {
        expect(mapping.expectedSpriteKey).toMatch(/^ts\.[a-z_]+:0$/);
      });

      // Step 9: Log comprehensive audit trail
      const resourceDistribution = visibleResourceTiles.reduce(
        (acc, tile) => {
          acc[tile.resource!] = (acc[tile.resource!] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      console.log('Integration test results:', {
        totalResourceTiles: tilesWithResources.length,
        visibleResourceTiles: visibleResourceTiles.length,
        resourceDistribution,
        sampleSpriteKeys: clientSpriteMapping.slice(0, 5).map(m => m.expectedSpriteKey),
      });

      // Step 10: Final validation - ensure pipeline completeness
      expect(tilesWithResources.length).toBeGreaterThan(10); // Adequate resource generation
      expect(visibleResourceTiles.length).toBeGreaterThan(5); // Adequate visibility
      expect(Object.keys(resourceDistribution).length).toBeGreaterThan(2); // Resource variety
    });

    test('should handle edge cases and error conditions gracefully', async () => {
      // Test with minimal map to check edge cases
      const minimalMapConfig = {
        width: 10,
        height: 8,
        landmass: 50,
        temperature: 50,
        wetness: 50,
        seed: 11111,
        startingUnits: 'standard',
        topology: 'standard',
        generator: 'island' as const,
      };

      await gameManager['mapManager'].generateMapWithIslands(minimalMapConfig);

      const gameId = 'edge-case-test';
      const playerId = 'edge-case-player';

      await gameManager.createGame({
        id: gameId,
        name: 'Edge Case Test',
        maxPlayers: 1,
        mapWidth: minimalMapConfig.width,
        mapHeight: minimalMapConfig.height,
        creatorId: 'test-creator',
      });

      await gameManager.addPlayerToGame(gameId, {
        id: playerId,
        name: 'Edge Case Player',
        isCreator: true,
      });

      // Test with player having no visibility
      const noVisibilityTiles = gameManager['visibilityManager'].getVisibleTiles(playerId);
      expect(Array.isArray(noVisibilityTiles)).toBe(true);

      // Test resource handling on edge tiles
      const allTiles = gameManager['mapManager'].getAllTiles();
      const edgeTiles = allTiles.filter(
        tile =>
          tile.x === 0 ||
          tile.y === 0 ||
          tile.x === minimalMapConfig.width - 1 ||
          tile.y === minimalMapConfig.height - 1
      );

      // Make edge tiles visible and check resource handling
      edgeTiles.forEach(tile => {
        gameManager['visibilityManager'].setTileVisibility(playerId, tile.x, tile.y, true);
        gameManager['visibilityManager'].setTileKnown(playerId, tile.x, tile.y, true);
      });

      const visibleEdgeTiles = gameManager['visibilityManager'].getVisibleTiles(playerId);
      expect(visibleEdgeTiles.length).toBe(edgeTiles.length);

      // Verify no data corruption in edge cases
      visibleEdgeTiles.forEach(tile => {
        if (tile.resource) {
          expect(typeof tile.resource).toBe('string');
          expect(tile.resource.length).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('Performance and Scalability Validation', () => {
    test('should handle large maps with many resources efficiently', async () => {
      const startTime = Date.now();

      const largeMapConfig = {
        width: 100,
        height: 80,
        landmass: 30,
        temperature: 50,
        wetness: 50,
        seed: 999999,
        startingUnits: 'standard',
        topology: 'standard',
        generator: 'island' as const,
      };

      await gameManager['mapManager'].generateMapWithIslands(largeMapConfig);

      const generationTime = Date.now() - startTime;
      console.log(`Large map generation completed in ${generationTime}ms`);

      // Verify performance is reasonable (should complete within 30 seconds)
      expect(generationTime).toBeLessThan(30000);

      const allTiles = gameManager['mapManager'].getAllTiles();
      const tilesWithResources = allTiles.filter(tile => tile.resource);

      console.log(
        `Large map stats: ${allTiles.length} total tiles, ${tilesWithResources.length} with resources`
      );

      // Verify resource generation scales appropriately
      expect(tilesWithResources.length).toBeGreaterThan(allTiles.length * 0.02); // At least 2%
      expect(tilesWithResources.length).toBeLessThan(allTiles.length * 0.4); // Not more than 40%
    });
  });
});
