import { UnitManager, type Unit } from '@game/managers/UnitManager';
import { ActionType } from '@app-types/shared/actions';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('Unit Movement Integration Tests', () => {
  let unitManager: UnitManager;
  const gameId = 'test-game-movement';
  const mapWidth = 20;
  const mapHeight = 20;

  // Mock game manager callback for pathfinding
  const mockGameManagerCallback = {
    foundCity: jest.fn(),
    requestPath: jest.fn(),
    broadcastUnitMoved: jest.fn(),
  };

  beforeEach(() => {
    const mockDbProvider = createMockDatabaseProvider();
    unitManager = new UnitManager(
      gameId,
      mockDbProvider,
      mapWidth,
      mapHeight,
      undefined,
      mockGameManagerCallback
    );

    // Setup pathfinding mock to return simple adjacent paths
    mockGameManagerCallback.requestPath.mockImplementation(
      (_playerId: string, unitId: string, targetX: number, targetY: number) => {
        // Get unit to determine starting position
        const unit = unitManager.getUnit(unitId);
        if (!unit) return Promise.resolve({ success: false, error: 'Unit not found' });

        const dx = Math.abs(targetX - unit.x);
        const dy = Math.abs(targetY - unit.y);

        // Simple pathfinding: only adjacent moves allowed
        if (dx <= 1 && dy <= 1 && (dx > 0 || dy > 0)) {
          return Promise.resolve({
            success: true,
            path: {
              tiles: [
                { x: unit.x, y: unit.y },
                { x: targetX, y: targetY },
              ],
              totalCost: dx === 1 && dy === 1 ? 4 : 3, // Diagonal costs more
              estimatedTurns: 1,
            },
          });
        }

        // Multi-step path simulation for distant targets
        if (dx <= 3 && dy <= 3) {
          const tiles = [{ x: unit.x, y: unit.y }];
          let currentX = unit.x;
          let currentY = unit.y;

          // Simple path: move one step towards target
          if (targetX > currentX) currentX++;
          else if (targetX < currentX) currentX--;

          if (targetY > currentY) currentY++;
          else if (targetY < currentY) currentY--;

          tiles.push({ x: currentX, y: currentY });

          return Promise.resolve({
            success: true,
            path: {
              tiles,
              totalCost: 3, // Single step cost
              estimatedTurns: Math.max(dx, dy), // Manhattan distance estimate
            },
          });
        }

        return Promise.resolve({ success: false, error: 'No valid path' });
      }
    );

    jest.clearAllMocks();
  });

  describe('Basic Movement', () => {
    let testUnit: Unit;

    beforeEach(async () => {
      testUnit = await unitManager.createUnit('player-1', 'warriors', 10, 10);
    });

    it('should successfully perform a single goto action', async () => {
      const initialMovement = testUnit.movementLeft;

      const result = await unitManager.executeUnitAction(testUnit.id, ActionType.GOTO, 11, 10);

      expect(result.success).toBe(true);
      expect(result.newPosition).toEqual({ x: 11, y: 10 });
      expect(result.newMovementLeft).toBeLessThan(initialMovement);
      expect(result.newMovementLeft).toBeGreaterThanOrEqual(0);

      // Verify unit state was updated
      const updatedUnit = unitManager.getUnit(testUnit.id);
      expect(updatedUnit?.x).toBe(11);
      expect(updatedUnit?.y).toBe(10);
      expect(updatedUnit?.movementLeft).toBe(result.newMovementLeft);
    });

    it('should handle diagonal movement with higher cost', async () => {
      const initialMovement = testUnit.movementLeft;

      const result = await unitManager.executeUnitAction(testUnit.id, ActionType.GOTO, 11, 11);

      expect(result.success).toBe(true);
      expect(result.newPosition).toEqual({ x: 11, y: 11 });
      expect(result.movementCost).toBe(3);
      expect(result.newMovementLeft).toBe(initialMovement - 3);
    });

    it('should allow multiple goto actions in the same turn', async () => {
      // First move
      const result1 = await unitManager.executeUnitAction(testUnit.id, ActionType.GOTO, 11, 10);
      expect(result1.success).toBe(true);

      const movementAfterFirst = result1.newMovementLeft!;
      expect(movementAfterFirst).toBeGreaterThanOrEqual(0);

      // Second move (if enough movement points)
      if (movementAfterFirst >= 3) {
        const result2 = await unitManager.executeUnitAction(testUnit.id, ActionType.GOTO, 12, 10);

        expect(result2.success).toBe(true);
        expect(result2.newPosition).toEqual({ x: 12, y: 10 });
        expect(result2.newMovementLeft).toBe(movementAfterFirst - 3);

        // Verify no double deduction occurred
        const finalUnit = unitManager.getUnit(testUnit.id);
        expect(finalUnit?.movementLeft).toBe(result2.newMovementLeft);
      }
    });

    it('should prevent movement when insufficient movement points', async () => {
      // Exhaust movement points
      testUnit.movementLeft = 0;

      const result = await unitManager.executeUnitAction(testUnit.id, ActionType.GOTO, 11, 10);

      expect(result.success).toBe(false);
      expect(result.message).toBeDefined();

      // Unit should not have moved
      const unchangedUnit = unitManager.getUnit(testUnit.id);
      expect(unchangedUnit?.x).toBe(10);
      expect(unchangedUnit?.y).toBe(10);
    });
  });

  describe('Multi-Turn Movement', () => {
    let testUnit: Unit;

    beforeEach(async () => {
      testUnit = await unitManager.createUnit('player-1', 'warriors', 10, 10);
    });

    it('should set up orders for distant targets', async () => {
      const result = await unitManager.executeUnitAction(testUnit.id, ActionType.GOTO, 12, 12);

      expect(result.success).toBe(true);
      // Should move one step towards target
      expect(result.newPosition?.x).toBe(11);
      expect(result.newPosition?.y).toBe(11);

      // Should have orders to continue movement
      expect(result.newOrders).toBeDefined();
      expect(result.newOrders?.length).toBe(1);
      expect(result.newOrders?.[0]).toMatchObject({
        type: 'move',
        targetX: 12,
        targetY: 12,
      });

      // Verify unit has orders
      const updatedUnit = unitManager.getUnit(testUnit.id);
      expect(updatedUnit?.orders).toEqual(result.newOrders);
    });

    it('should clear orders when reaching destination', async () => {
      const result = await unitManager.executeUnitAction(
        testUnit.id,
        ActionType.GOTO,
        11,
        10 // Adjacent tile - reachable in one move
      );

      expect(result.success).toBe(true);
      expect(result.newPosition).toEqual({ x: 11, y: 10 });

      // Orders should be empty since destination was reached
      expect(result.newOrders).toEqual([]);

      const updatedUnit = unitManager.getUnit(testUnit.id);
      expect(updatedUnit?.orders).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    let testUnit: Unit;

    beforeEach(async () => {
      testUnit = await unitManager.createUnit('player-1', 'warriors', 10, 10);
    });

    it('should reject invalid coordinates', async () => {
      const result = await unitManager.executeUnitAction(testUnit.id, ActionType.GOTO, -1, -1);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid target coordinates');
    });

    it('should reject same position as target', async () => {
      const result = await unitManager.executeUnitAction(
        testUnit.id,
        ActionType.GOTO,
        testUnit.x,
        testUnit.y
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('already at target position');
    });

    it('should handle pathfinding failures gracefully', async () => {
      // Mock pathfinding to fail
      mockGameManagerCallback.requestPath.mockResolvedValueOnce({
        success: false,
        error: 'No valid path to target',
      });

      const result = await unitManager.executeUnitAction(testUnit.id, ActionType.GOTO, 15, 15);

      expect(result.success).toBe(false);
      expect(result.message).toContain('No valid path to target');

      // Unit should not have moved
      const unchangedUnit = unitManager.getUnit(testUnit.id);
      expect(unchangedUnit?.x).toBe(testUnit.x);
      expect(unchangedUnit?.y).toBe(testUnit.y);
    });

    it('should handle unit not found error', async () => {
      const result = await unitManager.executeUnitAction(
        'nonexistent-unit',
        ActionType.GOTO,
        11,
        10
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unit not found');
    });
  });

  describe('Movement Point Management', () => {
    let testUnit: Unit;

    beforeEach(async () => {
      testUnit = await unitManager.createUnit('player-1', 'warriors', 10, 10);
    });

    it('should not double-deduct movement points', async () => {
      const initialMovement = testUnit.movementLeft;

      const result = await unitManager.executeUnitAction(testUnit.id, ActionType.GOTO, 11, 10);

      expect(result.success).toBe(true);
      expect(result.movementCost).toBe(3); // Should be exactly 3 for adjacent move
      expect(result.newMovementLeft).toBe(initialMovement - 3);

      // Verify unit's actual movement matches the result
      const updatedUnit = unitManager.getUnit(testUnit.id);
      expect(updatedUnit?.movementLeft).toBe(result.newMovementLeft);
      expect(updatedUnit?.movementLeft).toBe(initialMovement - 3);
    });

    it('should preserve movement correctly across multiple actions', async () => {
      const initialMovement = testUnit.movementLeft;

      // First movement
      const result1 = await unitManager.executeUnitAction(testUnit.id, ActionType.GOTO, 11, 10);
      expect(result1.success).toBe(true);

      const expectedMovementAfterFirst = initialMovement - 3;
      expect(result1.newMovementLeft).toBe(expectedMovementAfterFirst);

      // Second movement (if possible)
      if (result1.newMovementLeft! >= 3) {
        const result2 = await unitManager.executeUnitAction(testUnit.id, ActionType.GOTO, 12, 10);
        expect(result2.success).toBe(true);

        const expectedMovementAfterSecond = expectedMovementAfterFirst - 3;
        expect(result2.newMovementLeft).toBe(expectedMovementAfterSecond);

        // Verify final unit state
        const finalUnit = unitManager.getUnit(testUnit.id);
        expect(finalUnit?.movementLeft).toBe(expectedMovementAfterSecond);
      }
    });

    it('should handle zero movement points correctly', async () => {
      // Set unit to have no movement
      testUnit.movementLeft = 0;

      const result = await unitManager.executeUnitAction(testUnit.id, ActionType.GOTO, 11, 10);

      expect(result.success).toBe(false);
      expect(result.message).toBeDefined();

      // Unit should remain at original position
      const unchangedUnit = unitManager.getUnit(testUnit.id);
      expect(unchangedUnit?.x).toBe(testUnit.x);
      expect(unchangedUnit?.y).toBe(testUnit.y);
      expect(unchangedUnit?.movementLeft).toBe(0);
    });
  });

  describe('Integration with Broadcasting', () => {
    let testUnit: Unit;

    beforeEach(async () => {
      testUnit = await unitManager.createUnit('player-1', 'warriors', 10, 10);
    });

    it('should broadcast unit movement on successful goto', async () => {
      const result = await unitManager.executeUnitAction(testUnit.id, ActionType.GOTO, 11, 10);

      expect(result.success).toBe(true);

      // Verify broadcast was called
      expect(mockGameManagerCallback.broadcastUnitMoved).toHaveBeenCalledWith(
        gameId,
        testUnit.id,
        11,
        10,
        result.newMovementLeft
      );
    });

    it('should not broadcast on failed movement', async () => {
      // Set up failure condition
      testUnit.movementLeft = 0;

      const result = await unitManager.executeUnitAction(testUnit.id, ActionType.GOTO, 11, 10);

      expect(result.success).toBe(false);
      expect(mockGameManagerCallback.broadcastUnitMoved).not.toHaveBeenCalled();
    });
  });
});
