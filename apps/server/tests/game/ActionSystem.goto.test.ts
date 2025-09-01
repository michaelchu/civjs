import { ActionSystem } from '../../src/game/ActionSystem';
import { ActionType } from '../../src/types/shared/actions';
import type { Unit } from '../../src/game/UnitManager';

describe('ActionSystem - Goto Actions', () => {
  let actionSystem: ActionSystem;
  const gameId = 'test-game-123';

  const mockUnit: Unit = {
    id: 'test-unit-1',
    gameId: 'test-game-123',
    playerId: 'player-1',
    unitTypeId: 'warrior',
    x: 10,
    y: 10,
    health: 100,
    movementLeft: 9, // 3 movement points in fragments
    fortified: false,
    veteranLevel: 0,
  };

  beforeEach(() => {
    actionSystem = new ActionSystem(gameId);
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
      expect(result.movementCost).toBe(3); // SINGLE_MOVE
      expect(result.message).toContain('moved to (11, 10)');
    });

    it('should calculate higher cost for diagonal movement', async () => {
      const result = await actionSystem.executeAction(mockUnit, ActionType.GOTO, 11, 11);

      expect(result.success).toBe(true);
      expect(result.newPosition).toEqual({ x: 11, y: 11 });
      expect(result.movementCost).toBe(4); // Math.floor(3 * 1.5)
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
      expect(result.message).toContain('Can only move to adjacent tiles');
    });

    it('should reject movement when insufficient movement points', async () => {
      const lowMovementUnit = { ...mockUnit, movementLeft: 2 }; // Less than required 3
      const result = await actionSystem.executeAction(lowMovementUnit, ActionType.GOTO, 11, 10);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Insufficient movement points');
    });

    it('should reject diagonal movement when insufficient movement points', async () => {
      const lowMovementUnit = { ...mockUnit, movementLeft: 3 }; // Less than required 4 for diagonal
      const result = await actionSystem.executeAction(lowMovementUnit, ActionType.GOTO, 11, 11);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Insufficient movement points');
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
        const result = await actionSystem.executeAction(mockUnit, ActionType.GOTO, x, y);
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
        expect(result.message).toContain('Can only move to adjacent tiles');
      }
    });

    it('should handle edge positions correctly', async () => {
      // Unit at map edge
      const edgeUnit = { ...mockUnit, x: 0, y: 0 };

      // Valid moves from edge
      const result1 = await actionSystem.executeAction(edgeUnit, ActionType.GOTO, 1, 0);
      const result2 = await actionSystem.executeAction(edgeUnit, ActionType.GOTO, 0, 1);
      const result3 = await actionSystem.executeAction(edgeUnit, ActionType.GOTO, 1, 1);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result3.success).toBe(true);
    });

    it('should calculate movement cost correctly for different directions', async () => {
      // Straight movement costs
      const northResult = await actionSystem.executeAction(mockUnit, ActionType.GOTO, 10, 9);
      const eastResult = await actionSystem.executeAction(mockUnit, ActionType.GOTO, 11, 10);

      expect(northResult.movementCost).toBe(3);
      expect(eastResult.movementCost).toBe(3);

      // Diagonal movement costs more
      const diagonalResult = await actionSystem.executeAction(mockUnit, ActionType.GOTO, 11, 9);
      expect(diagonalResult.movementCost).toBe(4); // Math.floor(3 * 1.5)
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
        [0, 0, true], // Valid minimum
        [199, 199, true], // Valid maximum
      ];

      for (const [x, y, shouldSucceed] of boundaryTests) {
        // Use a unit at position (1,1) so we can test movement to (0,0)
        const testUnit = { ...mockUnit, x: 1, y: 1 };
        const result = await actionSystem.executeAction(
          testUnit,
          ActionType.GOTO,
          x as number,
          y as number
        );

        if (
          shouldSucceed &&
          Math.abs((x as number) - testUnit.x) <= 1 &&
          Math.abs((y as number) - testUnit.y) <= 1
        ) {
          expect(result.success).toBe(true);
        } else {
          expect(result.success).toBe(false);
        }
      }
    });

    it('should provide meaningful error messages', async () => {
      const testCases = [
        { target: [-1, -1], expectedMessage: 'Invalid target coordinates' },
        { target: [mockUnit.x, mockUnit.y], expectedMessage: 'already at target position' },
        { target: [15, 15], expectedMessage: 'Can only move to adjacent tiles' },
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
});
