import { getTestDatabase } from '../utils/testDatabase';
import { schema } from '../../src/database';
import { eq } from 'drizzle-orm';

export interface TestGameScenario {
  game: typeof schema.games.$inferSelect;
  players: (typeof schema.players.$inferSelect)[];
  cities: (typeof schema.cities.$inferSelect)[];
  units: (typeof schema.units.$inferSelect)[];
}

export async function createBasicGameScenario(): Promise<TestGameScenario> {
  const db = getTestDatabase();

  // Create test users
  const users = await db
    .insert(schema.users)
    .values([
      {
        id: 'user-1',
        username: 'Player1',
        email: 'player1@test.com',
        passwordHash: 'hash1',
      },
      {
        id: 'user-2',
        username: 'Player2',
        email: 'player2@test.com',
        passwordHash: 'hash2',
      },
    ])
    .returning();

  // Create game
  const [game] = await db
    .insert(schema.games)
    .values({
      id: 'game-basic',
      name: 'Basic Test Game',
      hostId: users[0].id,
      status: 'active',
      maxPlayers: 2,
      mapWidth: 20,
      mapHeight: 20,
      ruleset: 'classic',
      currentTurn: 1,
      turnTimeLimit: 300,
    })
    .returning();

  // Create players
  const players = await db
    .insert(schema.players)
    .values([
      {
        id: 'player-1',
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
        id: 'player-2',
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
        id: 'city-1',
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
        id: 'city-2',
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
        id: 'unit-1',
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
        id: 'unit-2',
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
        id: 'unit-3',
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
