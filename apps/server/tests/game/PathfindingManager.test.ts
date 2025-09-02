import { PathfindingManager } from '../../src/game/PathfindingManager';
import type { Unit } from '../../src/game/UnitManager';

describe('PathfindingManager', () => {
  let pathfindingManager: PathfindingManager;
  const mockMapWidth = 50;
  const mockMapHeight = 50;

  // Mock MapManager
  const mockMapManager = {
    getTile: jest.fn(),
  };

  // Mock unit for testing
  const mockUnit: Unit = {
    id: 'test-unit-1',
    gameId: 'test-game-123',
    playerId: 'player-1',
    unitTypeId: 'warrior',
    x: 10,
    y: 10,
    health: 100,
    movementLeft: 3,
    fortified: false,
    veteranLevel: 0,
  };

  beforeEach(() => {
    pathfindingManager = new PathfindingManager(mockMapWidth, mockMapHeight, mockMapManager);
    jest.clearAllMocks();
  });

  describe('findPath', () => {
    it('should return empty path for invalid coordinates', async () => {
      const result = await pathfindingManager.findPath(mockUnit, -1, -1);

      expect(result.valid).toBe(false);
      expect(result.path).toHaveLength(0);
      expect(result.totalCost).toBe(0);
      expect(result.estimatedTurns).toBe(0);
    });

    it('should return current position for same start and target', async () => {
      const result = await pathfindingManager.findPath(mockUnit, mockUnit.x, mockUnit.y);

      expect(result.valid).toBe(true);
      expect(result.path).toHaveLength(1);
      expect(result.path[0]).toMatchObject({
        x: mockUnit.x,
        y: mockUnit.y,
        moveCost: 0,
      });
      expect(result.totalCost).toBe(0);
      expect(result.estimatedTurns).toBe(0);
    });

    it('should find path to adjacent tile', async () => {
      // Mock terrain for path tiles
      mockMapManager.getTile.mockImplementation((x: number, y: number) => {
        if ((x === 10 && y === 10) || (x === 11 && y === 10)) {
          return { x, y, terrain: 'grassland' };
        }
        return null;
      });

      const result = await pathfindingManager.findPath(mockUnit, 11, 10);

      expect(result.valid).toBe(true);
      expect(result.path.length).toBeGreaterThan(1);
      expect(result.path[0]).toMatchObject({
        x: mockUnit.x,
        y: mockUnit.y,
        moveCost: 0,
      });
      expect(result.path[result.path.length - 1].x).toBe(11);
      expect(result.path[result.path.length - 1].y).toBe(10);
      expect(result.totalCost).toBeGreaterThan(0);
    });

    it('should handle diagonal movement', async () => {
      // Mock terrain for diagonal path
      mockMapManager.getTile.mockImplementation((x: number, y: number) => {
        if ((x === 10 && y === 10) || (x === 11 && y === 11)) {
          return { x, y, terrain: 'grassland' };
        }
        return null;
      });

      const result = await pathfindingManager.findPath(mockUnit, 11, 11);

      expect(result.valid).toBe(true);
      expect(result.totalCost).toBeGreaterThan(3); // Should cost more than straight movement
    });

    it('should calculate correct estimated turns', async () => {
      // Mock terrain
      mockMapManager.getTile.mockReturnValue({ terrain: 'grassland' });

      const result = await pathfindingManager.findPath(mockUnit, 15, 15);

      expect(result.estimatedTurns).toBeGreaterThan(0);
      expect(typeof result.estimatedTurns).toBe('number');
    });

    it('should handle pathfinding failure gracefully', async () => {
      // Mock MapManager to fail
      mockMapManager.getTile.mockImplementation(() => {
        throw new Error('Map access failed');
      });

      const result = await pathfindingManager.findPath(mockUnit, 15, 15);

      // Should return invalid result when pathfinding fails (matches freeciv behavior)
      expect(result.valid).toBe(false);
      expect(result.path.length).toBe(0);
      expect(result.totalCost).toBe(0);
      expect(result.estimatedTurns).toBe(0);
    });

    it('should reject coordinates outside map bounds', async () => {
      const result1 = await pathfindingManager.findPath(
        mockUnit,
        mockMapWidth + 10,
        mockMapHeight + 10
      );
      const result2 = await pathfindingManager.findPath(mockUnit, -5, -5);

      expect(result1.valid).toBe(false);
      expect(result2.valid).toBe(false);
    });

    it('should include movement directions in path tiles', async () => {
      mockMapManager.getTile.mockReturnValue({ terrain: 'grassland' });

      const result = await pathfindingManager.findPath(mockUnit, 12, 10);

      expect(result.valid).toBe(true);
      if (result.path.length > 1) {
        // Check that some tiles have direction information
        const tilesWithDirection = result.path.filter(tile => tile.direction !== undefined);
        expect(tilesWithDirection.length).toBeGreaterThan(0);
      }
    });
  });

  describe('path calculation', () => {
    beforeEach(() => {
      mockMapManager.getTile.mockReturnValue({ terrain: 'grassland' });
    });

    it('should find optimal path around obstacles', async () => {
      // Create a simple obstacle pattern
      mockMapManager.getTile.mockImplementation((x: number, y: number) => {
        // Block direct path with impassable terrain
        if (x === 11 && y === 10) {
          return null; // Impassable
        }
        return { x, y, terrain: 'grassland' };
      });

      const result = await pathfindingManager.findPath(mockUnit, 12, 10);

      expect(result.valid).toBe(true);
      // Path should go around the obstacle
      expect(result.path.length).toBeGreaterThan(2);
    });

    it('should handle different terrain costs', async () => {
      mockMapManager.getTile.mockImplementation((x: number, y: number) => {
        if (x === 11 && y === 10) {
          return { x, y, terrain: 'hills' }; // Higher cost terrain
        }
        return { x, y, terrain: 'grassland' };
      });

      const result1 = await pathfindingManager.findPath(mockUnit, 11, 10); // Through hills

      mockMapManager.getTile.mockReturnValue({ terrain: 'grassland' });
      const result2 = await pathfindingManager.findPath(mockUnit, 11, 10); // Through grassland

      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
      // Hills should cost more than grassland
      expect(result1.totalCost).toBeGreaterThan(result2.totalCost);
    });
  });

  describe('edge cases', () => {
    it('should handle very long paths', async () => {
      mockMapManager.getTile.mockReturnValue({ terrain: 'grassland' });

      const result = await pathfindingManager.findPath(mockUnit, 40, 40);

      expect(result.valid).toBe(true);
      expect(result.estimatedTurns).toBeGreaterThan(1);
    });

    it('should handle unit with no movement left', async () => {
      const tiredUnit = { ...mockUnit, movementLeft: 0 };
      mockMapManager.getTile.mockReturnValue({ terrain: 'grassland' });

      const result = await pathfindingManager.findPath(tiredUnit, 11, 10);

      // Should still calculate path even with no movement left (path calculation is separate from movement execution)
      expect(result.valid).toBe(true);
    });

    it('should handle map boundaries correctly', async () => {
      mockMapManager.getTile.mockReturnValue({ terrain: 'grassland' });

      // Test near map edge
      const cornerUnit = { ...mockUnit, x: 0, y: 0 };
      const result = await pathfindingManager.findPath(cornerUnit, 2, 2);

      expect(result.valid).toBe(true);
      expect(result.path[0]).toMatchObject({
        x: 0,
        y: 0,
        moveCost: 0,
      });
    });
  });

  describe('performance', () => {
    it('should complete pathfinding within reasonable time', async () => {
      mockMapManager.getTile.mockReturnValue({ terrain: 'grassland' });

      const startTime = Date.now();
      const result = await pathfindingManager.findPath(mockUnit, 30, 30);
      const endTime = Date.now();

      expect(result.valid).toBe(true);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle multiple concurrent pathfinding requests', async () => {
      mockMapManager.getTile.mockReturnValue({ terrain: 'grassland' });

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(pathfindingManager.findPath(mockUnit, 20 + i, 20 + i));
      }

      const results = await Promise.all(promises);

      results.forEach(result => {
        expect(result.valid).toBe(true);
      });
    });
  });
});
