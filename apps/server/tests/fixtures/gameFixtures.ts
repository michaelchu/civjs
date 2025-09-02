import { getTestDatabase } from '../utils/testDatabase';
import { schema } from '../../src/database';

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
        hashedPassword: 'hash1',
      },
      {
        id: 'user-2',
        username: 'Player2',
        email: 'player2@test.com',
        hashedPassword: 'hash2',
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
      currentPlayers: 2,
      mapWidth: 20,
      mapHeight: 20,
      ruleset: 'classic',
      currentTurn: 1,
      currentYear: -4000,
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
        nation: 'romans',
        color: '#ff0000',
        isReady: true,
        turnEnded: false,
        gold: 50,
        science: 10,
        culture: 5,
        lastActiveAt: new Date(),
      },
      {
        id: 'player-2',
        gameId: game.id,
        userId: users[1].id,
        nation: 'greeks',
        color: '#0000ff',
        isReady: true,
        turnEnded: false,
        gold: 50,
        science: 10,
        culture: 5,
        lastActiveAt: new Date(),
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
        movementPoints: '6',
        veteranLevel: 0,
        isFortified: false,
      },
      {
        id: 'unit-2',
        gameId: game.id,
        playerId: players[0].id,
        unitType: 'settler',
        x: 9,
        y: 10,
        health: 100,
        movementPoints: '3',
        veteranLevel: 0,
        isFortified: false,
      },
      {
        id: 'unit-3',
        gameId: game.id,
        playerId: players[1].id,
        unitType: 'warrior',
        x: 16,
        y: 15,
        health: 100,
        movementPoints: '6',
        veteranLevel: 0,
        isFortified: false,
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
    .where(schema.cities.id.eq(basic.cities[0].id))
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
  await db.update(schema.units).set({ x: 12, y: 12 }).where(schema.units.id.eq(basic.units[0].id)); // Roman warrior

  await db.update(schema.units).set({ x: 13, y: 12 }).where(schema.units.id.eq(basic.units[2].id)); // Greek warrior

  return basic;
}

export async function createProductionScenario(): Promise<TestGameScenario> {
  const basic = await createBasicGameScenario();

  const db = getTestDatabase();

  // Set city to be producing a warrior
  const [updatedCity] = await db
    .update(schema.cities)
    .set({
      currentProduction: 'warrior',
      productionType: 'unit',
      production: 15, // Almost complete (warrior costs 20)
      productionPerTurn: 3,
    })
    .where(schema.cities.id.eq(basic.cities[0].id))
    .returning();

  return {
    ...basic,
    cities: [updatedCity, basic.cities[1]],
  };
}
