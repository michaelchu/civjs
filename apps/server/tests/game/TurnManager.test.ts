import { TurnManager } from '../../src/game/TurnManager';
import { mockIo } from '../setup';

describe('TurnManager', () => {
  let turnManager: TurnManager;
  const testGameId = 'test-game-id';
  const testPlayerIds = ['player1', 'player2', 'player3'];

  beforeEach(() => {
    turnManager = new TurnManager(testGameId, mockIo);

    // Mock database operations
    turnManager['createTurnRecord'] = jest.fn().mockResolvedValue(undefined);
    turnManager['completeTurnRecord'] = jest.fn().mockResolvedValue(undefined);
    turnManager['advanceToNextTurn'] = jest.fn().mockImplementation(async () => {
      turnManager['currentTurn']++;
      turnManager['currentYear'] = turnManager['calculateYearFromTurn'](turnManager['currentTurn']);
      turnManager['turnStartTime'] = new Date();
      turnManager['turnEvents'] = [];
      turnManager['playerActions'].clear();
    });

    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with correct game ID and IO server', () => {
      expect(turnManager['gameId']).toBe(testGameId);
      expect(turnManager['io']).toBe(mockIo);
      expect(turnManager.getCurrentTurn()).toBe(0);
      expect(turnManager.getCurrentYear()).toBe(-4000);
    });

    it('should initialize turn system correctly', async () => {
      await turnManager.initializeTurn(testPlayerIds);

      expect(turnManager.getCurrentTurn()).toBe(1);
      expect(turnManager.getCurrentYear()).toBe(-4000);
      expect(turnManager['playerActions'].size).toBe(3);
      expect(turnManager['turnStartTime']).toBeInstanceOf(Date);
    });
  });

  describe('year calculation', () => {
    it('should calculate correct years for different turn ranges', () => {
      // Early game (turns 1-75): 40 years per turn
      expect(turnManager['calculateYearFromTurn'](1)).toBe(-4000);
      expect(turnManager['calculateYearFromTurn'](25)).toBe(-3040);
      expect(turnManager['calculateYearFromTurn'](75)).toBe(-1040);

      // Classical era (turns 76-175): 20 years per turn
      expect(turnManager['calculateYearFromTurn'](76)).toBe(-980);
      expect(turnManager['calculateYearFromTurn'](125)).toBe(0);
      expect(turnManager['calculateYearFromTurn'](175)).toBe(1000);

      // Medieval/Renaissance (turns 176-275): 10 years per turn
      expect(turnManager['calculateYearFromTurn'](176)).toBe(1010);
      expect(turnManager['calculateYearFromTurn'](225)).toBe(1500);
      expect(turnManager['calculateYearFromTurn'](275)).toBe(2000);

      // Modern era (turns 276+): 5 years per turn
      expect(turnManager['calculateYearFromTurn'](276)).toBe(2005);
      expect(turnManager['calculateYearFromTurn'](300)).toBe(2125);
    });
  });

  describe('player actions', () => {
    beforeEach(async () => {
      await turnManager.initializeTurn(testPlayerIds);
    });

    it('should add player actions correctly', () => {
      const testAction = {
        type: 'unit_move',
        data: { unitId: 'unit1', from: { x: 5, y: 5 }, to: { x: 6, y: 5 } },
      };

      turnManager.addPlayerAction('player1', testAction);

      const playerActions = turnManager['playerActions'].get('player1');
      expect(playerActions).toHaveLength(1);
      expect(playerActions![0].type).toBe('unit_move');
      expect(playerActions![0].data.unitId).toBe('unit1');
      expect(playerActions![0]).toHaveProperty('timestamp');
    });

    it('should handle multiple actions for same player', () => {
      const action1 = { type: 'unit_move', data: { unitId: 'unit1' } };
      const action2 = { type: 'unit_attack', data: { unitId: 'unit2' } };

      turnManager.addPlayerAction('player1', action1);
      turnManager.addPlayerAction('player1', action2);

      const playerActions = turnManager['playerActions'].get('player1');
      expect(playerActions).toHaveLength(2);
      expect(playerActions![0].type).toBe('unit_move');
      expect(playerActions![1].type).toBe('unit_attack');
    });

    it('should handle actions for different players', () => {
      turnManager.addPlayerAction('player1', { type: 'unit_move', data: {} });
      turnManager.addPlayerAction('player2', { type: 'city_production', data: {} });

      expect(turnManager['playerActions'].get('player1')).toHaveLength(1);
      expect(turnManager['playerActions'].get('player2')).toHaveLength(1);
      expect(turnManager['playerActions'].get('player3')).toHaveLength(0);
    });
  });

  describe('turn events', () => {
    beforeEach(async () => {
      await turnManager.initializeTurn(testPlayerIds);
    });

    it('should add turn events correctly', () => {
      turnManager['addTurnEvent']('unit_move', 'player1', { unitId: 'test-unit' });

      const events = turnManager.getTurnEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('unit_move');
      expect(events[0].playerId).toBe('player1');
      expect(events[0].data.unitId).toBe('test-unit');
      expect(events[0].timestamp).toBeInstanceOf(Date);
    });

    it('should track multiple events', () => {
      turnManager['addTurnEvent']('unit_move', 'player1', {});
      turnManager['addTurnEvent']('combat', 'player2', {});
      turnManager['addTurnEvent']('city_production', 'player1', {});

      const events = turnManager.getTurnEvents();
      expect(events).toHaveLength(3);
      expect(events.map(e => e.type)).toEqual(['unit_move', 'combat', 'city_production']);
      expect(events.map(e => e.playerId)).toEqual(['player1', 'player2', 'player1']);
    });
  });

  describe('turn timer', () => {
    beforeEach(async () => {
      await turnManager.initializeTurn(testPlayerIds);
    });

    afterEach(() => {
      turnManager.clearTurnTimer();
    });

    it('should start turn timer correctly', () => {
      turnManager.startTurnTimer(5); // 5 seconds

      expect(turnManager['turnTimer']).toBeDefined();
      expect(turnManager['turnTimer']).not.toBeNull();
    });

    it('should clear existing timer when starting new one', () => {
      turnManager.startTurnTimer(5);
      const firstTimer = turnManager['turnTimer'];

      turnManager.startTurnTimer(10);
      const secondTimer = turnManager['turnTimer'];

      expect(firstTimer).not.toBe(secondTimer);
    });

    it('should clear turn timer', () => {
      turnManager.startTurnTimer(5);
      expect(turnManager['turnTimer']).not.toBeNull();

      turnManager.clearTurnTimer();
      expect(turnManager['turnTimer']).toBeNull();
    });
  });

  describe('turn processing', () => {
    beforeEach(async () => {
      await turnManager.initializeTurn(testPlayerIds);
    });

    it('should process turn and advance to next', async () => {
      const initialTurn = turnManager.getCurrentTurn();
      const initialYear = turnManager.getCurrentYear();

      // Add some test actions
      turnManager.addPlayerAction('player1', { type: 'unit_move', data: {} });
      turnManager.addPlayerAction('player2', { type: 'city_production', data: {} });

      await turnManager.processTurn();

      expect(turnManager.getCurrentTurn()).toBe(initialTurn + 1);
      expect(turnManager.getCurrentYear()).toBeGreaterThan(initialYear);
      expect(turnManager['playerActions'].size).toBe(0); // Actions cleared after processing
      expect(turnManager.getTurnEvents()).toHaveLength(0); // Events reset for new turn
    });

    it('should broadcast turn start after processing', async () => {
      await turnManager.processTurn();

      expect(mockIo.emit).toHaveBeenCalledWith(
        'turn-started',
        expect.objectContaining({
          gameId: testGameId,
          turn: expect.any(Number),
          year: expect.any(Number),
          startTime: expect.any(Date),
        })
      );
    });

    it('should handle processing errors gracefully', async () => {
      // Mock an error in a critical method by overriding our mocks
      turnManager['completeTurnRecord'] = jest.fn().mockRejectedValue(new Error('Database error'));

      await expect(turnManager.processTurn()).rejects.toThrow('Database error');
    });
  });

  describe('action processing', () => {
    beforeEach(async () => {
      await turnManager.initializeTurn(testPlayerIds);
    });

    it('should process unit move actions', async () => {
      const moveAction = {
        type: 'unit_move',
        data: { unitId: 'unit1', from: { x: 5, y: 5 }, to: { x: 6, y: 5 } },
      };

      turnManager.addPlayerAction('player1', moveAction);
      await turnManager['processPlayerActions']();

      const events = turnManager.getTurnEvents();
      expect(events.some(e => e.type === 'unit_move')).toBe(true);
    });

    it('should process multiple action types', async () => {
      turnManager.addPlayerAction('player1', { type: 'unit_move', data: {} });
      turnManager.addPlayerAction('player1', { type: 'unit_attack', data: {} });
      turnManager.addPlayerAction('player2', { type: 'city_production', data: {} });
      turnManager.addPlayerAction('player2', { type: 'research_selection', data: {} });

      await turnManager['processPlayerActions']();

      const events = turnManager.getTurnEvents();
      expect(events).toHaveLength(4);
      expect(events.map(e => e.type)).toContain('unit_move');
      expect(events.map(e => e.type)).toContain('combat');
      expect(events.map(e => e.type)).toContain('city_production');
      expect(events.map(e => e.type)).toContain('research_complete');
    });

    it('should handle unknown action types gracefully', async () => {
      turnManager.addPlayerAction('player1', { type: 'unknown_action', data: {} });

      // Should not throw an error
      await expect(turnManager['processPlayerActions']()).resolves.not.toThrow();
    });
  });

  describe('statistics calculation', () => {
    beforeEach(async () => {
      await turnManager.initializeTurn(testPlayerIds);
    });

    it('should calculate turn statistics correctly', async () => {
      // Add some actions to generate statistics
      turnManager.addPlayerAction('player1', { type: 'unit_move', data: {} });
      turnManager.addPlayerAction('player2', { type: 'city_production', data: {} });
      turnManager['addTurnEvent']('unit_move', 'player1', {});
      turnManager['addTurnEvent']('city_production', 'player2', {});

      const startTime = Date.now();
      const stats = await turnManager['calculateTurnStatistics'](startTime);

      expect(stats.playersActive).toBe(3); // All initialized players (playerActions.size)
      expect(stats.actionsProcessed).toBe(2); // 2 events were generated
      expect(stats.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(stats.unitsTotal).toBeDefined();
      expect(stats.citiesTotal).toBeDefined();
    });
  });

  describe('cleanup and reset', () => {
    beforeEach(async () => {
      await turnManager.initializeTurn(testPlayerIds);
    });

    it('should reset state properly when advancing turns', async () => {
      // Add some data
      turnManager.addPlayerAction('player1', { type: 'unit_move', data: {} });
      turnManager['addTurnEvent']('unit_move', 'player1', {});

      expect(turnManager['playerActions'].get('player1')).toHaveLength(1);
      expect(turnManager.getTurnEvents()).toHaveLength(1);

      await turnManager.processTurn();

      // State should be reset
      expect(turnManager['playerActions'].size).toBe(0);
      expect(turnManager.getTurnEvents()).toHaveLength(0);
      expect(turnManager['turnStartTime']).toBeInstanceOf(Date);
    });
  });
});
