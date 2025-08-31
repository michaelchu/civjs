import { UnitManager, UNIT_TYPES } from '../../src/game/UnitManager';

// Get the mock from setup
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { db: mockDb } = require('../../src/database');

describe('UnitManager', () => {
  let unitManager: UnitManager;
  const gameId = 'test-game-id';
  const mapWidth = 80;
  const mapHeight = 50;

  beforeEach(() => {
    unitManager = new UnitManager(gameId, mapWidth, mapHeight);

    let unitCounter = 0;

    // Mock database operations
    mockDb.insert = jest.fn().mockReturnThis();
    mockDb.values = jest.fn().mockReturnThis();
    mockDb.returning = jest.fn().mockImplementation(() => {
      // Return a new unit ID each time with predictable pattern
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

    jest.clearAllMocks();
  });

  describe('unit types', () => {
    it('should have valid unit type definitions', () => {
      expect(UNIT_TYPES.warrior).toBeDefined();
      expect(UNIT_TYPES.warrior.name).toBe('Warrior');
      expect(UNIT_TYPES.warrior.movement).toBe(6); // 2 movement points = 6 fragments
      expect(UNIT_TYPES.warrior.combat).toBe(20);

      expect(UNIT_TYPES.settler).toBeDefined();
      expect(UNIT_TYPES.settler.canFoundCity).toBe(true);
      expect(UNIT_TYPES.settler.combat).toBe(0);

      expect(UNIT_TYPES.worker).toBeDefined();
      expect(UNIT_TYPES.worker.canBuildImprovements).toBe(true);
    });
  });

  describe('unit creation', () => {
    it('should create a unit successfully', async () => {
      const unit = await unitManager.createUnit('player-123', 'warrior', 10, 10);

      expect(unit.playerId).toBe('player-123');
      expect(unit.unitTypeId).toBe('warrior');
      expect(unit.x).toBe(10);
      expect(unit.y).toBe(10);
      expect(unit.health).toBe(100);
      expect(unit.movementLeft).toBe(6); // Warrior movement in fragments
      expect(unit.veteranLevel).toBe(0);
      expect(unit.fortified).toBe(false);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          gameId,
          playerId: 'player-123',
          unitType: 'warrior',
          x: 10,
          y: 10,
          health: 100,
        })
      );
    });

    it('should reject invalid unit type', async () => {
      await expect(unitManager.createUnit('player-123', 'invalid-unit', 10, 10)).rejects.toThrow(
        'Unknown unit type: invalid-unit'
      );
    });

    it('should reject invalid position', async () => {
      await expect(unitManager.createUnit('player-123', 'warrior', -1, 10)).rejects.toThrow(
        'Invalid position: -1, 10'
      );

      await expect(unitManager.createUnit('player-123', 'warrior', 100, 10)).rejects.toThrow(
        'Invalid position: 100, 10'
      );
    });

    it('should reject stacking civilian units', async () => {
      // First create a settler
      await unitManager.createUnit('player-123', 'settler', 10, 10);

      // Try to create another settler at same position
      await expect(unitManager.createUnit('player-123', 'worker', 10, 10)).rejects.toThrow(
        'Cannot stack civilian units'
      );
    });
  });

  describe('unit movement', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await unitManager.createUnit('player-123', 'warrior', 10, 10);
      unitId = unit.id;
    });

    it('should move unit successfully', async () => {
      const result = await unitManager.moveUnit(unitId, 11, 10);

      expect(result).toBe(true);

      const unit = unitManager.getUnit(unitId);
      expect(unit!.x).toBe(11);
      expect(unit!.y).toBe(10);
      expect(unit!.movementLeft).toBe(3); // Used 3 fragments for plains terrain
      expect(unit!.fortified).toBe(false);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 11,
          y: 10,
          movementPoints: '3', // 3 fragments remaining after plains movement
        })
      );
    });

    it('should reject move with insufficient movement', async () => {
      // Use up movement points
      await unitManager.moveUnit(unitId, 11, 10);
      await unitManager.moveUnit(unitId, 12, 10);

      // Should fail on third move
      await expect(unitManager.moveUnit(unitId, 13, 10)).rejects.toThrow(
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
      await unitManager.createUnit('player-456', 'warrior', 11, 10);

      await expect(unitManager.moveUnit(unitId, 11, 10)).rejects.toThrow(
        'Cannot move to tile occupied by enemy unit'
      );
    });
  });

  describe('unit combat', () => {
    let attackerUnitId: string;
    let defenderUnitId: string;

    beforeEach(async () => {
      const attacker = await unitManager.createUnit('player-123', 'warrior', 10, 10);
      const defender = await unitManager.createUnit('player-456', 'warrior', 11, 10);
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
      // Reset movement for the test
      await unitManager.resetMovement('player-123');

      // Move attacker away (2 spaces, using all movement)
      await unitManager.moveUnit(attackerUnitId, 8, 10);

      // Give some movement back to test range
      const attacker = unitManager.getUnit(attackerUnitId)!;
      attacker.movementLeft = 1;

      await expect(unitManager.attackUnit(attackerUnitId, defenderUnitId)).rejects.toThrow(
        'Target out of range'
      );
    });

    it('should reject attack with no movement', async () => {
      // Use up movement points
      await unitManager.moveUnit(attackerUnitId, 9, 10);
      await unitManager.moveUnit(attackerUnitId, 8, 10);

      await expect(unitManager.attackUnit(attackerUnitId, defenderUnitId)).rejects.toThrow(
        'No movement points remaining'
      );
    });

    it('should handle unit destruction', async () => {
      const attacker = unitManager.getUnit(attackerUnitId)!;
      const defender = unitManager.getUnit(defenderUnitId)!;

      // Set low health to ensure destruction
      attacker.health = 1;
      defender.health = 1;

      const result = await unitManager.attackUnit(attackerUnitId, defenderUnitId);

      // At least one unit should be destroyed with such low health
      expect(result.attackerDestroyed || result.defenderDestroyed).toBe(true);
    });
  });

  describe('unit fortification', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await unitManager.createUnit('player-123', 'warrior', 10, 10);
      unitId = unit.id;
    });

    it('should fortify unit successfully', async () => {
      await unitManager.fortifyUnit(unitId);

      const unit = unitManager.getUnit(unitId);
      expect(unit!.fortified).toBe(true);
      expect(unit!.movementLeft).toBe(0);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          movementPoints: '0',
          isFortified: true,
        })
      );
    });
  });

  describe('unit healing', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await unitManager.createUnit('player-123', 'warrior', 10, 10);
      unitId = unit.id;
      unit.health = 50; // Damaged unit
    });

    it('should heal unit', async () => {
      await unitManager.healUnit(unitId, 20);

      const unit = unitManager.getUnit(unitId);
      expect(unit!.health).toBe(70);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          health: 70,
        })
      );
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
      const unit = await unitManager.createUnit('player-123', 'warrior', 10, 10);
      unitId = unit.id;
      // Use some movement
      await unitManager.moveUnit(unitId, 11, 10);
    });

    it('should reset movement for player units', async () => {
      await unitManager.resetMovement('player-123');

      const unit = unitManager.getUnit(unitId);
      expect(unit!.movementLeft).toBe(6); // Reset to warrior's full movement in fragments
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
      await unitManager.createUnit('player-123', 'warrior', 10, 10);
      await unitManager.createUnit('player-123', 'settler', 11, 10);
      await unitManager.createUnit('player-456', 'warrior', 12, 10);
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
      expect(unit!.unitTypeId).toBe('warrior');

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
      await unitManager.createUnit('player-123', 'warrior', 10, 10);
      await unitManager.createUnit('player-456', 'warrior', 11, 10);
      await unitManager.createUnit('player-456', 'settler', 20, 20);
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

  describe('database integration', () => {
    it('should load units from database', async () => {
      const mockDbUnits = [
        {
          id: 'unit-1',
          gameId,
          playerId: 'player-1',
          unitType: 'warrior',
          x: 5,
          y: 5,
          movementPoints: '1.5',
          health: 80,
          veteranLevel: 1,
          isFortified: true,
        },
        {
          id: 'unit-2',
          gameId,
          playerId: 'player-2',
          unitType: 'settler',
          x: 10,
          y: 10,
          movementPoints: '2',
          health: 100,
          veteranLevel: 0,
          isFortified: false,
        },
      ];

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.where.mockResolvedValue(mockDbUnits);

      await unitManager.loadUnits();

      expect(unitManager.getUnit('unit-1')).toBeDefined();
      expect(unitManager.getUnit('unit-2')).toBeDefined();

      const unit1 = unitManager.getUnit('unit-1')!;
      expect(unit1.unitTypeId).toBe('warrior');
      expect(unit1.movementLeft).toBe(1.5);
      expect(unit1.fortified).toBe(true);

      const unit2 = unitManager.getUnit('unit-2')!;
      expect(unit2.unitTypeId).toBe('settler');
      expect(unit2.fortified).toBe(false);
    });
  });
});
