import { GameManager } from '@game/managers/GameManager';
import {
  generateTestUUID,
  getTestDatabase,
  clearAllTables,
  getTestDatabaseProvider,
} from '../utils/testDatabase';
import * as schema from '@database/schema';
import { eq } from 'drizzle-orm';
import { createMockSocketServer } from '../utils/gameTestUtils';
import { assertAIState } from '@game/ai/AIStateStore';
import { ActionType } from '@app-types/shared/actions';

// Integration test to verify full game flow
describe('Game Integration Flow', () => {
  let gameManager: GameManager;

  beforeAll(async () => {
    // Setup test database
    // TODO: Fix database setup for integration tests
    // await setupTestDatabase();
  });

  afterAll(async () => {
    // Cleanup test database
    // await cleanupTestDatabase();
  });

  beforeEach(async () => {
    // Clear database before each test FIRST
    await clearAllTables();

    // Reset GameManager singleton
    (GameManager as any).instance = null;

    // Create mock socket server for integration tests
    const mockIo = createMockSocketServer();
    const testDbProvider = getTestDatabaseProvider();
    gameManager = GameManager.getInstance(mockIo, testDbProvider);
  });

  afterEach(() => {
    gameManager?.clearAllGames();
  });

  describe('complete game flow', () => {
    it('should handle full game creation and player interaction flow', async () => {
      const db = getTestDatabase();

      // Create users directly in the database
      const hostUserId = generateTestUUID();
      const guestUserId = generateTestUUID();

      await db
        .insert(schema.users)
        .values({
          id: hostUserId,
          username: `HostUser_${Date.now()}`,
          email: `host_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        })
        .returning();

      await db
        .insert(schema.users)
        .values({
          id: guestUserId,
          username: `GuestUser_${Date.now()}`,
          email: `guest_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        })
        .returning();

      const gameConfig = {
        name: 'Integration Test Game',
        hostId: hostUserId,
        maxPlayers: 2,
        mapWidth: 20,
        mapHeight: 20,
        ruleset: 'classic',
      };

      const gameId = await gameManager.createGame(gameConfig);
      expect(gameId).toBeDefined();

      // Join players
      const hostResult = await gameManager.joinGame(gameId, hostUserId, 'romans');
      const guestResult = await gameManager.joinGame(gameId, guestUserId, 'greeks');

      expect(hostResult.playerId).toBeDefined();
      expect(guestResult.playerId).toBeDefined();
      expect(hostResult.playerId).not.toBe(guestResult.playerId);
      expect(hostResult.assignedNation).toBe('romans');
      expect(guestResult.assignedNation).toBe('greeks');

      const hostPlayerId = hostResult.playerId;
      const guestPlayerId = guestResult.playerId;

      // Game should have auto-started when 2nd player joined
      const game = gameManager.getGameInstance(gameId);
      expect(game).toBeDefined();
      expect(game!.players.size).toBe(2);
      expect(game!.players.get(hostPlayerId)?.gold).toBe(50);
      expect(gameManager.getPlayerResearch(gameId, hostPlayerId)?.currentTech).toBeDefined();

      const persistedHost = await db.query.players.findFirst({
        where: eq(schema.players.id, hostPlayerId),
      });
      expect(persistedHost?.gold).toBe(50);

      // Test city founding
      const cityId = await gameManager.foundCity(gameId, hostPlayerId, 'TestCity', 10, 10);
      expect(cityId).toBeDefined();

      // Cities don't provide visibility by themselves in our implementation
      // Visibility comes from units, so let's create a unit first

      // Test unit creation affects visibility
      const unitId = await gameManager.createUnit(gameId, hostPlayerId, 'warriors', 12, 12);
      expect(unitId).toBeDefined();

      gameManager.updatePlayerVisibility(gameId, hostPlayerId);
      const unitTileVisibility = gameManager.getTileVisibility(gameId, hostPlayerId, 12, 12);
      expect(unitTileVisibility.isVisible).toBe(true);
      expect(unitTileVisibility.isExplored).toBe(true);

      const mapView = gameManager.getPlayerMapView(gameId, hostPlayerId);
      expect(mapView).toBeDefined();
      expect(mapView!.width).toBeGreaterThan(0);
      expect(mapView!.height).toBeGreaterThan(0);
      expect(mapView!.tiles.length).toBeGreaterThan(0);

      // Test research functionality
      await gameManager.setPlayerResearch(gameId, hostPlayerId, 'pottery');
      const hostResearch = gameManager.getPlayerResearch(gameId, hostPlayerId);
      expect(hostResearch?.currentTech).toBe('pottery');

      const availableTechs = gameManager.getAvailableTechnologies(gameId, hostPlayerId);
      expect(availableTechs.length).toBeGreaterThan(0);

      // Test turn mechanics - should properly track turn ending
      const turnAdvanced1 = await gameManager.endTurn(hostPlayerId);
      expect(turnAdvanced1).toBe(false); // Guest hasn't ended turn

      const turnAdvanced2 = await gameManager.endTurn(guestPlayerId);
      expect(turnAdvanced2).toBe(true); // Now turn advances

      // A joined player can reconnect to the same active game without creating a new player.
      const reconnectResult = await gameManager.joinGame(gameId, hostUserId, 'romans');
      expect(reconnectResult.playerId).toBe(hostPlayerId);

      // Integration test complete - all managers working together
    });

    it('plays twenty two-player turns and preserves the active game for recovery', async () => {
      // @reference reference/freeciv/server/srv_main.c:1155-1185,1607-1623
      const db = getTestDatabase();
      const hostUserId = generateTestUUID();
      const guestUserId = generateTestUUID();

      await db.insert(schema.users).values([
        {
          id: hostUserId,
          username: `TwentyTurnHost_${Date.now()}`,
          email: `twenty_turn_host_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
        {
          id: guestUserId,
          username: `TwentyTurnGuest_${Date.now()}`,
          email: `twenty_turn_guest_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
      ]);

      const gameId = await gameManager.createGame({
        name: 'Twenty Turn Integration Test',
        hostId: hostUserId,
        maxPlayers: 2,
        mapWidth: 20,
        mapHeight: 20,
        ruleset: 'classic',
      });
      const host = await gameManager.joinGame(gameId, hostUserId, 'romans');
      const guest = await gameManager.joinGame(gameId, guestUserId, 'greeks');

      for (let completedTurns = 0; completedTurns < 20; completedTurns += 1) {
        expect(await gameManager.endTurn(host.playerId)).toBe(false);
        expect(await gameManager.endTurn(guest.playerId)).toBe(true);
      }

      const activeGame = gameManager.getGameInstance(gameId);
      expect(activeGame).toBeDefined();
      expect(activeGame!.currentTurn).toBe(21);

      gameManager.clearAllGames();
      (GameManager as any).instance = null;
      const recoveredManager = GameManager.getInstance(
        createMockSocketServer(),
        getTestDatabaseProvider()
      );
      const recoveredGame = await recoveredManager.recoverGameInstance(gameId);

      expect(recoveredGame).not.toBeNull();
      expect(recoveredGame!.currentTurn).toBe(21);
      expect((await recoveredManager.joinGame(gameId, hostUserId, 'romans')).playerId).toBe(
        host.playerId
      );
    });

    it('processes an AI turn through authoritative managers and persists its decisions', async () => {
      const db = getTestDatabase();
      const hostUserId = generateTestUUID();
      const aiOwnerUserId = generateTestUUID();

      await db.insert(schema.users).values([
        {
          id: hostUserId,
          username: `AIFlowHost_${Date.now()}`,
          email: `ai_flow_host_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
        {
          id: aiOwnerUserId,
          username: `AIFlowGuest_${Date.now()}`,
          email: `ai_flow_guest_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
      ]);

      const gameId = await gameManager.createGame({
        name: 'AI Manager Integration Test',
        hostId: hostUserId,
        maxPlayers: 2,
        mapWidth: 20,
        mapHeight: 20,
        ruleset: 'classic',
      });
      const host = await gameManager.joinGame(gameId, hostUserId, 'romans');
      const aiPlayer = await gameManager.joinGame(gameId, aiOwnerUserId, 'greeks');

      await gameManager.setPlayerAIControl(gameId, hostUserId, aiPlayer.playerId, true, {
        aiLevel: 'hard',
      });

      const game = gameManager.getGameInstance(gameId)!;
      const aiUnitsBefore = [...game.unitManager.getAllUnits().values()].filter(
        unit => unit.playerId === aiPlayer.playerId
      );
      expect(aiUnitsBefore.length).toBeGreaterThan(0);

      expect(await gameManager.endTurn(host.playerId)).toBe(true);
      expect(game.currentTurn).toBe(2);

      const state = game.players.get(aiPlayer.playerId)?.aiState;
      expect(state).toMatchObject({
        lastProcessedTurn: 1,
      });
      expect(state?.lastDecisionCount).toEqual(expect.any(Number));
      expect(state?.lastDecisionCount).toBeGreaterThan(0);

      const persistedAI = await db.query.players.findFirst({
        where: eq(schema.players.id, aiPlayer.playerId),
      });
      expect(persistedAI).toMatchObject({
        isAI: true,
        aiLevel: 'hard',
      });
      expect(persistedAI?.aiState).toMatchObject({
        lastProcessedTurn: 1,
        lastDecisionCount: state?.lastDecisionCount,
      });
    });

    it('plays a complete multi-turn AI match with progress, recovery, combat, and victory', async () => {
      const db = getTestDatabase();
      const mapSeedSource = jest.spyOn(Math, 'random').mockReturnValue(0.42);
      const hostUserId = generateTestUUID();
      const secondAIUserId = generateTestUUID();
      const maxTurns = 30;
      const recoveryTurn = 10;

      await db.insert(schema.users).values([
        {
          id: hostUserId,
          username: `AIConfidenceHost_${Date.now()}`,
          email: `ai_confidence_host_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
        {
          id: secondAIUserId,
          username: `AIConfidenceTwo_${Date.now()}`,
          email: `ai_confidence_two_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
      ]);

      const gameId = await gameManager.createGame({
        name: 'AI Confidence Match',
        hostId: hostUserId,
        maxPlayers: 2,
        mapWidth: 20,
        mapHeight: 20,
        ruleset: 'classic',
        maxTurns,
        victoryConditions: ['max_turns'],
      });
      const host = await gameManager.joinGame(gameId, hostUserId, 'romans');
      const secondAI = await gameManager.joinGame(gameId, secondAIUserId, 'greeks');
      mapSeedSource.mockRestore();
      const aiPlayerIds = [host.playerId, secondAI.playerId];

      await gameManager.setPlayerAIControl(gameId, hostUserId, secondAI.playerId, true, {
        aiLevel: 'hard',
      });
      await gameManager.setPlayerAIControl(gameId, hostUserId, host.playerId, true, {
        aiLevel: 'hard',
      });

      const initialGame = gameManager.getGameInstance(gameId)!;
      const initialTechnologyCount = aiPlayerIds.reduce(
        (total, playerId) =>
          total + initialGame.researchManager.getResearchedTechs(playerId).length,
        0
      );
      const decisionsByPlayer = new Map(aiPlayerIds.map(playerId => [playerId, 0]));
      const worldStates = new Set<string>();
      let maxObservedProductionStock = 0;
      let maxObservedResearchProgress = 0;

      const recordProgress = (completedTurn: number) => {
        const game = gameManager.getGameInstance(gameId)!;
        const aiCities = aiPlayerIds.flatMap(playerId =>
          game.cityManager.getPlayerCities(playerId)
        );
        const aiUnits = aiPlayerIds.flatMap(playerId => game.unitManager.getPlayerUnits(playerId));
        const technologyCount = aiPlayerIds.reduce(
          (total, playerId) => total + game.researchManager.getResearchedTechs(playerId).length,
          0
        );
        const researchProgress = aiPlayerIds.reduce(
          (total, playerId) =>
            total + (game.researchManager.getPlayerResearch(playerId)?.bulbsAccumulated ?? 0),
          0
        );
        maxObservedProductionStock = Math.max(
          maxObservedProductionStock,
          ...aiCities.map(city => city.productionStock ?? 0),
          0
        );
        maxObservedResearchProgress = Math.max(maxObservedResearchProgress, researchProgress);

        worldStates.add(
          JSON.stringify({
            cities: aiCities
              .map(city => [city.id, city.playerId, city.size, city.currentProduction])
              .sort(),
            units: aiUnits.map(unit => [unit.id, unit.x, unit.y, unit.health]).sort(),
            technologyCount,
            researchProgress,
          })
        );

        for (const playerId of aiPlayerIds) {
          const player = game.players.get(playerId)!;
          const state = assertAIState(player.aiState);
          expect(state.lastProcessedTurn).toBe(completedTurn);
          expect(state.lastDecisionCount).toEqual(expect.any(Number));
          decisionsByPlayer.set(
            playerId,
            decisionsByPlayer.get(playerId)! + (state.lastDecisionCount ?? 0)
          );

          const ownedUnitIds = new Set(
            game.unitManager.getPlayerUnits(playerId).map(unit => unit.id)
          );
          expect(Object.keys(state.unitTasks).every(unitId => ownedUnitIds.has(unitId))).toBe(true);
        }
      };

      recordProgress(1);
      for (let completedTurn = 2; completedTurn <= recoveryTurn; completedTurn += 1) {
        await gameManager.getGameInstance(gameId)!.turnManager.processTurn();
        recordProgress(completedTurn);
      }

      const beforeRecovery = gameManager.getGameInstance(gameId)!;
      for (const playerId of aiPlayerIds) {
        expect(beforeRecovery.cityManager.getPlayerCities(playerId).length).toBeGreaterThan(0);
      }

      gameManager.clearAllGames();
      (GameManager as any).instance = null;
      gameManager = GameManager.getInstance(createMockSocketServer(), getTestDatabaseProvider());
      const recoveredGame = await gameManager.recoverGameInstance(gameId);
      expect(recoveredGame).not.toBeNull();
      expect(recoveredGame!.currentTurn).toBe(recoveryTurn + 1);

      for (const playerId of aiPlayerIds) {
        expect(assertAIState(recoveredGame!.players.get(playerId)?.aiState).lastProcessedTurn).toBe(
          recoveryTurn
        );
        const research = recoveredGame!.researchManager.getPlayerResearch(playerId);
        const progress = recoveredGame!.researchManager.getResearchProgress(playerId);
        expect(research?.currentTech).toBeDefined();
        expect(progress).not.toBeNull();
        await recoveredGame!.researchManager.addResearchPoints(playerId, progress!.required);
      }

      const targetCity = recoveredGame!.cityManager.getPlayerCities(secondAI.playerId)[0];
      const contactTile = recoveredGame!.mapManager.getNeighbors(targetCity.x, targetCity.y)[0];
      const isLand = (terrain: string) => !['ocean', 'deep_ocean', 'lake'].includes(terrain);
      const mapTiles = recoveredGame!.mapManager.getMapData()!.tiles.flat();
      const defenderTile = mapTiles.find(
        tile =>
          isLand(tile.terrain) &&
          !recoveredGame!.cityManager.getCityAt(tile.x, tile.y) &&
          recoveredGame!.unitManager.getUnitsAt(tile.x, tile.y).length === 0 &&
          recoveredGame!.mapManager
            .getNeighbors(tile.x, tile.y)
            .some(
              neighbor =>
                isLand(neighbor.terrain) &&
                !recoveredGame!.cityManager.getCityAt(neighbor.x, neighbor.y) &&
                recoveredGame!.unitManager.getUnitsAt(neighbor.x, neighbor.y).length === 0
            )
      );
      const attackerTile = defenderTile
        ? recoveredGame!.mapManager
            .getNeighbors(defenderTile.x, defenderTile.y)
            .find(
              neighbor =>
                isLand(neighbor.terrain) &&
                !recoveredGame!.cityManager.getCityAt(neighbor.x, neighbor.y) &&
                recoveredGame!.unitManager.getUnitsAt(neighbor.x, neighbor.y).length === 0
            )
        : undefined;
      expect(defenderTile).toBeDefined();
      expect(attackerTile).toBeDefined();

      const attackerId = await gameManager.createUnit(
        gameId,
        host.playerId,
        'howitzer',
        attackerTile!.x,
        attackerTile!.y
      );
      const defenderId = await gameManager.createUnit(
        gameId,
        secondAI.playerId,
        'howitzer',
        defenderTile!.x,
        defenderTile!.y
      );
      const exposedDefender = recoveredGame!.unitManager.getUnit(defenderId)!;
      exposedDefender.health = 1;
      exposedDefender.movementLeft = 0;
      const defenderInitialHealth = exposedDefender.health;
      const diplomatId = await gameManager.createUnit(
        gameId,
        host.playerId,
        'diplomat',
        contactTile.x,
        contactTile.y
      );
      await gameManager.executeDiplomatAction(
        gameId,
        host.playerId,
        diplomatId,
        ActionType.INVESTIGATE_CITY,
        targetCity.x,
        targetCity.y
      );
      await gameManager.declareWar(gameId, host.playerId, secondAI.playerId);

      for (let completedTurn = recoveryTurn + 1; completedTurn <= maxTurns; completedTurn += 1) {
        await gameManager.getGameInstance(gameId)!.turnManager.processTurn();
        recordProgress(completedTurn);
      }

      const finalGame = gameManager.getGameInstance(gameId)!;
      const finalAIUnits = aiPlayerIds.flatMap(playerId =>
        finalGame.unitManager.getPlayerUnits(playerId)
      );
      const finalTechnologyCount = aiPlayerIds.reduce(
        (total, playerId) => total + finalGame.researchManager.getResearchedTechs(playerId).length,
        0
      );
      const attackerAfter = finalGame.unitManager.getUnit(attackerId);
      const defenderAfter = finalGame.unitManager.getUnit(defenderId);

      expect(finalGame.state).toBe('ended');
      expect(finalGame.currentTurn).toBe(maxTurns);
      expect(worldStates.size).toBeGreaterThan(5);
      expect(maxObservedProductionStock).toBeGreaterThan(0);
      expect(maxObservedResearchProgress).toBeGreaterThan(0);
      expect(finalTechnologyCount).toBeGreaterThan(initialTechnologyCount);
      expect(finalAIUnits.length).toBeGreaterThan(0);
      expect([...decisionsByPlayer.values()].every(count => count > 0)).toBe(true);
      expect(
        !attackerAfter ||
          !defenderAfter ||
          attackerAfter.health < 100 ||
          defenderAfter.health !== defenderInitialHealth
      ).toBe(true);

      const persistedGame = await db.query.games.findFirst({
        where: eq(schema.games.id, gameId),
      });
      expect(persistedGame).toMatchObject({
        status: 'ended',
        currentTurn: maxTurns,
        endReason: 'max_turns',
      });
      const report = persistedGame?.endGameReport as
        | { winnerPlayerIds?: string[]; standings?: Array<{ playerId: string }> }
        | undefined;
      expect(report?.winnerPlayerIds?.some(playerId => aiPlayerIds.includes(playerId))).toBe(true);
      expect(report?.standings).toHaveLength(2);
    });

    it('should recover persisted map, units, cities, and borders after a server restart', async () => {
      const db = getTestDatabase();
      const hostUserId = generateTestUUID();
      const guestUserId = generateTestUUID();

      await db.insert(schema.users).values([
        {
          id: hostUserId,
          username: `ResumeHost_${Date.now()}`,
          email: `resume_host_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
        {
          id: guestUserId,
          username: `ResumeGuest_${Date.now()}`,
          email: `resume_guest_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
      ]);

      const gameId = await gameManager.createGame({
        name: 'Resume Integration Test',
        hostId: hostUserId,
        maxPlayers: 2,
        mapWidth: 20,
        mapHeight: 20,
        ruleset: 'classic',
      });
      const host = await gameManager.joinGame(gameId, hostUserId, 'romans');
      await gameManager.joinGame(gameId, guestUserId, 'greeks');

      const activeGame = gameManager.getGameInstance(gameId)!;
      const originalMap = activeGame.mapManager.getMapData()!;
      const originalTerrain = originalMap.tiles[10][10].terrain;
      const cityId = await gameManager.foundCity(gameId, host.playerId, 'Resume City', 10, 10);
      const unitId = await gameManager.createUnit(gameId, host.playerId, 'warriors', 12, 12);

      // Simulate a process restart: only the database survives.
      gameManager.clearAllGames();
      (GameManager as any).instance = null;
      const restartedManager = GameManager.getInstance(
        createMockSocketServer(),
        getTestDatabaseProvider()
      );

      const recoveredGame = await restartedManager.recoverGameInstance(gameId);

      expect(recoveredGame).not.toBeNull();
      expect(recoveredGame!.mapManager.getMapData()).not.toBeNull();
      expect(recoveredGame!.mapManager.getMapData()!.tiles[10][10].terrain).toBe(originalTerrain);
      expect(recoveredGame!.cityManager.getCity(cityId)).toBeDefined();
      expect(recoveredGame!.unitManager.getUnit(unitId)).toBeDefined();
      expect(recoveredGame!.borderManager.getAllBorderSources()).toEqual(
        expect.arrayContaining([expect.objectContaining({ cityId, playerId: host.playerId })])
      );
      expect(recoveredGame!.borderManager.getAllTileOwnership().length).toBeGreaterThan(0);

      // Rejoining uses the original player record rather than creating another one.
      const reconnect = await restartedManager.joinGame(gameId, hostUserId, 'romans');
      expect(reconnect.playerId).toBe(host.playerId);
    });

    // TODO: Fix in separate PR - games auto-transitioning from waiting to active status
    it('should maintain data consistency across manager interactions', async () => {
      const db = getTestDatabase();

      // Create host user for consistency test
      const hostUserId = generateTestUUID();
      const [hostUser] = await db
        .insert(schema.users)
        .values({
          id: hostUserId,
          username: `ConsistencyHost_${Date.now()}`,
          email: `consistency_host_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        })
        .returning();

      const gameConfig = {
        name: 'Consistency Test',
        hostId: hostUser.id,
        maxPlayers: 2,
        mapWidth: 10,
        mapHeight: 10,
      };

      // Create additional users for the players
      const user1Id = generateTestUUID();
      const user2Id = generateTestUUID();

      await db.insert(schema.users).values([
        {
          id: user1Id,
          username: `TestUser1_${Date.now()}`,
          email: `testuser1_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
        {
          id: user2Id,
          username: `TestUser2_${Date.now()}`,
          email: `testuser2_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
      ]);

      const gameId = await gameManager.createGame(gameConfig);
      const playerResult = await gameManager.joinGame(gameId, user1Id, 'romans');
      await gameManager.joinGame(gameId, user2Id, 'greeks'); // Need 2 players to start, game will auto-start

      const playerId = playerResult.playerId;

      // Create city and unit at same location
      const cityId = await gameManager.foundCity(gameId, playerId, 'Capital', 5, 5);
      const unitId = await gameManager.createUnit(gameId, playerId, 'warriors', 5, 5);

      const game = gameManager.getGameInstance(gameId)!;

      // Verify city manager has the city
      const city = game.cityManager.getCity(cityId);
      expect(city).toBeDefined();
      expect(city!.x).toBe(5);
      expect(city!.y).toBe(5);

      // Verify unit manager has the unit
      const unit = game.unitManager.getUnit(unitId);
      expect(unit).toBeDefined();
      expect(unit!.x).toBe(5);
      expect(unit!.y).toBe(5);

      // Verify visibility manager sees both
      gameManager.updatePlayerVisibility(gameId, playerId);
      const mapView = gameManager.getPlayerMapView(gameId, playerId);

      expect(mapView).toBeDefined();
      // Map view should contain visible/explored data
      if (mapView && Array.isArray(mapView)) {
        expect(mapView.length).toBeGreaterThan(0);
      }
    });
  });
});
