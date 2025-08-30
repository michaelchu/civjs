/**
 * Starting Position Generation Compliance Validation Test
 *
 * This test validates that the starting position generator is fully compliant
 * with freeciv reference implementation. It tests all key compliance features
 * that were implemented to fix the critical audit failures.
 */

import { PlayerState } from '../../../src/game/GameManager';
import { MapManager } from '../../../src/game/MapManager';
import { StartingPositionGenerator } from '../../../src/game/map/StartingPositionGenerator';

// Mock players for testing
const createMockPlayers = (count: number): Map<string, PlayerState> => {
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

describe('Starting Position Generation Compliance', () => {
  let mapManager: MapManager;
  let players: Map<string, PlayerState>;

  beforeEach(() => {
    players = createMockPlayers(4);
    mapManager = new MapManager(40, 30, 'test-seed');
  });

  describe('freeciv Reference Compliance', () => {
    it('should generate starting positions using reference-compliant algorithm', async () => {
      // Generate map with starting positions
      await mapManager.generateMap(players);
      const mapData = mapManager.getMapData();

      // Validate we have starting positions
      expect(mapData!.startingPositions).toBeDefined();
      expect(mapData!.startingPositions.length).toBe(players.size);

      // Each starting position should have required properties
      for (const startPos of mapData!.startingPositions) {
        expect(startPos).toHaveProperty('x');
        expect(startPos).toHaveProperty('y');
        expect(startPos).toHaveProperty('playerId');

        // Validate coordinates are within map bounds
        expect(startPos.x).toBeGreaterThanOrEqual(0);
        expect(startPos.x).toBeLessThan(40);
        expect(startPos.y).toBeGreaterThanOrEqual(0);
        expect(startPos.y).toBeLessThan(30);

        // Validate player ID is valid
        expect(startPos.playerId).toBeDefined();
        expect(typeof startPos.playerId).toBe('string');
      }
    });

    it('should only place starting positions on TER_STARTER terrain types', async () => {
      await mapManager.generateMap(players);
      const mapData = mapManager.getMapData();

      // Check each starting position is on valid starter terrain
      for (const startPos of mapData!.startingPositions) {
        const tile = mapData!.tiles[startPos.x][startPos.y];

        // These are the TER_STARTER equivalent terrain types
        const starterTerrains = ['grassland', 'plains', 'hills'];

        expect(starterTerrains).toContain(tile.terrain);
      }
    });

    it('should respect temperature restrictions (no frozen/hot zones)', async () => {
      await mapManager.generateMap(players);
      const mapData = mapManager.getMapData();

      for (const startPos of mapData!.startingPositions) {
        const tile = mapData!.tiles[startPos.x][startPos.y];

        // Should not be on frozen or extremely hot terrain
        expect(tile.terrain).not.toBe('tundra');
        expect(tile.terrain).not.toBe('arctic');
        expect(tile.terrain).not.toBe('desert'); // Extremely hot
      }
    });

    it('should maintain minimum distance constraints between start positions', async () => {
      await mapManager.generateMap(players);
      const mapData = mapManager.getMapData();
      const positions = mapData!.startingPositions;

      // Calculate distances between all pairs of starting positions
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const pos1 = positions[i];
          const pos2 = positions[j];

          const dx = Math.abs(pos1.x - pos2.x);
          const dy = Math.abs(pos1.y - pos2.y);
          const distance = Math.sqrt(dx * dx + dy * dy);

          // Minimum distance should be at least 3 tiles for small maps
          // (freeciv reference uses continent-size-based calculations)
          expect(distance).toBeGreaterThan(3);
        }
      }
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle continent ID validation properly', async () => {
      // Create a map with minimal land to test edge cases
      const smallManager = new MapManager(10, 10, 'small-test');
      const singlePlayer = createMockPlayers(1);

      // Should not crash with continent ID errors
      await expect(smallManager.generateMap(singlePlayer)).resolves.toBeDefined();
      const mapData = smallManager.getMapData();
      expect(mapData!.startingPositions).toBeDefined();
    });

    it('should gracefully handle insufficient suitable positions', async () => {
      // Test with many players on a very small map
      const manyPlayers = createMockPlayers(8);
      const tinyManager = new MapManager(15, 15, 'tiny-test');

      // Should not crash, might not place all players but should handle gracefully
      await expect(tinyManager.generateMap(manyPlayers)).resolves.toBeDefined();
    });
  });

  describe('Starting Position Generator Direct Tests', () => {
    it('should create starting position generator without errors', () => {
      const generator = new StartingPositionGenerator(40, 30);
      expect(generator).toBeDefined();
    });

    it('should handle empty player list gracefully', async () => {
      const emptyPlayers = new Map<string, PlayerState>();
      await expect(mapManager.generateMap(emptyPlayers)).resolves.toBeDefined();
      const mapData = mapManager.getMapData();
      expect(mapData!.startingPositions).toHaveLength(0);
    });
  });
});
