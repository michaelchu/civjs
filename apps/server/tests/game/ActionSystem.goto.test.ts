import { ActionSystem } from '@game/systems/ActionSystem';
import { ActionType } from '@app-types/shared/actions';
import type { Unit } from '@game/managers/UnitManager';

describe('ActionSystem - Goto Actions', () => {
  let actionSystem: ActionSystem;
  const gameId = 'test-game-123';

  const mockUnit: Unit = {
    id: 'test-unit-1',
    gameId: 'test-game-123',
    playerId: 'player-1',
    unitTypeId: 'warriors',
    x: 10,
    y: 10,
    health: 100,
    movementLeft: 18, // 3 movement points in C2C3 fragments
    fortified: false,
    veteranLevel: 0,
    experience: 0,
  };

  // Mock gameManagerCallback for pathfinding
  const mockGameManagerCallback = {
    foundCity: jest.fn(),
    requestPath: jest.fn(),
  };

  beforeEach(() => {
    mockGameManagerCallback.requestPath.mockImplementation(
      (_playerId: string, unitId: string, targetX: number, targetY: number) => {
        // The mock needs to determine the starting position. Since we can't easily track all unit states,
        // we'll infer the starting position based on the request context.
        // For tests using mockUnit.id, use mockUnit position (may be modified by previous actions)
        // For tests using other unit IDs, we need to infer the position from test patterns

        let unitX = mockUnit.x;
        let unitY = mockUnit.y;

        // Handle special cases based on common test patterns
        if (unitId !== mockUnit.id) {
          // This is likely a fresh test unit - most tests start from (10, 10) unless it's an edge test
          // We can infer edge tests by checking if the target is near map edges
          if ((targetX <= 1 && targetY <= 1) || unitId.includes('edge')) {
            unitX = 0;
            unitY = 0;
          } else {
            // Default test position for fresh units
            unitX = 10;
            unitY = 10;
          }
        } else {
          // For boundary tests, if target is (0,0), assume unit is at (1,1)
          if (targetX === 0 && targetY === 0) {
            unitX = 1;
            unitY = 1;
          }
        }

        // For adjacent tiles, return a simple path
        const dx = Math.abs(targetX - unitX);
        const dy = Math.abs(targetY - unitY);

        // Only allow adjacent moves (distance of 1)
        if (dx <= 1 && dy <= 1 && (dx > 0 || dy > 0)) {
          const pathResult = {
            success: true,
            path: {
              tiles: [
                { x: unitX, y: unitY, moveCost: 0 },
                { x: targetX, y: targetY, moveCost: 6 },
              ],
              totalCost: 6,
              estimatedTurns: 1,
            },
          };
          return Promise.resolve(pathResult);
        }

        // For non-adjacent or invalid moves
        return Promise.resolve({
          success: false,
          error: 'No valid path to target',
        });
      }
    );

    // Reset mockUnit state before each test to avoid contamination
    mockUnit.x = 10;
    mockUnit.y = 10;
    mockUnit.movementLeft = 18;
    mockUnit.fortified = false;

    actionSystem = new ActionSystem(gameId, mockGameManagerCallback);
    jest.clearAllMocks();
  });

  describe('canUnitPerformAction - GOTO', () => {
    it('should allow goto action when unit has movement and valid target', () => {
      const canGoto = actionSystem.canUnitPerformAction(mockUnit, ActionType.GOTO, 11, 10);
      expect(canGoto).toBe(true);
    });

    it('should prevent goto action when unit has no movement', () => {
      const tiredUnit = { ...mockUnit, movementLeft: 0 };
      const canGoto = actionSystem.canUnitPerformAction(tiredUnit, ActionType.GOTO, 11, 10);
      expect(canGoto).toBe(false);
    });

    it('should prevent goto action without target coordinates', () => {
      const canGoto = actionSystem.canUnitPerformAction(mockUnit, ActionType.GOTO);
      expect(canGoto).toBe(false);
    });

    it('should prevent goto action with undefined target coordinates', () => {
      const canGoto = actionSystem.canUnitPerformAction(
        mockUnit,
        ActionType.GOTO,
        undefined,
        undefined
      );
      expect(canGoto).toBe(false);
    });
  });

  describe('executeAction - GOTO', () => {
    it('should successfully move unit to adjacent tile', async () => {
      const result = await actionSystem.executeAction(mockUnit, ActionType.GOTO, 11, 10);

      expect(result.success).toBe(true);
      expect(result.newPosition).toEqual({ x: 11, y: 10 });
      expect(result.movementCost).toBe(6); // C2C3 SINGLE_MOVE
      expect(result.message).toContain('moved to (11, 10)');
    });

    it('should use the authoritative C2C3 cost for diagonal movement', async () => {
      const result = await actionSystem.executeAction(mockUnit, ActionType.GOTO, 11, 11);

      expect(result.success).toBe(true);
      expect(result.newPosition).toEqual({ x: 11, y: 11 });
      expect(result.movementCost).toBe(6);
    });

    it('should reject invalid coordinates', async () => {
      const result1 = await actionSystem.executeAction(mockUnit, ActionType.GOTO, -1, -1);
      const result2 = await actionSystem.executeAction(mockUnit, ActionType.GOTO, 300, 300);

      expect(result1.success).toBe(false);
      expect(result1.message).toContain('Invalid target coordinates');
      expect(result2.success).toBe(false);
      expect(result2.message).toContain('Invalid target coordinates');
    });

    it('should reject same position as target', async () => {
      const result = await actionSystem.executeAction(
        mockUnit,
        ActionType.GOTO,
        mockUnit.x,
        mockUnit.y
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('already at target position');
    });

    it('should reject non-adjacent tiles', async () => {
      const result = await actionSystem.executeAction(mockUnit, ActionType.GOTO, 15, 15);

      expect(result.success).toBe(false);
      expect(result.message).toContain('No valid path to target');
    });

    it('should allow movement with minimum move rule when unit has any movement points', async () => {
      const lowMovementUnit = { ...mockUnit, movementLeft: 2 }; // Less than required 3 but minimum move rule applies
      const result = await actionSystem.executeAction(lowMovementUnit, ActionType.GOTO, 11, 10);

      expect(result.success).toBe(true); // Minimum move rule allows this
      expect(result.newPosition).toEqual({ x: 11, y: 10 });
      expect(result.newMovementLeft).toBe(0); // All movement consumed
    });

    it('should allow diagonal movement with minimum move rule when unit has any movement points', async () => {
      const lowMovementUnit = { ...mockUnit, movementLeft: 3 }; // Less than required 4 for diagonal but minimum move rule applies
      const result = await actionSystem.executeAction(lowMovementUnit, ActionType.GOTO, 11, 11);

      expect(result.success).toBe(true); // Minimum move rule allows this
      expect(result.newPosition).toEqual({ x: 11, y: 11 });
      expect(result.newMovementLeft).toBe(0); // All movement consumed
    });

    it('consumes the authoritative per-step road and terrain costs', async () => {
      const authoritativeSystem = new ActionSystem(gameId, {
        ...mockGameManagerCallback,
        requestPath: jest.fn(async () => ({
          success: true,
          path: {
            tiles: [
              { x: 10, y: 10, moveCost: 0 },
              { x: 11, y: 10, moveCost: 0 },
              { x: 12, y: 10, moveCost: 6 },
            ],
            totalCost: 6,
            estimatedTurns: 1,
          },
        })),
      });

      const result = await authoritativeSystem.executeAction(
        { ...mockUnit, movementLeft: 18 },
        ActionType.GOTO,
        12,
        10
      );

      expect(result.success).toBe(true);
      expect(result.newPosition).toEqual({ x: 12, y: 10 });
      expect(result.movementCost).toBe(6);
      expect(result.newMovementLeft).toBe(12);
    });

    it('should reject movement when unit has no movement left', async () => {
      const tiredUnit = { ...mockUnit, movementLeft: 0 };
      const result = await actionSystem.executeAction(tiredUnit, ActionType.GOTO, 11, 10);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unit cannot perform Go To');
    });
  });

  describe('movement validation', () => {
    it('should validate all 8 adjacent positions', async () => {
      const adjacentPositions = [
        [9, 9], // NW
        [10, 9], // N
        [11, 9], // NE
        [11, 10], // E
        [11, 11], // SE
        [10, 11], // S
        [9, 11], // SW
        [9, 10], // W
      ];

      for (const [x, y] of adjacentPositions) {
        // Create a fresh unit for each test to avoid state contamination
        const testUnit = { ...mockUnit, x: 10, y: 10, movementLeft: 18 };
        const result = await actionSystem.executeAction(testUnit, ActionType.GOTO, x, y);
        expect(result.success).toBe(true);
        expect(result.newPosition).toEqual({ x, y });
      }
    });

    it('should reject positions that are 2+ tiles away', async () => {
      const distantPositions = [
        [8, 8], // 2 tiles NW
        [10, 8], // 2 tiles N
        [12, 10], // 2 tiles E
        [10, 12], // 2 tiles S
        [13, 13], // Far diagonal
      ];

      for (const [x, y] of distantPositions) {
        const result = await actionSystem.executeAction(mockUnit, ActionType.GOTO, x, y);
        expect(result.success).toBe(false);
        expect(result.message).toContain('No valid path to target');
      }
    });

    it('should handle edge positions correctly', async () => {
      // Units at map edge - use unique IDs so the mock can identify them
      const edgeUnit1 = { ...mockUnit, id: 'edge-unit-1', x: 0, y: 0, movementLeft: 18 };
      const edgeUnit2 = { ...mockUnit, id: 'edge-unit-2', x: 0, y: 0, movementLeft: 18 };
      const edgeUnit3 = { ...mockUnit, id: 'edge-unit-3', x: 0, y: 0, movementLeft: 18 };

      // Valid moves from edge
      const result1 = await actionSystem.executeAction(edgeUnit1, ActionType.GOTO, 1, 0);
      const result2 = await actionSystem.executeAction(edgeUnit2, ActionType.GOTO, 0, 1);
      const result3 = await actionSystem.executeAction(edgeUnit3, ActionType.GOTO, 1, 1);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result3.success).toBe(true);
    });

    it('should calculate movement cost correctly for different directions', async () => {
      // Straight movement costs - each gets a fresh unit at (10, 10)
      const northUnit = { ...mockUnit, x: 10, y: 10, movementLeft: 18 };
      const eastUnit = { ...mockUnit, x: 10, y: 10, movementLeft: 18 };
      const diagonalUnit = { ...mockUnit, x: 10, y: 10, movementLeft: 18 };

      const northResult = await actionSystem.executeAction(northUnit, ActionType.GOTO, 10, 9);
      const eastResult = await actionSystem.executeAction(eastUnit, ActionType.GOTO, 11, 10);

      expect(northResult.movementCost).toBe(6);
      expect(eastResult.movementCost).toBe(6);

      // C2C3 diagonal movement uses the same cost.
      const diagonalResult = await actionSystem.executeAction(diagonalUnit, ActionType.GOTO, 11, 9);
      expect(diagonalResult.movementCost).toBe(6);
    });
  });

  describe('action definition', () => {
    it('should have correct GOTO action definition', () => {
      const actionDef = actionSystem.getActionDefinition(ActionType.GOTO);

      expect(actionDef).toBeDefined();
      expect(actionDef?.id).toBe(ActionType.GOTO);
    });

    it('should report correct movement requirements', () => {
      // Unit with exactly enough movement for straight move
      const exactMovementUnit = { ...mockUnit, movementLeft: 3 };
      expect(actionSystem.canUnitPerformAction(exactMovementUnit, ActionType.GOTO, 11, 10)).toBe(
        true
      );

      // Unit with exactly enough movement for diagonal move
      const diagonalMovementUnit = { ...mockUnit, movementLeft: 4 };
      expect(actionSystem.canUnitPerformAction(diagonalMovementUnit, ActionType.GOTO, 11, 11)).toBe(
        true
      );
    });
  });

  describe('error handling', () => {
    it('should handle coordinate boundary validation', async () => {
      const boundaryTests = [
        [-1, 10, false], // X too low
        [200, 10, false], // X too high
        [10, -1, false], // Y too low
        [10, 200, false], // Y too high
        [0, 0, true], // Valid minimum (but should fail pathfinding from (1,1))
        [199, 199, true], // Valid maximum (but should fail pathfinding from (1,1))
      ];

      for (const [x, y, shouldPassBoundaryValidation] of boundaryTests) {
        // Use a unit at position (1,1) so we can test movement to (0,0)
        const testUnit = { ...mockUnit, x: 1, y: 1 };
        const result = await actionSystem.executeAction(
          testUnit,
          ActionType.GOTO,
          x as number,
          y as number
        );

        // For invalid coordinates, should fail with boundary validation message
        if (!shouldPassBoundaryValidation) {
          expect(result.success).toBe(false);
          expect(result.message).toBe('Invalid target coordinates');
        } else {
          // For valid coordinates, check if pathfinding works
          const dx = Math.abs((x as number) - testUnit.x);
          const dy = Math.abs((y as number) - testUnit.y);
          if (dx <= 1 && dy <= 1 && (dx > 0 || dy > 0)) {
            // Adjacent move should succeed if coordinates are valid
            expect(result.success).toBe(true);
          } else {
            // Too far - should fail due to pathfinding
            expect(result.success).toBe(false);
            expect(result.message).not.toBe('Invalid target coordinates');
          }
        }
      }
    });

    it('should provide meaningful error messages', async () => {
      const testCases = [
        { target: [-1, -1], expectedMessage: 'Invalid target coordinates' },
        { target: [mockUnit.x, mockUnit.y], expectedMessage: 'already at target position' },
        { target: [15, 15], expectedMessage: 'No valid path to target' },
      ];

      for (const testCase of testCases) {
        const result = await actionSystem.executeAction(
          mockUnit,
          ActionType.GOTO,
          testCase.target[0],
          testCase.target[1]
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain(testCase.expectedMessage);
      }
    });
  });

  describe('exposed action contract', () => {
    it('has an authoritative execution route for every exposed generic action', () => {
      const delegatedToUnitManager = new Set([
        ActionType.LOAD_UNIT,
        ActionType.UNLOAD_UNIT,
        ActionType.PARADROP,
        ActionType.BOMBARD,
        ActionType.NUCLEAR_EXPLOSION,
        ActionType.COLLECT_RANSOM,
        ActionType.SUICIDE_ATTACK,
        ActionType.AIRLIFT,
        ActionType.AUTO_EXPLORE,
        ActionType.AUTO_SETTLER,
        ActionType.PATROL,
        ActionType.MARKETPLACE,
        ActionType.HELP_WONDER,
        ActionType.JOIN_CITY,
        ActionType.DISBAND_UNIT_RECOVER,
        ActionType.CHANGE_HOME_CITY,
        ActionType.UPGRADE_UNIT,
      ]);
      const directExecutors = (actionSystem as any).actionExecutors as Map<ActionType, unknown>;

      for (const actionType of Object.values(ActionType)) {
        if (actionSystem.getActionDefinition(actionType)) {
          expect(directExecutors.has(actionType) || delegatedToUnitManager.has(actionType)).toBe(
            true
          );
        }
      }
    });
  });
});
