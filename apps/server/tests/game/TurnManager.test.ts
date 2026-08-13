import { TurnManager } from '@game/managers/TurnManager';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

// Mock all turn services
jest.mock('@game/services/TurnPacketService', () => {
  return {
    TurnPacketService: jest.fn().mockImplementation(() => ({
      sendNewYearPacket: jest.fn(),
      sendBeginTurnPacket: jest.fn(),
      sendEndTurnPacket: jest.fn(),
      sendTurnStartSequence: jest.fn(),
      sendTurnProcessingStep: jest.fn(),
    })),
  };
});

jest.mock('@game/services/TurnProcessingService', () => {
  return {
    TurnProcessingService: jest.fn().mockImplementation(() => ({
      initializeActionQueues: jest.fn(),
      queuePlayerAction: jest.fn(),
    })),
  };
});

jest.mock('@game/services/TurnCoordinationService', () => {
  return {
    TurnCoordinationService: jest.fn().mockImplementation(() => ({})),
  };
});

jest.mock('@game/services/TurnPhaseService', () => {
  return {
    TurnPhaseService: jest.fn().mockImplementation(() => ({
      executePhaseProcessing: jest.fn(),
      getCurrentPhase: jest.fn(),
      getPhaseHistory: jest.fn(),
      setCurrentTurnId: jest.fn(),
    })),
  };
});

// Mock managers
const mockUnitManager = {
  getAllUnits: jest.fn().mockResolvedValue([]),
  moveUnit: jest.fn(),
  activateUnit: jest.fn(),
} as any;

const mockCityManager = {
  getAllCities: jest.fn().mockResolvedValue([]),
  getPlayerCities: jest.fn().mockReturnValue([]),
  refreshCityWithGovernmentEffects: jest.fn(),
  processProduction: jest.fn(),
  updateCityState: jest.fn(),
} as any;

const mockResearchManager = {
  processPlayerResearch: jest.fn(),
  completeResearch: jest.fn(),
  getPlayerResearch: jest.fn(),
} as any;

const mockBorderManager = {
  updateBorders: jest.fn(),
  calculateBorders: jest.fn(),
} as any;

const mockVisibilityManager = {
  updateVisibility: jest.fn(),
  calculateVisibility: jest.fn(),
} as any;

const mockCultureManager = {
  calculateCityCulture: jest.fn(),
  calculateCityHistoryGain: jest.fn(),
  calculatePlayerCulture: jest
    .fn()
    .mockResolvedValue({ totalCulture: 0, nationalHistory: 0, nationalHistoryGain: 0 }),
  calculateNationHistoryGain: jest.fn(),
  processCultureGain: jest.fn().mockResolvedValue(undefined),
  getPlayerCultureInfo: jest
    .fn()
    .mockResolvedValue({ totalCulture: 0, nationalHistory: 0, cityCulture: 0 }),
  getCityCultureInfo: jest.fn(),
} as any;

// Mock Socket.IO - create proper chainable mock
const mockEmit = jest.fn();
const mockRoom = {
  emit: mockEmit,
};
const mockIo = {
  emit: jest.fn(),
  to: jest.fn().mockReturnValue(mockRoom),
} as any;

describe('TurnManager', () => {
  let turnManager: TurnManager;
  let mockDatabase: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmit.mockClear();
    mockDatabase = createMockDatabaseProvider();

    const mockBroadcastManager = {
      broadcastToGame: jest.fn(),
      broadcastToPlayer: jest.fn(),
      broadcastToAllPlayers: jest.fn(),
      broadcastCityData: jest.fn(),
      broadcastVisibilityDelta: jest.fn(),
      broadcastVisibilityState: jest.fn(),
    } as any;

    turnManager = new TurnManager(
      'test-game-id',
      mockDatabase,
      mockIo,
      mockUnitManager,
      mockCityManager,
      mockResearchManager,
      mockBorderManager,
      mockVisibilityManager,
      mockCultureManager,
      mockBroadcastManager
    );
  });

  describe('initialization', () => {
    it('should initialize turn system with correct default values', async () => {
      const playerIds = ['player1', 'player2'];

      await turnManager.initializeTurn(playerIds);

      expect(turnManager.getCurrentTurn()).toBe(1);
      expect(turnManager.getCurrentYear()).toBe(-4000);
      expect(mockDatabase.getDatabase().insert).toHaveBeenCalled();
      expect(mockIo.emit).toHaveBeenCalledWith('turn-started', expect.any(Object));
    });

    it('should create initial turn record in database', async () => {
      const playerIds = ['player1'];

      await turnManager.initializeTurn(playerIds);

      expect(mockDatabase.getDatabase().insert).toHaveBeenCalledWith(
        expect.anything() // gameTurns schema
      );
    });

    it('initializes a scenario at its configured turn and year', async () => {
      await turnManager.initializeTurn(['player1'], {
        currentTurn: 12,
        currentYear: -3989,
      });

      expect(turnManager.getCurrentTurn()).toBe(12);
      expect(turnManager.getCurrentYear()).toBe(-3989);
    });
  });

  describe('player actions', () => {
    beforeEach(async () => {
      await turnManager.initializeTurn(['player1', 'player2']);
    });

    it('should persist player actions before queueing them', async () => {
      const action = {
        type: 'unit_move',
        data: { unitId: 'unit1', x: 5, y: 5 },
        priority: 3,
      };

      await turnManager.addPlayerAction('player1', action);

      expect(mockDatabase.getDatabase().insert).toHaveBeenCalledWith(expect.anything());
      expect((turnManager as any).turnProcessingService.queuePlayerAction).toHaveBeenCalledWith(
        expect.objectContaining({
          playerId: 'player1',
          type: 'unit_move',
          priority: 3,
        })
      );
    });

    it('should handle actions for new players', async () => {
      const action = {
        type: 'city_build',
        data: { cityId: 'city1', buildingId: 'granary' },
      };

      // Should not throw error even if player wasn't in initial list
      await expect(turnManager.addPlayerAction('player3', action)).resolves.toEqual(
        expect.stringMatching(/^action_/)
      );
    });

    it('does not queue a retried durable action twice', async () => {
      const queuePlayerAction = (turnManager as any).turnProcessingService
        .queuePlayerAction as jest.Mock;
      queuePlayerAction.mockClear();
      mockDatabase.getDatabase().returning.mockResolvedValueOnce([]);

      await expect(
        turnManager.addPlayerAction('player1', {
          id: 'stable-request-id',
          type: 'unit_move',
          data: { unitId: 'unit1', x: 5, y: 5 },
        })
      ).resolves.toBe('stable-request-id');

      expect(queuePlayerAction).not.toHaveBeenCalled();
    });
  });

  describe('turn processing', () => {
    beforeEach(async () => {
      await turnManager.initializeTurn(['player1', 'player2']);
    });

    it('should process turn through TurnPhaseService', async () => {
      // Mock successful phase processing
      const mockTurnPhaseService = (turnManager as any).turnPhaseService;
      mockTurnPhaseService.executePhaseProcessing = jest.fn().mockResolvedValue({
        success: true,
        totalDuration: 100,
        phases: [
          { phase: 'player_actions', success: true, duration: 20 },
          { phase: 'city_production', success: true, duration: 30 },
        ],
        errors: [],
      });

      await turnManager.processTurn();

      expect(mockTurnPhaseService.executePhaseProcessing).toHaveBeenCalledWith(
        1, // current turn
        -4000, // current year
        ['player1', 'player2'] // player IDs
      );
      expect((turnManager as any).broadcastManager.broadcastVisibilityDelta).toHaveBeenCalledWith(
        'test-game-id'
      );
      expect((turnManager as any).broadcastManager.broadcastVisibilityState).not.toHaveBeenCalled();
      expect((turnManager as any).broadcastManager.broadcastCityData).not.toHaveBeenCalled();

      // Should advance to next turn
      expect(turnManager.getCurrentTurn()).toBe(2);
    });

    it('awaits asynchronous replay snapshot enrichment before persisting a checkpoint', async () => {
      const mockTurnPhaseService = (turnManager as any).turnPhaseService;
      mockTurnPhaseService.executePhaseProcessing = jest.fn().mockResolvedValue({
        success: true,
        totalDuration: 100,
        phases: [],
        errors: [],
      });
      turnManager.setReplaySnapshotProvider(async () => ({
        diplomacy: { players: [{ playerId: 'player1', relations: [] }] },
      }));

      await turnManager.processTurn();

      expect(mockDatabase.getDatabase().set).toHaveBeenCalledWith(
        expect.objectContaining({
          stateSnapshot: expect.objectContaining({
            diplomacy: { players: [{ playerId: 'player1', relations: [] }] },
          }),
        })
      );
    });

    it('processes climate during a completed turn and refreshes changed map state', async () => {
      const pollutedTile = {
        x: 1,
        y: 1,
        terrain: 'grassland',
        improvements: ['pollution'],
      };
      mockUnitManager.getMapManager = jest.fn(() => ({
        getMapData: () => ({ width: 1, height: 1, tiles: [[pollutedTile]] }),
        updateTileProperty: jest.fn(),
      }));
      mockVisibilityManager.updateAllPlayersVisibility = jest.fn();
      mockDatabase.getDatabase().query.games.findFirst.mockResolvedValue({
        gameState: { climate: { warmingPressure: 99 } },
      });
      const broadcastMapData = jest.fn();
      const manager = new TurnManager(
        'test-game-id',
        mockDatabase,
        mockIo,
        mockUnitManager,
        mockCityManager,
        mockResearchManager,
        mockBorderManager,
        mockVisibilityManager,
        mockCultureManager,
        { ...({ broadcastCityData: jest.fn(), broadcastMapData } as any) },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { warmingThreshold: 1 }
      );
      await manager.initializeTurn(['player1']);
      (manager as any).turnPhaseService.executePhaseProcessing = jest.fn().mockResolvedValue({
        success: true,
        totalDuration: 1,
        phases: [],
        errors: [],
      });

      await manager.processTurn();

      expect(pollutedTile.terrain).toBe('swamp');
      expect(broadcastMapData).toHaveBeenCalledWith('test-game-id', expect.any(Object));
      expect(mockVisibilityManager.updateAllPlayersVisibility).toHaveBeenCalledWith(['player1']);
    });

    it('rejects concurrent processing when another server owns the turn lease', async () => {
      mockDatabase.getDatabase().returning.mockResolvedValueOnce([]);

      await expect(turnManager.processTurn()).rejects.toThrow('Turn 1 is already being processed');
      expect((turnManager as any).turnPhaseService.executePhaseProcessing).not.toHaveBeenCalled();
    });

    it('should handle turn processing failures', async () => {
      const mockTurnPhaseService = (turnManager as any).turnPhaseService;
      mockTurnPhaseService.executePhaseProcessing = jest.fn().mockResolvedValue({
        success: false,
        totalDuration: 50,
        phases: [{ phase: 'player_actions', success: false, duration: 20 }],
        errors: ['Failed to process player actions'],
      });

      await expect(turnManager.processTurn()).rejects.toThrow('Turn processing failed');

      // Should not advance turn on failure
      expect(turnManager.getCurrentTurn()).toBe(1);
    });

    it('coalesces concurrent turn processing requests', async () => {
      const mockTurnPhaseService = (turnManager as any).turnPhaseService;
      let resolvePhase!: (value: any) => void;
      mockTurnPhaseService.executePhaseProcessing = jest.fn(
        () => new Promise(resolve => (resolvePhase = resolve))
      );

      const first = turnManager.processTurn();
      const duplicate = turnManager.processTurn();
      await new Promise(resolve => setImmediate(resolve));
      resolvePhase({ success: true, totalDuration: 1, phases: [], errors: [] });
      await Promise.all([first, duplicate]);

      expect(mockTurnPhaseService.executePhaseProcessing).toHaveBeenCalledTimes(1);
      expect(turnManager.getCurrentTurn()).toBe(2);
    });

    it('soaks 100 sequential eight-participant turns without state drift', async () => {
      const releasePlayerIds = Array.from({ length: 8 }, (_, index) => `player${index + 1}`);
      await turnManager.initializeTurn(releasePlayerIds, {
        currentTurn: 1,
        createTurnRecord: false,
        broadcastTurnStart: false,
      });
      const mockTurnPhaseService = (turnManager as any).turnPhaseService;
      mockTurnPhaseService.executePhaseProcessing = jest.fn().mockResolvedValue({
        success: true,
        totalDuration: 1,
        phases: [{ phase: 'save_advance', success: true, itemsProcessed: 1 }],
        errors: [],
      });

      for (let turn = 0; turn < 100; turn += 1) {
        await turnManager.processTurn();
      }

      expect(turnManager.getCurrentTurn()).toBe(101);
      expect(mockTurnPhaseService.executePhaseProcessing).toHaveBeenCalledTimes(100);
      expect(mockTurnPhaseService.executePhaseProcessing).toHaveBeenLastCalledWith(
        100,
        expect.any(Number),
        releasePlayerIds
      );
      expect(mockDatabase.getDatabase().update).toHaveBeenCalled();
    });

    it('completes the audit record and stops advancing when the game ends', async () => {
      const mockTurnPhaseService = (turnManager as any).turnPhaseService;
      mockTurnPhaseService.executePhaseProcessing = jest.fn().mockResolvedValue({
        success: true,
        totalDuration: 1500,
        phases: [{ phase: 'end_turn', success: true, itemsProcessed: 1 }],
        errors: [],
      });
      const evaluator = jest.fn().mockResolvedValue(true);
      turnManager.setEndGameEvaluator(evaluator);

      await turnManager.processTurn();

      expect(evaluator).toHaveBeenCalledWith(1, -4000);
      expect(mockDatabase.getDatabase().update).toHaveBeenCalled();
      expect(mockDatabase.getDatabase().set).toHaveBeenCalledWith(
        expect.objectContaining({
          endedAt: expect.any(Date),
          duration: 2,
          stateSnapshot: expect.objectContaining({ version: 2, turn: 1, year: -4000 }),
        })
      );
      expect(turnManager.getCurrentTurn()).toBe(1);
    });

    it('advances revolutions and refreshes city effects when one completes', async () => {
      const governmentManager = {
        processRevolutionTurn: jest.fn().mockResolvedValue('monarchy'),
      };
      const manager = new TurnManager(
        'test-game-id',
        mockDatabase,
        mockIo,
        mockUnitManager,
        mockCityManager,
        mockResearchManager,
        mockBorderManager,
        mockVisibilityManager,
        mockCultureManager,
        {
          broadcastCityData: jest.fn(),
        } as any,
        undefined,
        governmentManager as any
      );
      await manager.initializeTurn(['player1']);
      (manager as any).turnPhaseService.executePhaseProcessing = jest.fn().mockResolvedValue({
        success: true,
        totalDuration: 1,
        phases: [],
        errors: [],
      });
      mockCityManager.getPlayerCities.mockReturnValue([{ id: 'city-1' }]);

      await manager.processTurn();

      expect(governmentManager.processRevolutionTurn).toHaveBeenCalledWith('player1');
      expect(mockCityManager.refreshCityWithGovernmentEffects).toHaveBeenCalledWith('city-1');
    });
  });

  describe('phase tracking', () => {
    beforeEach(async () => {
      await turnManager.initializeTurn(['player1']);
    });

    it('should delegate phase tracking to TurnPhaseService', () => {
      const mockTurnPhaseService = (turnManager as any).turnPhaseService;
      mockTurnPhaseService.getCurrentPhase = jest.fn().mockReturnValue('player_actions');
      mockTurnPhaseService.getPhaseHistory = jest
        .fn()
        .mockReturnValue([{ phase: 'player_actions', completed: true }]);

      expect(turnManager.getCurrentPhase()).toBe('player_actions');
      expect(turnManager.getPhaseHistory()).toEqual([{ phase: 'player_actions', completed: true }]);

      expect(mockTurnPhaseService.getCurrentPhase).toHaveBeenCalled();
      expect(mockTurnPhaseService.getPhaseHistory).toHaveBeenCalled();
    });
  });

  describe('turn timer', () => {
    beforeEach(async () => {
      await turnManager.initializeTurn(['player1']);
    });

    it('should start turn timer', () => {
      jest.useFakeTimers();
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      turnManager.startTurnTimer(60); // 60 seconds

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 60000);

      setTimeoutSpy.mockRestore();
      jest.useRealTimers();
    });

    it('should clear existing timer when starting new one', () => {
      jest.useFakeTimers();
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      turnManager.startTurnTimer(30);
      turnManager.startTurnTimer(60);

      // clearTimeout should be called when starting second timer
      expect(clearTimeoutSpy).toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
      jest.useRealTimers();
    });

    it('should clear turn timer', () => {
      jest.useFakeTimers();
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      turnManager.startTurnTimer(60);
      turnManager.clearTurnTimer();

      expect(clearTimeoutSpy).toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
      jest.useRealTimers();
    });

    it('restores the persisted remaining time instead of resetting the deadline', () => {
      jest.useFakeTimers();
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const deadline = new Date(Date.now() + 42_000);

      turnManager.restoreTurnTimer(deadline, null, 300);

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 42000);
      expect(turnManager.getRemainingTurnSeconds()).toBe(42);
      jest.useRealTimers();
    });
  });

  describe('year calculation', () => {
    it('should calculate years correctly for different turn ranges', () => {
      expect(turnManager.getCurrentYear()).toBe(-4000); // Turn 1
    });
  });

  describe('getters', () => {
    beforeEach(async () => {
      await turnManager.initializeTurn(['player1']);
    });

    it('should return current turn', () => {
      expect(turnManager.getCurrentTurn()).toBe(1);
    });

    it('should return current year', () => {
      expect(turnManager.getCurrentYear()).toBe(-4000);
    });

    it('should return turn events', () => {
      const events = turnManager.getTurnEvents();
      expect(Array.isArray(events)).toBe(true);
    });
  });
});
