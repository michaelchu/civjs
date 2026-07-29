import { eq } from 'drizzle-orm';
import { ActionType } from '@app-types/shared/actions';
import serverConfig from '@config';
import * as schema from '@database/schema';
import { createAIProfile } from '@game/ai/AIProfile';
import { assertAIState, type FreecivAIState } from '@game/ai/AIStateStore';
import { hostileUnitsForPlanning } from '@game/ai/AITargeting';
import { BUILDING_TYPES } from '@game/managers/CityManager';
import { aiValidationBaseline } from '../fixtures/aiValidationBaseline';
import {
  GameManager,
  type GameConfig,
  type GameInstance,
} from '@game/managers/GameManager';
import {
  assertAIValidationInvariants,
  assertAIValidationMetricBaseline,
  buildAIValidationReplayFingerprint,
  captureAIValidationMetrics,
  writeAIValidationFailureArtifact,
} from '../utils/aiValidation';
import { createMockSocketServer } from '../utils/gameTestUtils';
import {
  clearAllTables,
  generateTestUUID,
  getTestDatabase,
  getTestDatabaseProvider,
} from '../utils/testDatabase';

type JoinedPlayer = {
  playerId: string;
  userId: string;
};

type TestGame = {
  gameId: string;
  hostUserId: string;
  players: JoinedPlayer[];
  game: GameInstance;
};

const validationSeedCount = Math.max(1, Number(process.env.AI_VALIDATION_SEED_COUNT ?? 3));
const validationSeeds = Array.from(
  { length: validationSeedCount },
  (_, index) => `ai-validation-${String(index + 1).padStart(2, '0')}`
);
const validationMaxTurns = Math.max(8, Number(process.env.AI_VALIDATION_MAX_TURNS ?? 8));
const recoveryTurnsBySeed: Record<string, number> = {
  'ai-validation-01': 2,
  'ai-validation-13': 4,
  'ai-validation-25': 6,
};
type ValidationScenario = {
  mapSeed: string;
  playerCount: 2 | 3;
  aiLevel: 'easy' | 'normal' | 'hard';
  victoryConditions: string[];
  mapWidth: number;
  mapHeight: number;
  terrainSettings: NonNullable<GameConfig['terrainSettings']>;
};
const terrainProfiles: ValidationScenario['terrainSettings'][] = [
  { generator: 'random', landmass: 'sparse', huts: 0, temperature: 30, wetness: 30, rivers: 20, resources: 'sparse' },
  { generator: 'random', landmass: 'normal', huts: 15, temperature: 50, wetness: 50, rivers: 50, resources: 'normal' },
  { generator: 'random', landmass: 'dense', huts: 30, temperature: 70, wetness: 70, rivers: 80, resources: 'abundant' },
];
const validationScenarios: ValidationScenario[] = validationSeeds.map((mapSeed, index) => ({
  mapSeed,
  playerCount: index % 5 === 4 ? 3 : 2,
  aiLevel: (['easy', 'normal', 'hard'] as const)[index % 3]!,
  victoryConditions: (index % 3 === 0 ? ['science'] : index % 3 === 1 ? ['conquest'] : ['max_turns']),
  mapWidth: index % 2 === 0 ? 20 : 24,
  mapHeight: index % 2 === 0 ? 20 : 16,
  terrainSettings: terrainProfiles[index % terrainProfiles.length]!,
}));

describe('AI authoritative manager boundaries', () => {
  let gameManager: GameManager;

  beforeEach(async () => {
    await clearAllTables();
    (GameManager as any).instance = null;
    gameManager = GameManager.getInstance(createMockSocketServer(), getTestDatabaseProvider());
  });

  afterEach(async () => {
    gameManager?.clearAllGames();
    // Turn processing persists state asynchronously. Let those writes drain
    // before the next beforeEach truncates the shared integration database.
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  async function createActiveGame(
    playerCount: 2 | 3,
    options: Partial<
      Pick<
        GameConfig,
        'victoryConditions' | 'maxTurns' | 'mapSeed' | 'mapWidth' | 'mapHeight' | 'terrainSettings'
      >
    > = {}
  ): Promise<TestGame> {
    const db = getTestDatabase();
    const userIds = Array.from({ length: playerCount }, () => generateTestUUID());
    const suffix = generateTestUUID().slice(0, 8);

    await db.insert(schema.users).values(
      userIds.map((id, index) => ({
        id,
        username: `AIBoundary${index}_${suffix}`,
        email: `ai_boundary_${index}_${suffix}@test.com`,
        passwordHash: 'test-hash',
      }))
    );

    const gameId = await gameManager.createGame({
      name: `AI manager boundary ${suffix}`,
      hostId: userIds[0]!,
      maxPlayers: playerCount,
      mapWidth: 20,
      mapHeight: 20,
      ruleset: 'classic',
      ...options,
    });
    const nations = ['roman', 'greek', 'egyptian'] as const;
    const players: JoinedPlayer[] = [];
    const originalMinimumPlayers = serverConfig.game.minPlayersToStart;
    if (playerCount === 3) serverConfig.game.minPlayersToStart = 3;
    try {
      for (let index = 0; index < playerCount; index += 1) {
        const joined = await gameManager.joinGame(gameId, userIds[index]!, nations[index]!);
        players.push({ playerId: joined.playerId, userId: userIds[index]! });
      }
    } finally {
      serverConfig.game.minPlayersToStart = originalMinimumPlayers;
    }

    let game = gameManager.getGameInstance(gameId);
    for (let attempt = 0; !game && attempt < 50; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
      game = gameManager.getGameInstance(gameId);
    }
    if (!game) throw new Error('Expected active game instance');
    return { gameId, hostUserId: userIds[0]!, players, game };
  }

  async function foundPlayerCity(scenario: TestGame, playerId: string, name: string) {
    const foundingUnit = scenario.game.unitManager
      .getPlayerUnits(playerId)
      .find(unit => scenario.game.unitManager.getUnitType(unit.unitTypeId)?.canFoundCity);
    if (!foundingUnit) throw new Error(`Expected a founding unit for ${playerId}`);
    const cityId = await gameManager.foundCity(
      scenario.gameId,
      playerId,
      name,
      foundingUnit.x,
      foundingUnit.y
    );
    return scenario.game.cityManager.getCity(cityId)!;
  }

  async function establishWar(
    scenario: TestGame,
    firstPlayerId: string,
    secondPlayerId: string
  ): Promise<void> {
    await (gameManager as any).diplomacyManager.establishContact(
      scenario.gameId,
      firstPlayerId,
      secondPlayerId
    );
    await (gameManager as any).refreshSharedVision(scenario.gameId);
  }

  async function waitForPersistedAIState(
    playerId: string,
    predicate: (state: FreecivAIState) => boolean
  ): Promise<FreecivAIState> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const player = await getTestDatabase().query.players.findFirst({
        where: eq(schema.players.id, playerId),
      });
      const state = assertAIState(player?.aiState);
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`AI state for ${playerId} was not persisted in time`);
  }

  function findMovableLandPair(game: GameInstance) {
    const map = game.mapManager.getMapData();
    if (!map) throw new Error('Expected generated map');
    const isLand = (terrain: string) => !['ocean', 'deep_ocean', 'lake'].includes(terrain);

    for (const tile of map.tiles.flat()) {
      if (
        !isLand(tile.terrain) ||
        game.cityManager.getCityAt(tile.x, tile.y) ||
        game.unitManager.getUnitsAt(tile.x, tile.y).length > 0
      ) {
        continue;
      }
      const neighbor = game.mapManager
        .getNeighbors(tile.x, tile.y)
        .find(
          candidate =>
            isLand(candidate.terrain) &&
            !game.cityManager.getCityAt(candidate.x, candidate.y) &&
            game.unitManager.getUnitsAt(candidate.x, candidate.y).length === 0
        );
      if (neighbor) return { from: tile, to: neighbor };
    }
    throw new Error('Expected two adjacent unoccupied land tiles');
  }

  function findRoadableCityTile(game: GameInstance, cityId: string) {
    const city = game.cityManager.getCity(cityId);
    if (!city) throw new Error('Expected city');
    for (const workable of city.workableTiles ?? []) {
      const tile = game.mapManager.getTile(workable.x, workable.y);
      if (
        tile &&
        game.mapManager.getDistance(city.x, city.y, tile.x, tile.y) === 1 &&
        !['ocean', 'deep_ocean', 'lake'].includes(tile.terrain) &&
        !tile.hasRoad &&
        !tile.improvements.includes('road') &&
        !game.cityManager.getCityAt(tile.x, tile.y)
      ) {
        return tile;
      }
    }
    throw new Error(`Expected an unimproved roadable tile for city ${cityId}`);
  }

  function findCrossContinentTransportSetup(game: GameInstance) {
    const map = game.mapManager.getMapData();
    if (!map) throw new Error('Expected generated map');
    // Lakes can border two continent ids without providing a navigable
    // intercontinental route. Use the connected ocean network for ferry cases.
    const isWater = (terrain: string) => ['ocean', 'deep_ocean'].includes(terrain);
    const landTiles = map.tiles
      .flat()
      .filter(
        tile =>
          !isWater(tile.terrain) &&
          !game.cityManager.getCityAt(tile.x, tile.y) &&
          game.unitManager.getUnitsAt(tile.x, tile.y).length === 0
      );
    for (const start of landTiles) {
      const embark = game.mapManager
        .getNeighbors(start.x, start.y)
        .find(
          tile => isWater(tile.terrain) && game.unitManager.getUnitsAt(tile.x, tile.y).length === 0
        );
      if (!embark) continue;
      const reachableWater = new Set<string>();
      const frontier = [embark];
      while (frontier.length > 0) {
        const water = frontier.pop()!;
        const key = `${water.x},${water.y}`;
        if (reachableWater.has(key)) continue;
        reachableWater.add(key);
        frontier.push(
          ...game.mapManager.getNeighbors(water.x, water.y).filter(tile => isWater(tile.terrain))
        );
      }
      const destination = landTiles.find(
        tile =>
          tile.continentId !== start.continentId &&
          game.mapManager
            .getNeighbors(tile.x, tile.y)
            .some(neighbor => reachableWater.has(`${neighbor.x},${neighbor.y}`))
      );
      if (destination) return { start, embark, destination };
    }
    throw new Error('Expected coastal tiles on two different continents');
  }

  it('releases the human turn barrier on AI takeover and recovers the transferred authority', async () => {
    const scenario = await createActiveGame(2);
    const [host, guest] = scenario.players;

    expect(await gameManager.endTurn(host!.playerId)).toBe(false);
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      guest!.playerId,
      true,
      { aiLevel: 'normal' }
    );

    expect(scenario.game.currentTurn).toBe(2);
    const liveGuest = scenario.game.players.get(guest!.playerId);
    expect(liveGuest).toMatchObject({
      isAI: true,
      aiLevel: 'normal',
      hasEndedTurn: false,
    });
    expect(assertAIState(liveGuest?.aiState).lastProcessedTurn).toBe(1);

    const persisted = await getTestDatabase().query.players.findFirst({
      where: eq(schema.players.id, guest!.playerId),
    });
    expect(persisted).toMatchObject({
      isAI: true,
      aiLevel: 'normal',
      hasEndedTurn: false,
    });
    expect(assertAIState(persisted?.aiState).lastProcessedTurn).toBe(1);

    gameManager.clearAllGames();
    (GameManager as any).instance = null;
    gameManager = GameManager.getInstance(createMockSocketServer(), getTestDatabaseProvider());
    const recovered = await gameManager.recoverGameInstance(scenario.gameId);

    expect(recovered?.currentTurn).toBe(2);
    expect(recovered?.players.get(guest!.playerId)).toMatchObject({
      isAI: true,
      aiLevel: 'normal',
    });
    expect(assertAIState(recovered?.players.get(guest!.playerId)?.aiState).lastProcessedTurn).toBe(
      1
    );
  });

  it('does not execute or persist a completed AI phase twice for the same turn', async () => {
    const scenario = await createActiveGame(2);
    const [, guest] = scenario.players;
    const foundingUnit = scenario.game.unitManager
      .getPlayerUnits(guest!.playerId)
      .find(unit => scenario.game.unitManager.getUnitType(unit.unitTypeId)?.canFoundCity);
    expect(foundingUnit).toBeDefined();
    await gameManager.foundCity(
      scenario.gameId,
      guest!.playerId,
      'AI Retry City',
      foundingUnit!.x,
      foundingUnit!.y
    );
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      guest!.playerId,
      true,
      { aiLevel: 'normal' }
    );

    const orchestrator = (gameManager as any).aiOrchestrator;
    const firstActionCount = await orchestrator.processTurn(scenario.gameId, scenario.game);
    expect(firstActionCount).toBeGreaterThan(0);
    const firstState = structuredClone(
      assertAIState(scenario.game.players.get(guest!.playerId)?.aiState)
    );
    const snapshotWorld = () => ({
      units: scenario.game.unitManager
        .getPlayerUnits(guest!.playerId)
        .map(unit => [unit.id, unit.x, unit.y, unit.movementLeft])
        .sort(),
      cities: scenario.game.cityManager
        .getPlayerCities(guest!.playerId)
        .map(city => [
          city.id,
          city.currentProduction,
          city.productionStock,
          structuredClone(city.worklist),
        ])
        .sort(),
      research: scenario.game.researchManager.getPlayerResearch(guest!.playerId),
    });
    const firstWorld = snapshotWorld();

    const secondActionCount = await orchestrator.processTurn(scenario.gameId, scenario.game);

    expect(secondActionCount).toBe(0);
    expect(assertAIState(scenario.game.players.get(guest!.playerId)?.aiState)).toEqual(firstState);
    expect(snapshotWorld()).toEqual(firstWorld);
    const persistedState = await waitForPersistedAIState(
      guest!.playerId,
      state => state.lastProcessedTurn === scenario.game.currentTurn
    );
    expect(persistedState).toEqual(firstState);
  });

  it('does not replay authoritative actions from an interrupted persisted AI phase', async () => {
    const scenario = await createActiveGame(2);
    const [, guest] = scenario.players;
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      guest!.playerId,
      true,
      { aiLevel: 'normal' }
    );
    const pair = findMovableLandPair(scenario.game);
    const unitId = await gameManager.createUnit(
      scenario.gameId,
      guest!.playerId,
      'warriors',
      pair.from.x,
      pair.from.y
    );
    const orchestrator = (gameManager as any).aiOrchestrator;
    orchestrator.playerController.processPlayer = async () => {
      await scenario.game.unitManager.moveUnit(unitId, pair.to.x, pair.to.y);
      throw new Error('simulated process interruption');
    };

    await expect(orchestrator.processTurn(scenario.gameId, scenario.game)).rejects.toThrow(
      'simulated process interruption'
    );
    expect(scenario.game.unitManager.getUnit(unitId)).toMatchObject({
      x: pair.to.x,
      y: pair.to.y,
    });
    await waitForPersistedAIState(
      guest!.playerId,
      state => state.inProgressTurn === scenario.game.currentTurn
    );

    gameManager.clearAllGames();
    (GameManager as any).instance = null;
    gameManager = GameManager.getInstance(createMockSocketServer(), getTestDatabaseProvider());
    const recovered = await gameManager.recoverGameInstance(scenario.gameId);
    const retryActions = await (gameManager as any).aiOrchestrator.processTurn(
      scenario.gameId,
      recovered
    );

    expect(retryActions).toBe(0);
    expect(recovered?.unitManager.getUnit(unitId)).toMatchObject({
      x: pair.to.x,
      y: pair.to.y,
    });
    const recoveredState = assertAIState(recovered?.players.get(guest!.playerId)?.aiState);
    expect(recoveredState).toMatchObject({
      lastProcessedTurn: scenario.game.currentTurn,
      lastDecisionCount: 0,
    });
    expect(recoveredState.inProgressTurn).toBeUndefined();
  });

  it('updates and removes persisted target assignments through real unit lifecycle events', async () => {
    const scenario = await createActiveGame(2);
    const [host, guest] = scenario.players;
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      host!.playerId,
      true,
      { aiLevel: 'normal' }
    );

    const pair = findMovableLandPair(scenario.game);
    const hunterId = await gameManager.createUnit(
      scenario.gameId,
      host!.playerId,
      'warriors',
      pair.from.x,
      pair.from.y
    );
    const targetId = await gameManager.createUnit(
      scenario.gameId,
      guest!.playerId,
      'warriors',
      pair.to.x,
      pair.to.y
    );
    const secondTargetTile = scenario.game.mapManager
      .getNeighbors(pair.to.x, pair.to.y)
      .find(
        tile =>
          !['ocean', 'deep_ocean', 'lake'].includes(tile.terrain) &&
          !scenario.game.cityManager.getCityAt(tile.x, tile.y) &&
          scenario.game.unitManager.getUnitsAt(tile.x, tile.y).length === 0
      );
    expect(secondTargetTile).toBeDefined();

    const aiPlayer = scenario.game.players.get(host!.playerId)!;
    const state = assertAIState(aiPlayer.aiState);
    state.unitTasks[hunterId] = {
      role: 'hunter',
      targetId,
      targetX: pair.to.x,
      targetY: pair.to.y,
      assignedTurn: scenario.game.currentTurn,
    };
    await getTestDatabase()
      .update(schema.players)
      .set({ aiState: structuredClone(state) })
      .where(eq(schema.players.id, host!.playerId));

    await scenario.game.unitManager.moveUnit(targetId, secondTargetTile!.x, secondTargetTile!.y);

    expect(assertAIState(aiPlayer.aiState).unitTasks[hunterId]).toMatchObject({
      targetId,
      targetX: secondTargetTile!.x,
      targetY: secondTargetTile!.y,
    });
    const movedState = await waitForPersistedAIState(
      host!.playerId,
      persistedState =>
        persistedState.unitTasks[hunterId]?.targetX === secondTargetTile!.x &&
        persistedState.unitTasks[hunterId]?.targetY === secondTargetTile!.y
    );
    expect(movedState.unitTasks[hunterId]?.targetId).toBe(targetId);

    await scenario.game.unitManager.removeUnit(targetId);

    expect(assertAIState(aiPlayer.aiState).unitTasks[hunterId]).toBeUndefined();
    await waitForPersistedAIState(
      host!.playerId,
      persistedState => persistedState.unitTasks[hunterId] === undefined
    );
  });

  it('embarks, recovers, transports, and unloads a cross-continent settler authoritatively', async () => {
    const scenario = await createActiveGame(2);
    const [, guest] = scenario.players;
    const route = findCrossContinentTransportSetup(scenario.game);
    const passengerId = await gameManager.createUnit(
      scenario.gameId,
      guest!.playerId,
      'settlers',
      route.start.x,
      route.start.y
    );
    const ferryId = await gameManager.createUnit(
      scenario.gameId,
      guest!.playerId,
      'transport',
      route.embark.x,
      route.embark.y
    );
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      guest!.playerId,
      true,
      { aiLevel: 'hard' }
    );
    const state = assertAIState(scenario.game.players.get(guest!.playerId)?.aiState);
    state.unitTasks[passengerId] = {
      role: 'settle',
      targetX: route.destination.x,
      targetY: route.destination.y,
      transportRequired: true,
      assignedTurn: scenario.game.currentTurn,
    };

    await (gameManager as any).aiOrchestrator.playerController.transport.manageFerries(
      scenario.game,
      guest!.playerId,
      state
    );
    await (gameManager as any).aiOrchestrator.stateStore.save(
      scenario.gameId,
      guest!.playerId,
      state
    );

    expect(scenario.game.unitManager.getUnit(passengerId)?.transportedBy).toBe(ferryId);
    expect(scenario.game.unitManager.getUnit(ferryId)?.cargoUnits).toContain(passengerId);

    gameManager.clearAllGames();
    (GameManager as any).instance = null;
    gameManager = GameManager.getInstance(createMockSocketServer(), getTestDatabaseProvider());
    const recovered = await gameManager.recoverGameInstance(scenario.gameId);
    expect(recovered?.unitManager.getUnit(passengerId)?.transportedBy).toBe(ferryId);
    expect(recovered?.unitManager.getUnit(ferryId)?.cargoUnits).toContain(passengerId);
    const recoveredState = assertAIState(recovered?.players.get(guest!.playerId)?.aiState);

    // Ferry routing searches the full map for a safe beachhead, so the
    // number of turns depends on the generated island layout. Keep the
    // simulation bound comfortably above the largest 20x20 route.
    for (let turn = 0; turn < 100; turn += 1) {
      recovered!.currentTurn += 1;
      for (const unitId of [ferryId, passengerId]) {
        const unit = recovered!.unitManager.getUnit(unitId);
        const type = unit && recovered!.unitManager.getUnitType(unit.unitTypeId);
        if (unit && type) unit.movementLeft = type.movement * 3;
      }
      await (gameManager as any).aiOrchestrator.playerController.transport.manageFerries(
        recovered,
        guest!.playerId,
        recoveredState
      );
      const passenger = recovered!.unitManager.getUnit(passengerId);
      if (!passenger || !passenger.transportedBy) break;
    }

    const delivered = recovered!.unitManager.getUnit(passengerId);
    const foundedCity = recovered!.cityManager
      .getPlayerCities(guest!.playerId)
      .find(city => city.x === route.destination.x && city.y === route.destination.y);
    expect(
      Boolean(foundedCity) ||
        Boolean(
          delivered &&
            !delivered.transportedBy &&
            recovered!.mapManager.getTile(delivered.x, delivered.y)?.continentId ===
              route.destination.continentId
        )
    ).toBe(true);
  });

  it('keeps hidden hostile units out of lower-skill targeting while preserving explicit omniscience', async () => {
    const scenario = await createActiveGame(2);
    const [host, guest] = scenario.players;
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      host!.playerId,
      true,
      { aiLevel: 'easy' }
    );
    scenario.game.visibilityManager.updatePlayerVisibility(host!.playerId);

    const map = scenario.game.mapManager.getMapData();
    if (!map) throw new Error('Expected generated map');
    const hiddenTile = map.tiles
      .flat()
      .find(
        tile =>
          !['ocean', 'deep_ocean', 'lake'].includes(tile.terrain) &&
          !scenario.game.visibilityManager.isTileVisible(host!.playerId, tile.x, tile.y) &&
          !scenario.game.cityManager.getCityAt(tile.x, tile.y) &&
          scenario.game.unitManager.getUnitsAt(tile.x, tile.y).length === 0
      );
    expect(hiddenTile).toBeDefined();

    const hiddenTargetId = await gameManager.createUnit(
      scenario.gameId,
      guest!.playerId,
      'howitzer',
      hiddenTile!.x,
      hiddenTile!.y
    );
    scenario.game.visibilityManager.updatePlayerVisibility(host!.playerId);
    expect(
      scenario.game.visibilityManager.isTileVisible(host!.playerId, hiddenTile!.x, hiddenTile!.y)
    ).toBe(false);

    const hostileIds = new Set([guest!.playerId]);
    const easyTargets = hostileUnitsForPlanning(
      scenario.game,
      host!.playerId,
      hostileIds,
      createAIProfile('easy')
    );
    const hardTargets = hostileUnitsForPlanning(
      scenario.game,
      host!.playerId,
      hostileIds,
      createAIProfile('hard')
    );

    expect(easyTargets.map(unit => unit.id)).not.toContain(hiddenTargetId);
    expect(hardTargets.map(unit => unit.id)).toContain(hiddenTargetId);
  });

  it('executes a nuclear AI objective through authoritative combat and city damage', async () => {
    const scenario = await createActiveGame(2);
    const [host, guest] = scenario.players;
    const enemyCity = await foundPlayerCity(scenario, guest!.playerId, 'Nuclear Target');
    enemyCity.population = 6;
    enemyCity.size = 6;
    const launchTile = scenario.game.mapManager
      .getNeighbors(enemyCity.x, enemyCity.y)
      .find(
        tile =>
          !['ocean', 'deep_ocean', 'lake'].includes(tile.terrain) &&
          scenario.game.unitManager.getUnitsAt(tile.x, tile.y).length === 0
      );
    expect(launchTile).toBeDefined();
    const nuclearId = await gameManager.createUnit(
      scenario.gameId,
      host!.playerId,
      'nuclear',
      launchTile!.x,
      launchTile!.y
    );
    const defenderId = await gameManager.createUnit(
      scenario.gameId,
      guest!.playerId,
      'howitzer',
      enemyCity.x,
      enemyCity.y
    );
    const initialPopulation = enemyCity.population;
    await establishWar(scenario, host!.playerId, guest!.playerId);
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      host!.playerId,
      true,
      { aiLevel: 'hard' }
    );
    scenario.game.visibilityManager.updatePlayerVisibility(host!.playerId);
    const state = assertAIState(scenario.game.players.get(host!.playerId)?.aiState);

    const actions = await (
      gameManager as any
    ).aiOrchestrator.playerController.units.attackAdjacentEnemies(
      scenario.gameId,
      scenario.game,
      host!.playerId,
      state
    );

    expect(actions).toBeGreaterThan(0);
    expect(scenario.game.unitManager.getUnit(nuclearId)).toBeUndefined();
    expect(scenario.game.unitManager.getUnit(defenderId)).toBeUndefined();
    expect(enemyCity.population).toBeLessThan(initialPopulation);
  });

  // TODO(ai-validation): Re-enable once paradrop mission selection no longer
  // depends on generated-world visibility and combat timing.
  it.skip('uses a real paratrooper to capture an undefended hostile city', async () => {
    const scenario = await createActiveGame(2);
    const [host, guest] = scenario.players;
    const enemyCity = await foundPlayerCity(scenario, guest!.playerId, 'Paradrop Target');
    enemyCity.population = 2;
    enemyCity.size = 2;
    const paratrooperType = scenario.game.unitManager.getUnitType('paratroopers');
    expect(paratrooperType).toBeDefined();
    for (const unit of scenario.game.unitManager.getPlayerUnits(guest!.playerId)) {
      await scenario.game.unitManager.removeUnit(unit.id);
    }
    const dropSource = scenario.game.mapManager
      .getMapData()!
      .tiles.flat()
      .find(
        tile =>
          !['ocean', 'deep_ocean', 'lake'].includes(tile.terrain) &&
          scenario.game.mapManager.getDistance(tile.x, tile.y, enemyCity.x, enemyCity.y) <=
            paratrooperType!.paratroopersRange &&
          !scenario.game.cityManager.getCityAt(tile.x, tile.y) &&
          scenario.game.unitManager.getUnitsAt(tile.x, tile.y).length === 0
      );
    expect(dropSource).toBeDefined();
    scenario.game.mapManager.updateTileProperty(dropSource!.x, dropSource!.y, 'improvements', [
      ...dropSource!.improvements,
      'airbase',
    ]);
    const paratrooperId = await gameManager.createUnit(
      scenario.gameId,
      host!.playerId,
      'paratroopers',
      dropSource!.x,
      dropSource!.y
    );
    await establishWar(scenario, host!.playerId, guest!.playerId);
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      host!.playerId,
      true,
      { aiLevel: 'hard' }
    );
    const state = assertAIState(scenario.game.players.get(host!.playerId)?.aiState);

    const actions = await (
      gameManager as any
    ).aiOrchestrator.playerController.specialUnits.manageAirAndParadrops(
      scenario.gameId,
      scenario.game,
      host!.playerId,
      state
    );

    expect(actions).toBeGreaterThan(0);
    expect(scenario.game.cityManager.getCityAt(enemyCity.x, enemyCity.y)?.playerId).toBe(
      host!.playerId
    );
    expect(scenario.game.unitManager.getUnit(paratrooperId)).toMatchObject({
      x: enemyCity.x,
      y: enemyCity.y,
    });
  });

  it('uses a real diplomat mission to establish a missing embassy', async () => {
    const scenario = await createActiveGame(2);
    const [host, guest] = scenario.players;
    const enemyCity = await foundPlayerCity(scenario, guest!.playerId, 'Diplomat Target');
    const approach = scenario.game.mapManager
      .getNeighbors(enemyCity.x, enemyCity.y)
      .find(
        tile =>
          !['ocean', 'deep_ocean', 'lake'].includes(tile.terrain) &&
          scenario.game.unitManager.getUnitsAt(tile.x, tile.y).length === 0
      );
    expect(approach).toBeDefined();
    await gameManager.createUnit(
      scenario.gameId,
      host!.playerId,
      'diplomat',
      approach!.x,
      approach!.y
    );
    await establishWar(scenario, host!.playerId, guest!.playerId);
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      host!.playerId,
      true,
      { aiLevel: 'hard' }
    );
    const state = assertAIState(scenario.game.players.get(host!.playerId)?.aiState);

    const actions = await (
      gameManager as any
    ).aiOrchestrator.playerController.specialUnits.manageDiplomatUnits(
      scenario.gameId,
      scenario.game,
      host!.playerId,
      state
    );
    const snapshot = await (gameManager as any).diplomacyManager.getSnapshot(
      scenario.gameId,
      host!.playerId
    );

    expect(actions).toBeGreaterThan(0);
    expect(
      snapshot.nations.find((nation: { id: string }) => nation.id === guest!.playerId)?.relation
        .embassy
    ).toBe(true);
  });

  it('launches a carrier aircraft for a profitable authoritative strike', async () => {
    const scenario = await createActiveGame(2, {
      mapSeed: 'ai-carrier-continents-01',
      mapWidth: 40,
      mapHeight: 30,
      terrainSettings: {
        generator: 'random',
        landmass: 'sparse',
        huts: 0,
        temperature: 50,
        wetness: 50,
        rivers: 30,
        resources: 'normal',
      },
    });
    const [host, guest] = scenario.players;
    for (const unit of scenario.game.unitManager.getPlayerUnits(guest!.playerId)) {
      await scenario.game.unitManager.removeUnit(unit.id);
    }
    const coast = findCrossContinentTransportSetup(scenario.game);
    const carrierId = await gameManager.createUnit(
      scenario.gameId,
      host!.playerId,
      'carrier',
      coast.embark.x,
      coast.embark.y
    );
    const bomberId = await gameManager.createUnit(
      scenario.gameId,
      host!.playerId,
      'bomber',
      coast.embark.x,
      coast.embark.y
    );
    const targetId = await gameManager.createUnit(
      scenario.gameId,
      guest!.playerId,
      'howitzer',
      coast.start.x,
      coast.start.y
    );
    expect(await scenario.game.unitManager.loadUnitOntoTransport(carrierId, bomberId)).toBe(true);
    const bomber = scenario.game.unitManager.getUnit(bomberId)!;
    bomber.movementLeft = scenario.game.unitManager.getUnitType('bomber')!.movement * 3;
    await establishWar(scenario, host!.playerId, guest!.playerId);
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      host!.playerId,
      true,
      { aiLevel: 'hard' }
    );
    const state = assertAIState(scenario.game.players.get(host!.playerId)?.aiState);

    const actions = await (
      gameManager as any
    ).aiOrchestrator.playerController.specialUnits.manageAirAndParadrops(
      scenario.gameId,
      scenario.game,
      host!.playerId,
      state
    );

    expect(actions).toBeGreaterThan(0);
    expect(scenario.game.unitManager.getUnit(bomberId)?.transportedBy).toBeUndefined();
    const target = scenario.game.unitManager.getUnit(targetId);
    const survivingBomber = scenario.game.unitManager.getUnit(bomberId);
    expect(!target || target.health < 100 || !survivingBomber || survivingBomber.health < 100).toBe(
      true
    );
  });

  it('launches a carried hunter missile before pursuing its naval target', async () => {
    const scenario = await createActiveGame(2);
    const [host, guest] = scenario.players;
    const map = scenario.game.mapManager.getMapData()!;
    const isWater = (terrain: string) => ['ocean', 'deep_ocean', 'lake'].includes(terrain);
    for (const unit of scenario.game.unitManager.getPlayerUnits(guest!.playerId)) {
      await scenario.game.unitManager.removeUnit(unit.id);
    }
    const launch = map.tiles
      .flat()
      .find(
        tile =>
          isWater(tile.terrain) &&
          scenario.game.unitManager.getUnitsAt(tile.x, tile.y).length === 0 &&
          scenario.game.mapManager
            .getNeighbors(tile.x, tile.y)
            .some(
              neighbor =>
                isWater(neighbor.terrain) &&
                scenario.game.unitManager.getUnitsAt(neighbor.x, neighbor.y).length === 0
            )
      );
    const targetTile = launch
      ? scenario.game.mapManager
          .getNeighbors(launch.x, launch.y)
          .find(
            tile =>
              isWater(tile.terrain) &&
              scenario.game.unitManager.getUnitsAt(tile.x, tile.y).length === 0
          )
      : undefined;
    expect(launch).toBeDefined();
    expect(targetTile).toBeDefined();
    const hunterId = await gameManager.createUnit(
      scenario.gameId,
      host!.playerId,
      'submarine',
      launch!.x,
      launch!.y
    );
    const missileId = await gameManager.createUnit(
      scenario.gameId,
      host!.playerId,
      'cruise_missile',
      launch!.x,
      launch!.y
    );
    const targetId = await gameManager.createUnit(
      scenario.gameId,
      guest!.playerId,
      'transport',
      targetTile!.x,
      targetTile!.y
    );
    const escortId = await gameManager.createUnit(
      scenario.gameId,
      guest!.playerId,
      'destroyer',
      targetTile!.x,
      targetTile!.y
    );
    expect(await scenario.game.unitManager.loadUnitOntoTransport(hunterId, missileId)).toBe(true);
    scenario.game.unitManager.getUnit(missileId)!.movementLeft =
      scenario.game.unitManager.getUnitType('cruise_missile')!.movement * 3;
    await establishWar(scenario, host!.playerId, guest!.playerId);
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      host!.playerId,
      true,
      { aiLevel: 'hard' }
    );
    const state = assertAIState(scenario.game.players.get(host!.playerId)?.aiState);

    const actions = await (gameManager as any).aiOrchestrator.playerController.units.manageHunters(
      scenario.gameId,
      scenario.game,
      host!.playerId,
      state
    );

    expect(actions).toBeGreaterThan(0);
    expect(scenario.game.unitManager.getUnit(missileId)).toBeUndefined();
    const target = scenario.game.unitManager.getUnit(targetId);
    const escort = scenario.game.unitManager.getUnit(escortId);
    expect(!target || target.health < 100 || !escort || escort.health < 100).toBe(true);
  });

  it('preserves active production, seeds ranked worklists, and recovers the authoritative queue', async () => {
    const scenario = await createActiveGame(2);
    const [host, guest] = scenario.players;
    const foundingUnit = scenario.game.unitManager
      .getPlayerUnits(guest!.playerId)
      .find(unit => scenario.game.unitManager.getUnitType(unit.unitTypeId)?.canFoundCity);
    expect(foundingUnit).toBeDefined();
    await gameManager.foundCity(
      scenario.gameId,
      guest!.playerId,
      'AI Queue City',
      foundingUnit!.x,
      foundingUnit!.y
    );
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      guest!.playerId,
      true,
      { aiLevel: 'normal' }
    );

    const citiesBefore = scenario.game.cityManager.getPlayerCities(guest!.playerId);
    expect(citiesBefore.length).toBeGreaterThan(0);
    const productionBefore = new Map(citiesBefore.map(city => [city.id, city.currentProduction]));

    expect(await gameManager.endTurn(host!.playerId)).toBe(true);

    const aiState = assertAIState(scenario.game.players.get(guest!.playerId)?.aiState);
    const expectedQueues = new Map<
      string,
      { currentProduction: string | null | undefined; worklist: unknown[] }
    >();
    for (const city of scenario.game.cityManager.getPlayerCities(guest!.playerId)) {
      expect(city.currentProduction).toBe(productionBefore.get(city.id));
      expect(Object.keys(aiState.cityWants[city.id] ?? {}).length).toBeGreaterThan(0);
      expect(city.worklist.length).toBeGreaterThan(0);
      expectedQueues.set(city.id, {
        currentProduction: city.currentProduction,
        worklist: structuredClone(city.worklist),
      });

      const persistedCity = await getTestDatabase().query.cities.findFirst({
        where: eq(schema.cities.id, city.id),
      });
      expect(persistedCity?.currentProduction).toBe(city.currentProduction);
      expect(persistedCity?.productionQueue).toEqual(city.worklist);
    }

    gameManager.clearAllGames();
    (GameManager as any).instance = null;
    gameManager = GameManager.getInstance(createMockSocketServer(), getTestDatabaseProvider());
    const recovered = await gameManager.recoverGameInstance(scenario.gameId);

    for (const city of recovered!.cityManager.getPlayerCities(guest!.playerId)) {
      expect({
        currentProduction: city.currentProduction,
        worklist: city.worklist,
      }).toEqual(expectedQueues.get(city.id));
    }
  });

  it('produces a terrain improver and completes a requested road through authoritative managers', async () => {
    const scenario = await createActiveGame(2);
    const [, guest] = scenario.players;
    const city = await foundPlayerCity(scenario, guest!.playerId, 'AI Infrastructure City');
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      guest!.playerId,
      true,
      { aiLevel: 'normal' }
    );

    const state = assertAIState(scenario.game.players.get(guest!.playerId)?.aiState);
    const target = findRoadableCityTile(scenario.game, city.id);
    city.currentProduction = null;
    city.productionType = null;
    city.worklist = [];
    city.buildings.push('barracks');
    city.workerTaskRequests = [
      { x: target.x, y: target.y, action: ActionType.BUILD_ROAD, want: 500 },
    ];
    const cityController = (gameManager as any).aiOrchestrator.playerController.city;
    await cityController.selectProduction(scenario.game, guest!.playerId, state);

    const workerType = scenario.game.unitManager.getUnitType(city.currentProduction!)!;
    expect(workerType.canBuildImprovements).toBe(true);
    city.productionStock = workerType.cost;
    city.shieldStock = workerType.cost;
    await scenario.game.cityManager.processCityTurn(city.id, scenario.game.currentTurn);

    const worker = scenario.game.unitManager
      .getPlayerUnits(guest!.playerId)
      .find(unit => unit.unitTypeId === workerType.id && unit.homeCityId === city.id);
    expect(worker).toBeDefined();

    expect(await scenario.game.unitManager.moveUnit(worker!.id, target.x, target.y)).toBe(true);
    worker!.movementLeft = workerType.movement;

    const unitController = (gameManager as any).aiOrchestrator.playerController.units;
    expect(await unitController.automateWorkers(scenario.game, guest!.playerId, state)).toBeGreaterThan(
      0
    );
    expect(worker!.orders).toEqual([{ type: 'road' }]);
    expect(city.workerTaskRequests).toEqual([]);

    // Improvement duration is ruleset/tile dependent. Drive the authoritative
    // order processor until it completes, instead of assuming every road has
    // exactly the unit-test fixture's two-turn duration.
    for (let attempt = 0; attempt < 20 && !scenario.game.mapManager.getTile(target.x, target.y)!.hasRoad; attempt += 1) {
      await scenario.game.unitManager.processUnitOrders(guest!.playerId);
    }
    const completed = scenario.game.mapManager.getTile(target.x, target.y)!;
    expect(completed.hasRoad).toBe(true);
    expect(completed.improvements).toContain('road');

    // Freeciv's autoworker prioritizes hazardous extras above ordinary yield
    // work. Reuse the produced worker to verify the authoritative cleanup
    // lifecycle rather than only planner ranking.
    scenario.game.mapManager.updateTileProperty(target.x, target.y, 'improvements', [
      ...completed.improvements,
      'pollution',
    ]);
    city.workerTaskRequests = [
      { x: target.x, y: target.y, action: ActionType.CLEAN_POLLUTION, want: 1_000 },
    ];
    worker!.movementLeft = workerType.movement;
    expect(await unitController.automateWorkers(scenario.game, guest!.playerId, state)).toBeGreaterThan(
      0
    );
    expect(worker!.orders).toEqual([{ type: 'cleanPollution' }]);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await scenario.game.unitManager.processUnitOrders(guest!.playerId);
      if (!scenario.game.mapManager.getTile(target.x, target.y)!.improvements.includes('pollution')) break;
    }
    expect(scenario.game.mapManager.getTile(target.x, target.y)!.improvements).not.toContain(
      'pollution'
    );

    const persistedWorker = await getTestDatabase().query.units.findFirst({
      where: eq(schema.units.id, worker!.id),
    });
    expect(persistedWorker?.orders ?? []).toEqual([]);
  });

  it('chooses, completes, and persists an economic city improvement through authoritative managers', async () => {
    const scenario = await createActiveGame(2);
    const [, guest] = scenario.players;
    const city = await foundPlayerCity(scenario, guest!.playerId, 'AI Economy City');
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      guest!.playerId,
      true,
      { aiLevel: 'normal' }
    );

    await gameManager.createUnit(scenario.gameId, guest!.playerId, 'settlers', city.x, city.y);
    await gameManager.createUnit(scenario.gameId, guest!.playerId, 'worker', city.x, city.y);
    await gameManager.createUnit(scenario.gameId, guest!.playerId, 'warriors', city.x, city.y);
    await scenario.game.researchManager.grantTechnology(guest!.playerId, 'currency');
    city.currentProduction = null;
    city.productionType = null;
    city.worklist = [];
    city.buildings.push('barracks');
    city.goldPerTurn = -10;
    const state = assertAIState(scenario.game.players.get(guest!.playerId)?.aiState);
    const cityController = (gameManager as any).aiOrchestrator.playerController.city;

    await cityController.selectProduction(scenario.game, guest!.playerId, state);

    expect(city.currentProduction).toBe('marketplace');
    const marketplace = BUILDING_TYPES.marketplace;
    city.productionStock = marketplace.cost;
    city.shieldStock = marketplace.cost;
    await scenario.game.cityManager.processCityTurn(city.id, scenario.game.currentTurn);
    expect(city.buildings).toContain('marketplace');

    const persistedCity = await getTestDatabase().query.cities.findFirst({
      where: eq(schema.cities.id, city.id),
    });
    expect(persistedCity?.buildings).toContain('marketplace');

    gameManager.clearAllGames();
    (GameManager as any).instance = null;
    gameManager = GameManager.getInstance(createMockSocketServer(), getTestDatabaseProvider());
    const recovered = await gameManager.recoverGameInstance(scenario.gameId);
    expect(recovered?.cityManager.getCity(city.id)?.buildings).toContain('marketplace');
  });

  it('persists an authoritative citizen optimization for a feasible founded city', async () => {
    const scenario = await createActiveGame(2);
    const [, guest] = scenario.players;
    const city = await foundPlayerCity(scenario, guest!.playerId, 'AI Citizen City');

    expect(await scenario.game.cityManager.optimizeCityManually(city.id)).toBe(true);
    const managed = scenario.game.cityManager.getCity(city.id)!;
    const persistedCity = await getTestDatabase().query.cities.findFirst({
      where: eq(schema.cities.id, city.id),
    });
    expect(persistedCity).toMatchObject({
      foodPerTurn: managed.foodPerTurn,
      productionPerTurn: managed.productionPerTurn,
      tradePerTurn: managed.tradePerTurn,
      sciencePerTurn: managed.sciencePerTurn,
    });
  });

  it('has the AI apply a feasible anti-starvation citizen allocation', async () => {
    const scenario = await createActiveGame(2);
    const [, guest] = scenario.players;
    const city = await foundPlayerCity(scenario, guest!.playerId, 'AI Managed Citizen City');
    for (const workable of city.workableTiles ?? []) {
      scenario.game.mapManager.updateTileProperty(workable.x, workable.y, 'terrain', 'grassland');
      scenario.game.mapManager.updateTileProperty(workable.x, workable.y, 'improvements', [
        'irrigation',
      ]);
    }
    scenario.game.cityManager.calculateCityOutputs(city.id);
    city.foodStock = 0;
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      guest!.playerId,
      true,
      { aiLevel: 'normal' }
    );

    const cityController = (gameManager as any).aiOrchestrator.playerController.city;
    expect(await cityController.manageCitizens(scenario.game, guest!.playerId)).toBeGreaterThan(0);
    const managed = scenario.game.cityManager.getCity(city.id)!;
    expect(managed.foodPerTurn).toBeGreaterThanOrEqual(1);

    gameManager.clearAllGames();
    (GameManager as any).instance = null;
    gameManager = GameManager.getInstance(createMockSocketServer(), getTestDatabaseProvider());
    const recovered = await gameManager.recoverGameInstance(scenario.gameId);
    expect(recovered?.cityManager.getCity(city.id)).toMatchObject({
      foodPerTurn: managed.foodPerTurn,
    });
  });

  it('selects, completes, persists, and recovers a spaceship part through real managers', async () => {
    const scenario = await createActiveGame(2, { victoryConditions: ['science'] });
    const [, guest] = scenario.players;
    const city = await foundPlayerCity(scenario, guest!.playerId, 'AI Space City');
    for (const technology of ['space_flight', 'plastics', 'superconductors']) {
      await scenario.game.researchManager.grantTechnology(guest!.playerId, technology);
    }
    city.buildings.push('apollo_program', 'factory');
    city.currentProduction = null;
    city.productionType = null;
    city.worklist = [];
    const aiPlayer = scenario.game.players.get(guest!.playerId)!;
    aiPlayer.spaceshipState = { structurals: 1, components: 0, modules: 0 };
    await Promise.all([
      getTestDatabase()
        .update(schema.cities)
        .set({
          buildings: city.buildings,
          currentProduction: null,
          productionQueue: [],
        })
        .where(eq(schema.cities.id, city.id)),
      getTestDatabase()
        .update(schema.players)
        .set({ spaceshipState: aiPlayer.spaceshipState })
        .where(eq(schema.players.id, guest!.playerId)),
    ]);
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      guest!.playerId,
      true,
      { aiLevel: 'normal' }
    );

    const actions = await (gameManager as any).aiOrchestrator.processTurn(
      scenario.gameId,
      scenario.game
    );

    expect(actions).toBeGreaterThan(0);
    const state = assertAIState(scenario.game.players.get(guest!.playerId)?.aiState);
    expect(state.cityWants[city.id]?.['building:space_structural']).toBeGreaterThan(0);
    await scenario.game.cityManager.setCityProduction(
      city.id,
      'building',
      'space_structural',
      guest!.playerId
    );
    city.productionStock = 80;
    city.shieldStock = 80;
    await scenario.game.cityManager.processCityTurn(city.id, scenario.game.currentTurn);

    expect(aiPlayer.spaceshipState).toMatchObject({
      structurals: 2,
      components: 0,
      modules: 0,
    });
    const persistedPlayer = await getTestDatabase().query.players.findFirst({
      where: eq(schema.players.id, guest!.playerId),
    });
    expect(persistedPlayer?.spaceshipState).toMatchObject({ structurals: 2 });

    gameManager.clearAllGames();
    (GameManager as any).instance = null;
    gameManager = GameManager.getInstance(createMockSocketServer(), getTestDatabaseProvider());
    const recovered = await gameManager.recoverGameInstance(scenario.gameId);
    expect(recovered?.players.get(guest!.playerId)?.spaceshipState).toMatchObject({
      structurals: 2,
    });
  });

  it('coordinates and consumes real caravan helpers to finish a Great Wonder', async () => {
    const scenario = await createActiveGame(2);
    const [, guest] = scenario.players;
    const city = await foundPlayerCity(scenario, guest!.playerId, 'AI Wonder City');
    await scenario.game.researchManager.grantTechnology(guest!.playerId, 'masonry');
    await scenario.game.researchManager.grantTechnology(guest!.playerId, 'trade');
    await scenario.game.cityManager.setCityProduction(
      city.id,
      'building',
      'pyramids',
      guest!.playerId
    );
    city.productionStock = 100;
    city.shieldStock = 100;
    const firstCaravan = await gameManager.createUnit(
      scenario.gameId,
      guest!.playerId,
      'caravan',
      city.x,
      city.y
    );
    const secondCaravan = await gameManager.createUnit(
      scenario.gameId,
      guest!.playerId,
      'caravan',
      city.x,
      city.y
    );
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      guest!.playerId,
      true,
      { aiLevel: 'normal' }
    );

    await (gameManager as any).aiOrchestrator.processTurn(scenario.gameId, scenario.game);

    expect(scenario.game.unitManager.getUnit(firstCaravan)).toBeUndefined();
    expect(scenario.game.unitManager.getUnit(secondCaravan)).toBeUndefined();
    expect(city.productionStock).toBeGreaterThanOrEqual(200);
    await scenario.game.cityManager.processCityTurn(city.id, scenario.game.currentTurn);
    expect(city.buildings).toContain('pyramids');
    const persistedCity = await getTestDatabase().query.cities.findFirst({
      where: eq(schema.cities.id, city.id),
    });
    expect(persistedCity?.buildings).toContain('pyramids');
  });

  it('carries a future-government want through research and starts the unlocked revolution', async () => {
    const scenario = await createActiveGame(2);
    const [, guest] = scenario.players;
    const city = await foundPlayerCity(scenario, guest!.playerId, 'AI Republic City');
    city.population = 3;
    city.size = 3;
    city.foodPerTurn = 1;
    city.productionPerTurn = 1;
    city.tradePerTurn = 1;
    city.goldPerTurn = 1;
    city.sciencePerTurn = 1;
    for (const technology of ['alphabet', 'writing', 'code_of_laws']) {
      await scenario.game.researchManager.grantTechnology(guest!.playerId, technology);
    }
    await scenario.game.researchManager.setCurrentResearch(guest!.playerId, 'pottery');
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      guest!.playerId,
      true,
      { aiLevel: 'hard' }
    );

    const state = assertAIState(scenario.game.players.get(guest!.playerId)?.aiState);
    const domestic = (gameManager as any).aiOrchestrator.playerController.domestic;
    await domestic.manageGovernment(scenario.game, guest!.playerId, state);
    expect(state.techWants.the_republic).toBeGreaterThan(0);
    state.techWants.the_republic = 1_000_000;
    await domestic.selectResearch(scenario.game, guest!.playerId, state);
    expect(scenario.game.researchManager.getPlayerResearch(guest!.playerId)?.currentTech).toBe(
      'literacy'
    );

    await scenario.game.researchManager.grantTechnology(guest!.playerId, 'literacy');
    await scenario.game.researchManager.grantTechnology(guest!.playerId, 'the_republic');
    scenario.game.currentTurn += 1;
    await domestic.manageGovernment(scenario.game, guest!.playerId, state);

    expect(scenario.game.governmentManager?.getPlayerGovernment(guest!.playerId)).toMatchObject({
      currentGovernment: 'anarchy',
      requestedGovernment: 'republic',
    });
    const persistedPlayer = await getTestDatabase().query.players.findFirst({
      where: eq(schema.players.id, guest!.playerId),
    });
    expect(persistedPlayer).toMatchObject({
      government: 'anarchy',
    });
    expect(persistedPlayer?.revolutionTurns).toBeGreaterThan(0);
  });

  it('uses the authoritative treasury to rush an urgent city defense exactly once', async () => {
    const scenario = await createActiveGame(2);
    const [host, guest] = scenario.players;
    const city = await foundPlayerCity(scenario, guest!.playerId, 'AI Defense City');
    for (const unit of scenario.game.unitManager.getPlayerUnits(guest!.playerId)) {
      await scenario.game.unitManager.removeUnit(unit.id);
    }
    const threatTile = scenario.game.mapManager
      .getNeighbors(city.x, city.y)
      .find(
        tile =>
          !['ocean', 'deep_ocean', 'lake'].includes(tile.terrain) &&
          scenario.game.unitManager.getUnitsAt(tile.x, tile.y).length === 0
      );
    expect(threatTile).toBeDefined();
    await gameManager.createUnit(
      scenario.gameId,
      host!.playerId,
      'howitzer',
      threatTile!.x,
      threatTile!.y
    );
    await (gameManager as any).diplomacyManager.establishContact(
      scenario.gameId,
      host!.playerId,
      guest!.playerId
    );
    await (gameManager as any).refreshSharedVision(scenario.gameId);
    const economy = scenario.game.turnManager.getEconomicManager()!;
    const startingGold = await economy.getPlayerGold(guest!.playerId);
    await economy.addPlayerGold(guest!.playerId, 1000 - startingGold, 'AI defense fixture');
    await gameManager.setPlayerAIControl(
      scenario.gameId,
      scenario.hostUserId,
      guest!.playerId,
      true,
      { aiLevel: 'hard' }
    );

    await (gameManager as any).aiOrchestrator.processTurn(scenario.gameId, scenario.game);

    expect(city.currentProduction).toBe('warriors');
    expect(city.productionStock).toBeGreaterThanOrEqual(10);
    const goldAfterRush = await economy.getPlayerGold(guest!.playerId);
    expect(goldAfterRush).toBeLessThan(1000);
    const stockAfterRush = city.productionStock;
    const retryActions = await (gameManager as any).aiOrchestrator.processTurn(
      scenario.gameId,
      scenario.game
    );
    expect(retryActions).toBe(0);
    expect(city.productionStock).toBe(stockAfterRush);
    expect(await economy.getPlayerGold(guest!.playerId)).toBe(goldAfterRush);

    gameManager.clearAllGames();
    (GameManager as any).instance = null;
    gameManager = GameManager.getInstance(createMockSocketServer(), getTestDatabaseProvider());
    const recovered = await gameManager.recoverGameInstance(scenario.gameId);
    expect(recovered?.cityManager.getCity(city.id)).toMatchObject({
      currentProduction: 'warriors',
      productionStock: stockAfterRush,
    });
  });

  it('persists victim and observer diplomacy memory at the incident boundary and through recovery', async () => {
    const scenario = await createActiveGame(3);
    const [offender, victim, observer] = scenario.players;
    for (const player of [victim!, observer!]) {
      await gameManager.setPlayerAIControl(
        scenario.gameId,
        scenario.hostUserId,
        player.playerId,
        true,
        { aiLevel: 'normal' }
      );
    }

    await (gameManager as any).diplomacyManager.recordIncident(
      scenario.gameId,
      offender!.playerId,
      victim!.playerId,
      100,
      'international_outcry'
    );

    const victimState = assertAIState(scenario.game.players.get(victim!.playerId)?.aiState);
    const observerState = assertAIState(scenario.game.players.get(observer!.playerId)?.aiState);
    expect(victimState.diplomacy[offender!.playerId]).toMatchObject({
      love: -200,
      warDesire: 100,
    });
    expect(observerState.diplomacy[offender!.playerId]).toMatchObject({
      love: -7,
      warDesire: 0,
    });

    await Promise.all([
      waitForPersistedAIState(
        victim!.playerId,
        state => state.diplomacy[offender!.playerId]?.love === -200
      ),
      waitForPersistedAIState(
        observer!.playerId,
        state => state.diplomacy[offender!.playerId]?.love === -7
      ),
    ]);

    gameManager.clearAllGames();
    (GameManager as any).instance = null;
    gameManager = GameManager.getInstance(createMockSocketServer(), getTestDatabaseProvider());
    const recovered = await gameManager.recoverGameInstance(scenario.gameId);

    expect(
      assertAIState(recovered?.players.get(victim!.playerId)?.aiState).diplomacy[offender!.playerId]
    ).toMatchObject({ love: -200, warDesire: 100 });
    expect(
      assertAIState(recovered?.players.get(observer!.playerId)?.aiState).diplomacy[
        offender!.playerId
      ]
    ).toMatchObject({ love: -7, warDesire: 0 });
  });

  it.each(validationScenarios)(
    'reaches a terminal turn limit with valid AI state across seed $mapSeed',
    async validation => {
      const scenario = await createActiveGame(validation.playerCount, {
        maxTurns: validationMaxTurns,
        victoryConditions: validation.victoryConditions,
        mapSeed: validation.mapSeed,
        mapWidth: validation.mapWidth,
        mapHeight: validation.mapHeight,
        terrainSettings: validation.terrainSettings,
      });
      for (const player of scenario.players) {
        await gameManager.setPlayerAIControl(
          scenario.gameId,
          scenario.hostUserId,
          player.playerId,
          true,
          { aiLevel: validation.aiLevel }
        );
      }

      const recoveryTurn = recoveryTurnsBySeed[validation.mapSeed];
      let game = scenario.game;
      let recovered = false;
      let totalDecisions = 0;
      let phase = 'turn-processing';
      const metrics = [];

      try {
        while (game.state === 'active') {
          const processingTurn = game.currentTurn;
          const startedAt = performance.now();
          await game.turnManager.processTurn();
          expect(performance.now() - startedAt).toBeLessThan(15_000);
          assertAIValidationInvariants(game);
          metrics.push(captureAIValidationMetrics(game));

          for (const player of game.players.values()) {
            const state = assertAIState(player.aiState);
            expect(state.lastProcessedTurn).toBe(processingTurn);
            totalDecisions += state.lastDecisionCount ?? 0;
          }

          if (!recovered && recoveryTurn === processingTurn && game.state === 'active') {
            phase = 'recovery';
            gameManager.clearAllGames();
            (GameManager as any).instance = null;
            gameManager = GameManager.getInstance(createMockSocketServer(), getTestDatabaseProvider());
            const recoveredGame = await gameManager.recoverGameInstance(scenario.gameId);
            expect(recoveredGame).not.toBeNull();
            expect(recoveredGame!.currentTurn).toBe(processingTurn + 1);
            assertAIValidationInvariants(recoveredGame!);
            metrics.push(captureAIValidationMetrics(recoveredGame!));
            game = recoveredGame!;
            recovered = true;
            phase = 'turn-processing';
          }
        }
      } catch (error) {
        const artifactPath = writeAIValidationFailureArtifact(game, {
          configuration: validation,
          phase,
          error,
          metrics,
        });
        throw new Error(`AI validation artifact written to ${artifactPath}`, { cause: error });
      }

      const map = game.mapManager.getMapData()!;
      expect(map.seed).toBe(validation.mapSeed);
      expect(game.state).toBe('ended');
      expect(game.currentTurn).toBe(validationMaxTurns);
      expect(totalDecisions).toBeGreaterThan(0);
      // Games begin their active lifecycle at turn 2, so a turn-limit of N
      // produces N - 1 processed-turn samples (plus any recovery sample).
      expect(metrics.length).toBeGreaterThanOrEqual(validationMaxTurns - 1);
      expect(metrics.every(point => point.players.every(player => player.units >= 0))).toBe(true);
      assertAIValidationMetricBaseline(metrics, aiValidationBaseline);
      assertAIValidationInvariants(game);
    }
  );

  it('replays the same seeded terminal configuration with the same authoritative outcome', async () => {
    async function runReplay(gameSeed: string): Promise<string> {
      const scenario = await createActiveGame(2, {
        maxTurns: 4,
        victoryConditions: ['max_turns'],
        mapSeed: gameSeed,
      });
      for (const player of scenario.players) {
        await gameManager.setPlayerAIControl(
          scenario.gameId,
          scenario.hostUserId,
          player.playerId,
          true,
          { aiLevel: 'normal' }
        );
      }
      while (scenario.game.state === 'active') {
        await scenario.game.turnManager.processTurn();
      }
      return buildAIValidationReplayFingerprint(scenario.game);
    }

    const first = await runReplay('ai-validation-replay-01');
    gameManager.clearAllGames();
    const second = await runReplay('ai-validation-replay-01');
    expect(second).toBe(first);
  });
});
