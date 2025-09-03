import { getTestDatabase, generateTestUUID } from '../utils/testDatabase';
import * as schema from '../../src/database/schema';
import { eq, inArray } from 'drizzle-orm';
import { MapManager } from '../../src/game/MapManager';
import { PlayerState } from '../../src/game/GameManager';

export interface TestGameScenario {
  game: typeof schema.games.$inferSelect;
  players: (typeof schema.players.$inferSelect)[];
  cities: (typeof schema.cities.$inferSelect)[];
  units: (typeof schema.units.$inferSelect)[];
}

async function generateMapDataForTests(
  width: number,
  height: number,
  players: Map<string, PlayerState>
): Promise<{ mapData: any; mapSeed: string }> {
  const mapManager = new MapManager(width, height, undefined, 'test-generator');
  await mapManager.generateMap(players);

  const mapData = mapManager.getMapData();
  const mapSeed = mapManager.getSeed();

  if (!mapData) {
    throw new Error('Failed to generate map data for test scenario');
  }

  return { mapData, mapSeed };
}

export async function createBasicGameScenario(): Promise<TestGameScenario> {
  const db = getTestDatabase();

  const userId1 = generateTestUUID('1001');
  const userId2 = generateTestUUID('1002');
  const gameId = generateTestUUID('2001');
  const playerId1 = generateTestUUID('3001');
  const playerId2 = generateTestUUID('3002');
  const cityId1 = generateTestUUID('4001');
  const cityId2 = generateTestUUID('4002');
  const unitId1 = generateTestUUID('5001');
  const unitId2 = generateTestUUID('5002');
  const unitId3 = generateTestUUID('5003');

  // Create players map for map generation
  const playersMap = new Map<string, PlayerState>([
    [
      playerId1,
      {
        id: playerId1,
        userId: userId1,
        playerNumber: 0,
        civilization: 'Roman',
        isReady: true,
        hasEndedTurn: false,
        isConnected: true,
        lastSeen: new Date(),
      },
    ],
    [
      playerId2,
      {
        id: playerId2,
        userId: userId2,
        playerNumber: 1,
        civilization: 'Greek',
        isReady: true,
        hasEndedTurn: false,
        isConnected: true,
        lastSeen: new Date(),
      },
    ],
  ]);

  // Generate map data
  const { mapData, mapSeed } = await generateMapDataForTests(20, 20, playersMap);

  // Create test users (ensure they exist)
  let users: (typeof schema.users.$inferSelect)[];
  try {
    users = await db
      .insert(schema.users)
      .values([
        {
          id: userId1,
          username: `Player1_${Date.now()}`, // Make unique for CI/CD
          email: `player1_${Date.now()}@test.com`,
          passwordHash: 'hash1',
        },
        {
          id: userId2,
          username: `Player2_${Date.now()}`,
          email: `player2_${Date.now()}@test.com`,
          passwordHash: 'hash2',
        },
      ])
      .returning();
  } catch (error) {
    // If users already exist, fetch them
    try {
      const existingUsers = await db
        .select()
        .from(schema.users)
        .where(inArray(schema.users.id, [userId1, userId2]));

      if (existingUsers.length === 2) {
        users = existingUsers;
      } else {
        throw new Error(`Failed to create or find test users: ${error}`);
      }
    } catch (queryError) {
      throw new Error(`Failed to create or find test users: ${error}, Query error: ${queryError}`);
    }
  }

  // Create game with map data
  const [game] = await db
    .insert(schema.games)
    .values({
      id: gameId,
      name: 'Basic Test Game',
      hostId: users[0].id,
      status: 'active',
      maxPlayers: 2,
      mapWidth: 20,
      mapHeight: 20,
      ruleset: 'classic',
      currentTurn: 1,
      turnTimeLimit: 300,
      mapData: mapData,
      mapSeed: mapSeed,
    })
    .returning();

  // Create players
  const players = await db
    .insert(schema.players)
    .values([
      {
        id: playerId1,
        gameId: game.id,
        userId: users[0].id,
        playerNumber: 0,
        nation: 'romans',
        civilization: 'Roman',
        leaderName: 'Caesar',
        color: { r: 255, g: 0, b: 0 },
        isReady: true,
        hasEndedTurn: false,
        gold: 50,
        science: 10,
        culture: 5,
      },
      {
        id: playerId2,
        gameId: game.id,
        userId: users[1].id,
        playerNumber: 1,
        nation: 'greeks',
        civilization: 'Greek',
        leaderName: 'Alexander',
        color: { r: 0, g: 0, b: 255 },
        isReady: true,
        hasEndedTurn: false,
        gold: 50,
        science: 10,
        culture: 5,
      },
    ])
    .returning();

  // Create cities
  const cities = await db
    .insert(schema.cities)
    .values([
      {
        id: cityId1,
        gameId: game.id,
        playerId: players[0].id,
        name: 'Rome',
        x: 10,
        y: 10,
        population: 2,
        food: 5,
        foodPerTurn: 3,
        production: 2,
        productionPerTurn: 2,
        goldPerTurn: 2,
        sciencePerTurn: 1,
        culturePerTurn: 1,
        buildings: ['palace'],
        workedTiles: [
          { x: 10, y: 10 },
          { x: 11, y: 10 },
          { x: 10, y: 11 },
        ],
        isCapital: true,
        defenseStrength: 2,
        happiness: 60,
        health: 100,
        foundedTurn: 1,
      },
      {
        id: cityId2,
        gameId: game.id,
        playerId: players[1].id,
        name: 'Athens',
        x: 15,
        y: 15,
        population: 1,
        food: 2,
        foodPerTurn: 2,
        production: 1,
        productionPerTurn: 1,
        goldPerTurn: 1,
        sciencePerTurn: 1,
        culturePerTurn: 1,
        buildings: [],
        workedTiles: [{ x: 15, y: 15 }],
        isCapital: true,
        defenseStrength: 1,
        happiness: 50,
        health: 100,
        foundedTurn: 1,
      },
    ])
    .returning();

  // Create units
  const units = await db
    .insert(schema.units)
    .values([
      {
        id: unitId1,
        gameId: game.id,
        playerId: players[0].id,
        unitType: 'warrior',
        x: 11,
        y: 11,
        health: 100,
        attackStrength: 20,
        defenseStrength: 20,
        movementPoints: '6',
        maxMovementPoints: '6',
        veteranLevel: 0,
        isFortified: false,
        createdTurn: 1,
      },
      {
        id: unitId2,
        gameId: game.id,
        playerId: players[0].id,
        unitType: 'settler',
        x: 9,
        y: 10,
        health: 100,
        attackStrength: 0,
        defenseStrength: 10,
        movementPoints: '3',
        maxMovementPoints: '3',
        veteranLevel: 0,
        isFortified: false,
        createdTurn: 1,
      },
      {
        id: unitId3,
        gameId: game.id,
        playerId: players[1].id,
        unitType: 'warrior',
        x: 16,
        y: 15,
        health: 100,
        attackStrength: 20,
        defenseStrength: 20,
        movementPoints: '6',
        maxMovementPoints: '6',
        veteranLevel: 0,
        isFortified: false,
        createdTurn: 1,
      },
    ])
    .returning();

  return { game, players, cities, units };
}

export async function createCityGrowthScenario(): Promise<TestGameScenario> {
  const basic = await createBasicGameScenario();

  const db = getTestDatabase();

  // Update city with growth conditions
  const [updatedCity] = await db
    .update(schema.cities)
    .set({
      population: 3,
      food: 15, // Close to growth threshold
      foodPerTurn: 4, // Surplus for growth
      workedTiles: [
        { x: 10, y: 10 }, // City center
        { x: 11, y: 10 }, // High food tile
        { x: 10, y: 11 }, // High food tile
        { x: 9, y: 10 }, // Additional worked tile
      ],
    })
    .where(eq(schema.cities.id, basic.cities[0].id))
    .returning();

  return {
    ...basic,
    cities: [updatedCity, basic.cities[1]],
  };
}

export async function createCombatScenario(): Promise<TestGameScenario> {
  const basic = await createBasicGameScenario();

  const db = getTestDatabase();

  // Position units for combat (adjacent)
  const [updatedUnit1] = await db
    .update(schema.units)
    .set({ x: 12, y: 12 })
    .where(eq(schema.units.id, basic.units[0].id))
    .returning(); // Roman warrior

  const [updatedUnit3] = await db
    .update(schema.units)
    .set({ x: 13, y: 12 })
    .where(eq(schema.units.id, basic.units[2].id))
    .returning(); // Greek warrior

  return {
    ...basic,
    units: [updatedUnit1, basic.units[1], updatedUnit3],
  };
}

export async function createProductionScenario(): Promise<TestGameScenario> {
  const basic = await createBasicGameScenario();

  const db = getTestDatabase();

  // Set city to be producing a warrior
  const [updatedCity] = await db
    .update(schema.cities)
    .set({
      currentProduction: 'warrior',
      production: 15, // Almost complete (warrior costs 20)
      productionPerTurn: 3,
    })
    .where(eq(schema.cities.id, basic.cities[0].id))
    .returning();

  return {
    ...basic,
    cities: [updatedCity, basic.cities[1]],
  };
}
