import { GameManagementHandler } from '@network/handlers/GameManagementHandler';
import { PacketHandler } from '@network/PacketHandler';
import { GameCreateSchema, GameJoinSchema, PacketType, PROTOCOL_VERSION } from '@app-types/packet';
import { GameManager } from '@game/managers/GameManager';
import { Server, Socket } from 'socket.io';
import { ScenarioUnavailableError } from '@game/map/ScenarioProvider';

// Mock dependencies
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('GameManagementHandler', () => {
  let handler: GameManagementHandler;
  let mockPacketHandler: jest.Mocked<PacketHandler>;
  let mockSocket: jest.Mocked<Socket>;
  let mockIo: jest.Mocked<Server>;
  let mockGameManager: jest.Mocked<GameManager>;
  let activeConnections: Map<string, any>;

  const mockSocketId = 'test-socket-id';
  const mockUserId = 'test-user-id';
  const mockUsername = 'testuser';
  const mockGameId = 'test-game-id';
  const mockPlayerId = 'test-player-id';

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create active connections map
    activeConnections = new Map();

    // Mock GameManager
    mockGameManager = {
      createGame: jest.fn(),
      joinGame: jest.fn(),
      startGame: jest.fn(),
      getGame: jest.fn(),
      getGameListForLobby: jest.fn(),
      deleteGame: jest.fn(),
      updatePlayerConnection: jest.fn(),
      getPlayerById: jest.fn(),
      getGameInstance: jest.fn(),
      recoverGameInstance: jest.fn(),
      getAdvisorRecommendations: jest.fn(),
    } as any;

    // Create handler
    handler = new GameManagementHandler(activeConnections, mockGameManager);

    // Mock PacketHandler
    mockPacketHandler = {
      register: jest.fn(),
      send: jest.fn(),
      process: jest.fn(),
      broadcast: jest.fn(),
      cleanup: jest.fn(),
    } as any;

    // Mock Socket
    mockSocket = {
      id: mockSocketId,
      on: jest.fn(),
      join: jest.fn(),
      emit: jest.fn(),
      data: {},
    } as any;

    // Mock Server
    mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as any;
  });

  describe('register', () => {
    it('should register all game management packet handlers', () => {
      handler.register(mockPacketHandler, mockIo, mockSocket);

      expect(mockPacketHandler.register).toHaveBeenCalledWith(
        PacketType.GAME_LIST,
        expect.any(Function)
      );
      expect(mockPacketHandler.register).toHaveBeenCalledWith(
        PacketType.GAME_CREATE,
        expect.any(Function),
        GameCreateSchema
      );
      expect(mockPacketHandler.register).toHaveBeenCalledWith(
        PacketType.GAME_JOIN,
        expect.any(Function),
        GameJoinSchema
      );
      expect(mockPacketHandler.register).toHaveBeenCalledWith(
        PacketType.GAME_START,
        expect.any(Function)
      );

      expect(mockSocket.on).toHaveBeenCalledWith('join_game', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('observe_game', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('get_game_list', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('delete_game', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith(
        'advisor:getRecommendations',
        expect.any(Function)
      );
    });
  });

  describe('snapshot player formatting', () => {
    it('preserves an authoritative persisted score during recovery', () => {
      const snapshotPlayer = (handler as any).formatSnapshotPlayer({
        id: mockPlayerId,
        civilization: 'Romans',
        color: { r: 180, g: 40, b: 40 },
        score: 275,
      });

      expect(snapshotPlayer).toEqual(
        expect.objectContaining({
          id: mockPlayerId,
          score: 275,
        })
      );
    });

    it('defaults score when older player state has no score field', () => {
      const snapshotPlayer = (handler as any).formatSnapshotPlayer({
        id: mockPlayerId,
        civilization: 'Romans',
        color: { r: 180, g: 40, b: 40 },
      });

      expect(snapshotPlayer.score).toBe(0);
    });
  });

  describe('advisor recommendations event', () => {
    it('returns read-only advice to the active human player', async () => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
      activeConnections.set(mockSocketId, {
        userId: mockUserId,
        gameId: mockGameId,
        role: 'player',
      });
      const recommendations = { playerId: mockPlayerId, turn: 4 };
      mockGameManager.getAdvisorRecommendations.mockResolvedValue(recommendations as any);
      const callback = jest.fn();
      const eventHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'advisor:getRecommendations'
      )![1];

      await eventHandler({}, callback);

      expect(mockGameManager.getAdvisorRecommendations).toHaveBeenCalledWith(
        mockGameId,
        mockUserId
      );
      expect(callback).toHaveBeenCalledWith({ success: true, recommendations });
    });
  });

  describe('GAME_LIST handler', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
      activeConnections.set(mockSocketId, { userId: mockUserId, username: mockUsername });
    });

    it('should fetch and emit game list', async () => {
      const mockGames = [
        {
          id: mockGameId,
          name: 'Test Game',
          status: 'waiting',
          currentPlayers: 1,
          maxPlayers: 2,
          currentTurn: 1,
          mapSize: 'small',
        },
      ];

      mockGameManager.getGameListForLobby.mockResolvedValue(mockGames as any);

      // Get the registered handler function for GAME_LIST
      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_LIST
      )[1];

      await handlerFn(mockSocket);

      expect(mockGameManager.getGameListForLobby).toHaveBeenCalledWith(mockUserId);
      expect(mockSocket.emit).toHaveBeenCalledWith('packet', {
        type: PacketType.GAME_LIST,
        version: PROTOCOL_VERSION,
        data: {
          games: expect.arrayContaining([
            expect.objectContaining({
              gameId: mockGameId,
              name: 'Test Game',
              status: 'waiting',
            }),
          ]),
        },
      });
    });
  });

  describe('GAME_CREATE handler', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
      activeConnections.set(mockSocketId, { userId: mockUserId, username: mockUsername });
    });

    it('should create game successfully for authenticated user', async () => {
      const gameData = {
        name: 'New Game',
        maxPlayers: 4,
        mapWidth: 50,
        mapHeight: 50,
        selectedNation: 'romans',
        aiLevel: 'hard',
      };

      mockGameManager.createGame.mockResolvedValue(mockGameId);
      mockGameManager.joinGame.mockResolvedValue({
        playerId: mockPlayerId,
        assignedNation: 'romans',
        assignedColor: { r: 255, g: 0, b: 0 },
      });
      mockGameManager.getPlayerById.mockResolvedValue({ nation: 'romans' });

      // Get the registered handler function for GAME_CREATE
      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_CREATE
      )[1];

      await handlerFn(mockSocket, gameData);

      expect(mockGameManager.createGame).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Game',
          hostId: mockUserId,
          maxPlayers: 4,
          aiLevel: 'hard',
        })
      );

      expect(mockSocket.join).toHaveBeenCalledWith(`game:${mockGameId}`);
      expect(mockGameManager.joinGame).toHaveBeenCalledWith(mockGameId, mockUserId, 'romans');

      expect(mockPacketHandler.send).toHaveBeenCalledWith(
        mockSocket,
        PacketType.GAME_CREATE_REPLY,
        {
          success: true,
          gameId: mockGameId,
          maxPlayers: 4,
          playerId: mockPlayerId,
          message: 'Game created successfully',
          assignedNation: 'romans',
          assignedColor: { r: 255, g: 0, b: 0 },
        }
      );
    });

    it('should reject unauthenticated user', async () => {
      // Remove authentication
      activeConnections.set(mockSocketId, {});

      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_CREATE
      )[1];

      await handlerFn(mockSocket, {});

      expect(mockPacketHandler.send).toHaveBeenCalledWith(
        mockSocket,
        PacketType.GAME_CREATE_REPLY,
        {
          success: false,
          message: 'Not authenticated',
        }
      );
    });

    it('should handle game creation error', async () => {
      mockGameManager.createGame.mockRejectedValue(new Error('Game creation failed'));

      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_CREATE
      )[1];

      await handlerFn(mockSocket, { name: 'Test Game' });

      expect(mockPacketHandler.send).toHaveBeenCalledWith(
        mockSocket,
        PacketType.GAME_CREATE_REPLY,
        {
          success: false,
          message: 'Game creation failed',
        }
      );
    });

    it('returns a stable error code when scenario creation is disabled', async () => {
      mockGameManager.createGame.mockRejectedValue(new ScenarioUnavailableError());

      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_CREATE
      )[1];

      await handlerFn(mockSocket, {
        name: 'Deferred Scenario',
        terrainSettings: {
          generator: 'scenario',
          scenarioId: 'earth-small',
        },
      });

      expect(mockGameManager.joinGame).not.toHaveBeenCalled();
      expect(mockPacketHandler.send).toHaveBeenCalledWith(
        mockSocket,
        PacketType.GAME_CREATE_REPLY,
        expect.objectContaining({
          success: false,
          errorCode: 'SCENARIOS_NOT_ENABLED',
          message: 'Scenario games are not enabled in this release',
        })
      );
    });
  });

  describe('GAME_JOIN handler', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
      activeConnections.set(mockSocketId, { userId: mockUserId, username: mockUsername });
    });

    it('should join game successfully', async () => {
      const joinData = { gameId: mockGameId, civilization: 'greeks' };
      mockGameManager.joinGame.mockResolvedValue({
        playerId: mockPlayerId,
        assignedNation: 'greeks',
        assignedColor: { r: 0, g: 255, b: 0 },
      });

      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_JOIN
      )[1];

      await handlerFn(mockSocket, joinData);

      expect(mockGameManager.joinGame).toHaveBeenCalledWith(mockGameId, mockUserId, 'greeks');
      expect(mockSocket.join).toHaveBeenCalledWith(`game:${mockGameId}`);
      expect(mockGameManager.updatePlayerConnection).toHaveBeenCalledWith(mockPlayerId, true);

      expect(mockPacketHandler.send).toHaveBeenCalledWith(mockSocket, PacketType.GAME_JOIN_REPLY, {
        success: true,
        playerId: mockPlayerId,
        message: 'Joined game successfully',
      });
    });
  });

  describe('join_game socket event', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
      activeConnections.set(mockSocketId, { userId: mockUserId, username: mockUsername });
    });

    it('should handle join_game event successfully', async () => {
      mockGameManager.joinGame.mockResolvedValue({
        playerId: mockPlayerId,
        assignedNation: 'romans',
        assignedColor: { r: 255, g: 0, b: 0 },
      });
      mockGameManager.getPlayerById.mockResolvedValue({ nation: 'random' });
      (mockGameManager.getGameInstance as jest.Mock).mockReturnValue({
        mapManager: {
          getMapData: () => ({
            width: 2,
            height: 2,
            tiles: [
              [{ terrain: 'grassland' }, { terrain: 'plains' }],
              [{ terrain: 'ocean' }, { terrain: 'forest' }],
            ],
          }),
        },
        unitManager: {
          getVisibleUnits: () => [
            {
              id: 'unit-1',
              playerId: mockPlayerId,
              unitTypeId: 'warriors',
              x: 0,
              y: 0,
              health: 100,
              movementLeft: 1,
              veteranLevel: 0,
            },
          ],
        },
        visibilityManager: {
          updatePlayerVisibility: jest.fn(),
          getVisibleTiles: () => new Set(['0,0']),
          getExploredTiles: () => new Set(['0,0', '1,0']),
        },
        cityManager: { getAllCities: () => [] },
        borderManager: {
          getAllTileOwnership: () => [
            { x: 0, y: 0, playerId: mockPlayerId, strength: 1 },
            { x: 1, y: 0, playerId: 'visible-rival', strength: 1 },
            { x: 1, y: 1, playerId: 'hidden-rival', strength: 1 },
          ],
        },
      });

      // Get the join_game event handler
      const eventHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'join_game'
      )[1];

      const mockCallback = jest.fn();
      await eventHandler({ gameId: mockGameId }, mockCallback);

      expect(mockGameManager.joinGame).toHaveBeenCalledWith(mockGameId, mockUserId, 'random');
      expect(mockCallback).toHaveBeenCalledWith({
        success: true,
        playerId: mockPlayerId,
        assignedNation: 'romans',
        assignedColor: { r: 255, g: 0, b: 0 },
      });
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'packet',
        expect.objectContaining({
          type: PacketType.MAP_INFO,
          data: expect.objectContaining({ xsize: 2, ysize: 2 }),
        })
      );
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'packet',
        expect.objectContaining({
          type: PacketType.TILE_INFO,
          data: expect.objectContaining({ total: 4 }),
        })
      );
      const tilePacket = (mockSocket.emit as jest.Mock).mock.calls.find(
        ([event, packet]) => event === 'packet' && packet.type === PacketType.TILE_INFO
      )[1];
      expect(tilePacket.data.tiles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ x: 0, y: 0, known: 2, seen: 1 }),
          expect.objectContaining({ x: 1, y: 0, known: 1, seen: 0 }),
          expect.objectContaining({ x: 0, y: 1, terrain: 'unknown', known: 0, seen: 0 }),
        ])
      );
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'packet',
        expect.objectContaining({
          type: PacketType.UNIT_INFO,
          data: expect.objectContaining({ units: [expect.objectContaining({ id: 'unit-1' })] }),
        })
      );
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'cities_updated',
        expect.objectContaining({ gameId: mockGameId, cities: {} })
      );
      const borderPacket = (mockSocket.emit as jest.Mock).mock.calls.find(
        ([event, packet]) => event === 'packet' && packet.type === PacketType.BORDER_UPDATE
      )[1];
      expect(borderPacket.data.tiles).toEqual([
        { x: 0, y: 0, owner: mockPlayerId, strength: 1 },
        { x: 1, y: 0, owner: 'visible-rival', strength: 1 },
      ]);
    });

    it('should handle authentication error', async () => {
      activeConnections.set(mockSocketId, {}); // No userId

      const eventHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'join_game'
      )[1];

      const mockCallback = jest.fn();
      await eventHandler({ gameId: mockGameId }, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith({
        success: false,
        error: 'Not authenticated',
      });
    });

    it('rejects malformed join events before invoking game services', async () => {
      const eventHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'join_game'
      )[1];
      const mockCallback = jest.fn();

      await eventHandler({ gameId: '' }, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid join game request',
      });
      expect(mockGameManager.joinGame).not.toHaveBeenCalled();
    });

    it('should reject an active-game join when snapshot recovery fails', async () => {
      mockGameManager.joinGame.mockResolvedValue({
        playerId: mockPlayerId,
        assignedNation: 'romans',
        assignedColor: { r: 255, g: 0, b: 0 },
      });
      mockGameManager.getGame.mockResolvedValue({ status: 'active' } as any);
      mockGameManager.getGameInstance.mockReturnValue(null);
      mockGameManager.recoverGameInstance.mockResolvedValue(null);

      const eventHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'join_game'
      )[1];
      const mockCallback = jest.fn();

      await eventHandler({ gameId: mockGameId }, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith({
        success: false,
        error: 'Unable to recover active game',
      });
      expect(mockCallback).not.toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('get_game_list socket event', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
    });

    it('should return game list', async () => {
      const mockGames = [{ id: mockGameId, name: 'Test Game' }];
      mockGameManager.getGameListForLobby.mockResolvedValue(mockGames as any);
      activeConnections.set(mockSocketId, { userId: mockUserId, username: mockUsername });

      const eventHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'get_game_list'
      )[1];

      const mockCallback = jest.fn();
      await eventHandler(mockCallback);

      expect(mockGameManager.getGameListForLobby).toHaveBeenCalledWith(mockUserId);
      expect(mockCallback).toHaveBeenCalledWith({
        success: true,
        games: mockGames,
      });
    });
  });

  describe('observe_game socket event', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
      activeConnections.set(mockSocketId, { userId: mockUserId, username: mockUsername });
    });

    it('sends a complete observer snapshot before acknowledging readiness', async () => {
      mockGameManager.getGame.mockResolvedValue({ id: mockGameId, status: 'active' } as any);
      mockGameManager.getGameInstance.mockReturnValue({
        mapManager: {
          getMapData: () => ({
            width: 1,
            height: 1,
            tiles: [[{ terrain: 'grassland' }]],
          }),
        },
        unitManager: {
          getAllUnits: () =>
            new Map([
              [
                'unit-1',
                {
                  id: 'unit-1',
                  playerId: mockPlayerId,
                  unitTypeId: 'warriors',
                  x: 0,
                  y: 0,
                  health: 100,
                  movementLeft: 1,
                  veteranLevel: 0,
                },
              ],
            ]),
        },
        visibilityManager: {
          updatePlayerVisibility: jest.fn(),
          getVisibleTiles: jest.fn(),
          getExploredTiles: jest.fn(),
        },
        cityManager: { getAllCities: () => [] },
        borderManager: { getAllTileOwnership: () => [] },
      } as any);

      const eventHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'observe_game'
      )[1];
      const mockCallback = jest.fn();

      await eventHandler({ gameId: mockGameId }, mockCallback);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'packet',
        expect.objectContaining({
          type: PacketType.TILE_INFO,
          data: expect.objectContaining({
            tiles: [expect.objectContaining({ terrain: 'grassland', known: 2, seen: 1 })],
          }),
        })
      );
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'packet',
        expect.objectContaining({
          type: PacketType.UNIT_INFO,
          data: expect.objectContaining({ fullSnapshot: true }),
        })
      );
      expect(mockCallback).toHaveBeenCalledWith({ success: true, role: 'spectator' });

      const lastSnapshotEmission = (mockSocket.emit as jest.Mock).mock.calls
        .map(([event, packet], index) => ({ event, packet, index }))
        .filter(({ event }) => event === 'packet')
        .at(-1)?.index;
      const callbackOrder = mockCallback.mock.invocationCallOrder[0];
      const lastEmissionOrder =
        lastSnapshotEmission === undefined
          ? undefined
          : (mockSocket.emit as jest.Mock).mock.invocationCallOrder[lastSnapshotEmission];
      expect(lastEmissionOrder).toBeLessThan(callbackOrder);
    });
  });

  describe('utility methods', () => {
    it('should return handled packet types', () => {
      const types = handler.getHandledPacketTypes();
      expect(types).toContain(PacketType.GAME_CREATE);
      expect(types).toContain(PacketType.GAME_JOIN);
      expect(types).toContain(PacketType.GAME_LIST);
      expect(types).toContain(PacketType.GAME_START);
    });

    it('should return handler name', () => {
      expect(handler.getName()).toBe('GameManagementHandler');
    });
  });
});
