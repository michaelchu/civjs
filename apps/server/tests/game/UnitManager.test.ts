import { UnitManager } from '@game/managers/UnitManager';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('UnitManager', () => {
  let unitManager: UnitManager;
  const gameId = 'test-game-id';
  const mapWidth = 80;
  const mapHeight = 50;

  beforeEach(() => {
    const mockDbProvider = createMockDatabaseProvider();
    unitManager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight);
    jest.clearAllMocks();
  });

  describe('unit types', () => {
    it('should have valid unit type definitions', () => {
      expect(UNIT_TYPES.warriors).toBeDefined();
      expect(UNIT_TYPES.warriors.name).toBe('Warriors'); // From freeciv ruleset
      expect(UNIT_TYPES.warriors.movement).toBe(1); // Freeciv movement points (not fragments)
      expect(UNIT_TYPES.warriors.attack).toBe(1); // Freeciv attack value
      expect(UNIT_TYPES.warriors.cost).toBe(10); // Corrected freeciv cost

      expect(UNIT_TYPES.settlers).toBeDefined(); // 'settlers' not 'settler'
      expect(UNIT_TYPES.settlers.flags).toContain('Cities'); // Can found cities via flag
      expect(UNIT_TYPES.settlers.attack).toBe(0); // Non-combat unit

      expect(UNIT_TYPES.worker).toBeDefined();
      expect(UNIT_TYPES.worker.flags).toContain('Workers'); // Can build improvements via flag
    });
  });

  describe('unit creation', () => {
    it('should create a unit successfully', async () => {
      const unit = await unitManager.createUnit('player-123', 'warriors', 10, 10);

      expect(unit.playerId).toBe('player-123');
      expect(unit.unitTypeId).toBe('warriors');
      expect(unit.x).toBe(10);
      expect(unit.y).toBe(10);
      expect(unit.health).toBe(100);
      expect(unit.movementLeft).toBe(3); // Warrior movement in fragments (1 * 3)
      expect(unit.veteranLevel).toBe(0);
      expect(unit.fortified).toBe(false);

      // Database operations are handled by MockDatabaseProvider
    });

    it('should reject invalid unit type', async () => {
      await expect(unitManager.createUnit('player-123', 'invalid-unit', 10, 10)).rejects.toThrow(
        'Unknown unit type: invalid-unit'
      );
    });

    it('should reject invalid position', async () => {
      await expect(unitManager.createUnit('player-123', 'warriors', -1, 10)).rejects.toThrow(
        'Invalid position: -1, 10'
      );

      await expect(unitManager.createUnit('player-123', 'warriors', 100, 10)).rejects.toThrow(
        'Invalid position: 100, 10'
      );
    });

    it('should reject stacking civilian units', async () => {
      // First create a settler (use 'settlers' from freeciv)
      await unitManager.createUnit('player-123', 'settlers', 10, 10);

      // Try to create another settler at same position
      await expect(unitManager.createUnit('player-123', 'worker', 10, 10)).rejects.toThrow(
        'Cannot stack civilian units'
      );
    });
  });

  describe('unit movement', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      unitId = unit.id;
    });

    it('should move unit successfully', async () => {
      const result = await unitManager.moveUnit(unitId, 11, 10);

      expect(result).toBe(true);

      const unit = unitManager.getUnit(unitId);
      expect(unit!.x).toBe(11);
      expect(unit!.y).toBe(10);
      expect(unit!.movementLeft).toBe(0); // Used 1 movement point for basic terrain
      expect(unit!.fortified).toBe(false);

      // Database operations are handled by MockDatabaseProvider
    });

    it('should reject move with insufficient movement', async () => {
      // Use up movement point (warrior has only 1 movement in freeciv)
      await unitManager.moveUnit(unitId, 11, 10);

      // Should fail on second move - no movement left
      await expect(unitManager.moveUnit(unitId, 12, 10)).rejects.toThrow(
        'Not enough movement points'
      );
    });

    it('should reject move to invalid position', async () => {
      await expect(unitManager.moveUnit(unitId, -1, 10)).rejects.toThrow(
        'Invalid position: -1, 10'
      );
    });

    it('should reject move to enemy unit position', async () => {
      // Create enemy unit
      await unitManager.createUnit('player-456', 'warriors', 11, 10);

      await expect(unitManager.moveUnit(unitId, 11, 10)).rejects.toThrow(
        'Cannot move to tile occupied by enemy unit'
      );
    });
  });

  describe('unit combat', () => {
    let attackerUnitId: string;
    let defenderUnitId: string;

    beforeEach(async () => {
      const attacker = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      const defender = await unitManager.createUnit('player-456', 'warriors', 11, 10);
      attackerUnitId = attacker.id;
      defenderUnitId = defender.id;
    });

    it('should conduct combat successfully', async () => {
      const result = await unitManager.attackUnit(attackerUnitId, defenderUnitId);

      expect(result.attackerId).toBe(attackerUnitId);
      expect(result.defenderId).toBe(defenderUnitId);
      expect(result.attackerDamage).toBeGreaterThan(0);
      expect(result.defenderDamage).toBeGreaterThan(0);

      const attacker = unitManager.getUnit(attackerUnitId);
      expect(attacker!.movementLeft).toBe(0); // Attack uses all movement
    });

    it('should reject attack out of range', async () => {
      // Move attacker away to position out of range
      const attacker = unitManager.getUnit(attackerUnitId)!;
      attacker.x = 5; // Far from defender at (11, 10)
      attacker.y = 5;
      attacker.movementLeft = 1; // Give movement for attack attempt

      await expect(unitManager.attackUnit(attackerUnitId, defenderUnitId)).rejects.toThrow(
        'Target out of range'
      );
    });

    it('should reject attack with no movement', async () => {
      // Use up movement point (warrior has only 1 movement)
      const attacker = unitManager.getUnit(attackerUnitId)!;
      attacker.movementLeft = 0; // No movement left

      await expect(unitManager.attackUnit(attackerUnitId, defenderUnitId)).rejects.toThrow(
        'No movement points remaining' // Actual error message from UnitManager
      );
    });

    it('should handle unit destruction', async () => {
      const attacker = unitManager.getUnit(attackerUnitId)!;
      const defender = unitManager.getUnit(defenderUnitId)!;

      // Set low health to ensure destruction
      attacker.health = 1;
      defender.health = 1;
      attacker.movementLeft = 1; // Give movement for attack

      const result = await unitManager.attackUnit(attackerUnitId, defenderUnitId);

      // At least one unit should be destroyed with such low health
      expect(result.attackerDestroyed || result.defenderDestroyed).toBe(true);
    });
  });

  describe('unit fortification', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      unitId = unit.id;
    });

    it('should fortify unit successfully', async () => {
      await unitManager.fortifyUnit(unitId);

      const unit = unitManager.getUnit(unitId);
      expect(unit!.fortified).toBe(true);
      expect(unit!.movementLeft).toBe(0);

      // Database operations are handled by MockDatabaseProvider
    });
  });

  describe('unit healing', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      unitId = unit.id;
      unit.health = 50; // Damaged unit
    });

    it('should heal unit', async () => {
      await unitManager.healUnit(unitId, 20);

      const unit = unitManager.getUnit(unitId);
      expect(unit!.health).toBe(70);

      // Database operations are handled by MockDatabaseProvider
    });

    it('should not heal above max health', async () => {
      await unitManager.healUnit(unitId, 80);

      const unit = unitManager.getUnit(unitId);
      expect(unit!.health).toBe(100); // Capped at 100
    });
  });

  describe('turn management', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      unitId = unit.id;
      // Use some movement (unit starts with 1 movement)
      await unitManager.moveUnit(unitId, 11, 10);
    });

    it('should reset movement for player units', async () => {
      await unitManager.resetMovement('player-123');

      const unit = unitManager.getUnit(unitId);
      expect(unit!.movementLeft).toBe(3); // Reset to warrior's full movement in fragments
    });

    it('should heal fortified units', async () => {
      const unit = unitManager.getUnit(unitId)!;
      unit.health = 80;
      unit.fortified = true;

      await unitManager.resetMovement('player-123');

      expect(unit.health).toBe(90); // Healed 10 points
    });
  });

  describe('unit queries', () => {
    beforeEach(async () => {
      await unitManager.createUnit('player-123', 'warriors', 10, 10);
      await unitManager.createUnit('player-123', 'settlers', 11, 10); // Use 'settlers'
      await unitManager.createUnit('player-456', 'warriors', 12, 10);
    });

    it('should get player units', () => {
      const player123Units = unitManager.getPlayerUnits('player-123');
      const player456Units = unitManager.getPlayerUnits('player-456');

      expect(player123Units).toHaveLength(2);
      expect(player456Units).toHaveLength(1);

      expect(player123Units.every(u => u.playerId === 'player-123')).toBe(true);
      expect(player456Units.every(u => u.playerId === 'player-456')).toBe(true);
    });

    it('should get unit at position', () => {
      const unit = unitManager.getUnitAt(10, 10);
      expect(unit).toBeDefined();
      expect(unit!.unitTypeId).toBe('warriors');

      const noUnit = unitManager.getUnitAt(50, 50);
      expect(noUnit).toBeUndefined();
    });

    it('should get all units at position', () => {
      const units = unitManager.getUnitsAt(10, 10);
      expect(units).toHaveLength(1);

      const noUnits = unitManager.getUnitsAt(50, 50);
      expect(noUnits).toHaveLength(0);
    });
  });

  describe('visibility', () => {
    beforeEach(async () => {
      await unitManager.createUnit('player-123', 'warriors', 10, 10);
      await unitManager.createUnit('player-456', 'warriors', 11, 10);
      await unitManager.createUnit('player-456', 'settlers', 20, 20); // Use 'settlers'
    });

    it('should return visible units for player', () => {
      const visibleTiles = new Set(['10,10', '11,10', '12,10']);

      const visibleUnits = unitManager.getVisibleUnits('player-123', visibleTiles);

      // Should see own unit + enemy unit in visible range
      expect(visibleUnits).toHaveLength(2);
      expect(visibleUnits.some(u => u.playerId === 'player-123')).toBe(true);
      expect(visibleUnits.some(u => u.playerId === 'player-456' && u.x === 11)).toBe(true);
      expect(visibleUnits.every(u => u.x !== 20)).toBe(true); // Shouldn't see distant unit
    });

    it('should always see own units', () => {
      const visibleTiles = new Set(['15,15']); // Random visible area

      const visibleUnits = unitManager.getVisibleUnits('player-123', visibleTiles);

      // Should still see own unit even if not in visible tiles
      expect(visibleUnits).toHaveLength(1);
      expect(visibleUnits[0].playerId).toBe('player-123');
    });
  });

  // Database integration is tested in integration tests
  // Unit tests focus on business logic without database interactions
});
