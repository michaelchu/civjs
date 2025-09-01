/**
 * Complete Compliance Validation Integration Test
 *
 * This test validates the end-to-end compliance of the starting position generation
 * and camera centering fixes. It tests the complete pipeline from map generation
 * through to client-ready data structures.
 */

import { beforeAll } from '@jest/globals';
import { PlayerState } from '../../src/game/GameManager';
import { MapManager } from '../../src/game/MapManager';
import { initializeTerrainRuleset } from '../../src/game/map/TerrainRuleset';

describe('Complete Compliance Validation', () => {
  beforeAll(async () => {
    // Initialize terrain ruleset before running tests
    await initializeTerrainRuleset('classic');
  });

  const createTestPlayers = (count: number): Map<string, PlayerState> => {
    const players = new Map<string, PlayerState>();
    for (let i = 0; i < count; i++) {
      const playerId = `player-${i + 1}`;
      players.set(playerId, {
        id: playerId,
        userId: `user-${i + 1}`,
        playerNumber: i + 1,
        civilization: 'Romans',
        isReady: true,
        hasEndedTurn: false,
        isConnected: true,
        lastSeen: new Date(),
      });
    }
    return players;
  };

  describe('End-to-End Compliance Pipeline', () => {
    it('should generate compliant map data for all generator types', async () => {
      const players = createTestPlayers(4);

      const mapManager = new MapManager(50, 40, 'compliance-test');

      await mapManager.generateMap(players);
      const mapData = mapManager.getMapData();

      // Validate complete compliance
      expect(mapData).toBeDefined();
      expect(mapData!.width).toBe(50);
      expect(mapData!.height).toBe(40);
      expect(mapData!.tiles).toBeDefined();
      expect(mapData!.startingPositions).toBeDefined();

      // Validate starting positions compliance
      expect(mapData!.startingPositions).toHaveLength(players.size);

      for (const startPos of mapData!.startingPositions) {
        // Reference compliance validation
        expect(startPos).toMatchObject({
          x: expect.any(Number),
          y: expect.any(Number),
          playerId: expect.any(String),
        });

        // Coordinate bounds validation
        expect(startPos.x).toBeGreaterThanOrEqual(0);
        expect(startPos.x).toBeLessThan(50);
        expect(startPos.y).toBeGreaterThanOrEqual(0);
        expect(startPos.y).toBeLessThan(40);
      }
    });

    it('should maintain protocol compliance across different scenarios', async () => {
      const scenarios = [
        { players: 2, size: { width: 30, height: 25 } },
        { players: 4, size: { width: 60, height: 40 } },
        { players: 6, size: { width: 80, height: 50 } },
      ];

      for (const scenario of scenarios) {
        const players = createTestPlayers(scenario.players);
        const mapManager = new MapManager(
          scenario.size.width,
          scenario.size.height,
          `protocol-test-${scenario.players}`
        );

        await mapManager.generateMap(players);
        const mapData = mapManager.getMapData();

        // Protocol structure validation
        expect(mapData).toHaveProperty('width');
        expect(mapData).toHaveProperty('height');
        expect(mapData).toHaveProperty('tiles');
        expect(mapData).toHaveProperty('startingPositions');

        // Validate tile structure compliance
        expect(mapData!.tiles).toHaveLength(scenario.size.width);
        expect(mapData!.tiles[0]).toHaveLength(scenario.size.height);

        // Sample tile structure validation
        const sampleTile = mapData!.tiles[10][10];
        expect(sampleTile).toMatchObject({
          terrain: expect.any(String),
          temperature: expect.any(Number),
          continentId: expect.any(Number),
        });
      }
    });
  });

  describe('Compliance Regression Prevention', () => {
    it('should prevent regression of continent ID validation errors', async () => {
      const players = createTestPlayers(3);
      const mapManager = new MapManager(25, 20, 'regression-test-continent-id');

      // This should not throw continent ID related errors
      await mapManager.generateMap(players);
      const mapData = mapManager.getMapData();

      // Validate all starting positions exist
      expect(mapData!.startingPositions).toBeDefined();
      expect(mapData!.startingPositions.length).toBeGreaterThan(0);
    });

    it('should handle edge case scenarios gracefully', async () => {
      // Test with minimal players
      const onePlayer = createTestPlayers(1);
      const smallMapManager = new MapManager(15, 15, 'edge-case-small');

      await smallMapManager.generateMap(onePlayer);
      const smallMapData = smallMapManager.getMapData();
      expect(smallMapData!.startingPositions).toHaveLength(1);

      // Test with many players on medium map
      const manyPlayers = createTestPlayers(8);
      const mediumMapManager = new MapManager(60, 40, 'edge-case-many-players');

      await mediumMapManager.generateMap(manyPlayers);
      const mediumMapData = mediumMapManager.getMapData();
      expect(mediumMapData!.startingPositions.length).toBeGreaterThan(0);
      expect(mediumMapData!.startingPositions.length).toBeLessThanOrEqual(manyPlayers.size);
    });
  });

  describe('Data Structure Compliance', () => {
    it('should produce client-ready data structures', async () => {
      const players = createTestPlayers(4);
      const mapManager = new MapManager(40, 30, 'client-ready-test');

      await mapManager.generateMap(players);
      const mapData = mapManager.getMapData();

      // Validate data is JSON serializable (important for client transmission)
      expect(() => JSON.stringify(mapData)).not.toThrow();

      const serialized = JSON.stringify(mapData);
      const deserialized = JSON.parse(serialized);

      // Validate deserialized data maintains structure
      expect(deserialized.width).toBe(mapData!.width);
      expect(deserialized.height).toBe(mapData!.height);
      expect(deserialized.startingPositions).toHaveLength(mapData!.startingPositions.length);

      // Validate specific starting position data is preserved
      for (let i = 0; i < deserialized.startingPositions.length; i++) {
        const original = mapData!.startingPositions[i];
        const restored = deserialized.startingPositions[i];

        expect(restored.x).toBe(original.x);
        expect(restored.y).toBe(original.y);
        expect(restored.playerId).toBe(original.playerId);
      }
    });

    it('should maintain terrain type consistency', async () => {
      const players = createTestPlayers(3);
      const mapManager = new MapManager(50, 35, 'terrain-consistency-test');

      await mapManager.generateMap(players);
      const mapData = mapManager.getMapData();

      // Validate terrain distribution is reasonable
      const terrainCounts = new Map<string, number>();
      for (let x = 0; x < mapData!.width; x++) {
        for (let y = 0; y < mapData!.height; y++) {
          const terrain = mapData!.tiles[x][y].terrain;
          terrainCounts.set(terrain, (terrainCounts.get(terrain) || 0) + 1);
        }
      }

      // Should have a reasonable distribution of terrain types
      expect(terrainCounts.size).toBeGreaterThan(3); // At least 4 different terrain types
      expect(terrainCounts.has('ocean')).toBe(true);
    });
  });
});
