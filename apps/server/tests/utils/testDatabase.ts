import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from '../../src/database/schema';
import { logger } from '../../src/utils/logger';

// UUID generator for tests
export function generateTestUUID(suffix: string): string {
  const base = '550e8400-e29b-41d4-a716-44665544';
  const paddedSuffix = suffix.padStart(4, '0');
  return `${base}${paddedSuffix}`;
}

// Create test game and player for unit tests
export async function createTestGameAndPlayer(
  gameIdSuffix: string = '0001',
  playerIdSuffix: string = '0002'
) {
  if (!testDb) throw new Error('Test database not initialized');

  const gameId = generateTestUUID(gameIdSuffix);
  const playerId = generateTestUUID(playerIdSuffix);
  const userId = generateTestUUID(playerIdSuffix.replace('2', '1')); // Derive user ID from player ID

  // Create test user
  const [user] = await testDb
    .insert(schema.users)
    .values({
      id: userId,
      username: `TestUser${playerIdSuffix}`,
      email: `test${playerIdSuffix}@example.com`,
      passwordHash: 'test-hash',
    })
    .returning();

  // Create test game
  const [game] = await testDb
    .insert(schema.games)
    .values({
      id: gameId,
      name: `Test Game ${gameIdSuffix}`,
      hostId: userId,
      status: 'active',
      maxPlayers: 4,
      mapWidth: 80,
      mapHeight: 50,
      ruleset: 'classic',
      currentTurn: 1,
      turnTimeLimit: 300,
    })
    .returning();

  // Create test player
  const [player] = await testDb
    .insert(schema.players)
    .values({
      id: playerId,
      gameId: gameId,
      userId: userId,
      playerNumber: 0,
      nation: 'romans',
      civilization: 'Roman',
      leaderName: 'Caesar',
      color: { r: 255, g: 0, b: 0 },
      isReady: true,
      hasEndedTurn: false,
      gold: 100,
      science: 10,
      culture: 5,
    })
    .returning();

  return { game, player, user };
}

// Test database connection string
const testConnectionString =
  process.env.TEST_DATABASE_URL || 'postgresql://civjs_test:civjs_test@localhost:5432/civjs_test';

// Create test database connection
let testQueryClient: postgres.Sql | null = null;
let testDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

export async function setupTestDatabase() {
  try {
    // Create connection
    testQueryClient = postgres(testConnectionString, {
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {}, // Suppress notices in tests
    });

    // Create drizzle instance
    testDb = drizzle(testQueryClient, { schema });

    // Test connection
    await testQueryClient`SELECT 1`;
    logger.info('Test database connection established');

    // Run migrations
    await migrate(testDb, { migrationsFolder: './drizzle' });
    logger.info('Test database migrations completed');

    return testDb;
  } catch (error) {
    logger.error('Failed to setup test database:', error);
    throw error;
  }
}

export async function cleanupTestDatabase() {
  if (testQueryClient) {
    await testQueryClient.end();
    testQueryClient = null;
    testDb = null;
    logger.info('Test database connection closed');
  }
}

export function getTestDatabase() {
  if (!testDb) {
    throw new Error('Test database not initialized. Call setupTestDatabase() first.');
  }
  return testDb;
}

export async function clearAllTables() {
  if (!testDb) return;

  try {
    // Clear all tables in dependency order
    await testDb.delete(schema.units);
    await testDb.delete(schema.cities);
    await testDb.delete(schema.players);
    await testDb.delete(schema.gameTurns);
    await testDb.delete(schema.games);
    await testDb.delete(schema.users);

    logger.debug('All test database tables cleared');
  } catch (error) {
    logger.error('Failed to clear test database tables:', error);
    throw error;
  }
}

export async function seedTestData() {
  if (!testDb) return;

  try {
    // Insert test user
    const [testUser] = await testDb
      .insert(schema.users)
      .values({
        id: 'test-user-1',
        username: 'TestPlayer',
        email: 'test@example.com',
        passwordHash: 'test-hash',
      })
      .returning();

    // Insert test game
    const [testGame] = await testDb
      .insert(schema.games)
      .values({
        id: 'test-game-1',
        name: 'Test Game',
        hostId: testUser.id,
        status: 'waiting',
        maxPlayers: 4,
        mapWidth: 20,
        mapHeight: 20,
        ruleset: 'classic',
        turnTimeLimit: 300,
      })
      .returning();

    // Insert test player
    const [testPlayer] = await testDb
      .insert(schema.players)
      .values({
        id: 'test-player-1',
        gameId: testGame.id,
        userId: testUser.id,
        playerNumber: 0,
        nation: 'romans',
        civilization: 'Roman',
        leaderName: 'Caesar',
        color: { r: 255, g: 0, b: 0 },
        isReady: true,
        hasEndedTurn: false,
        gold: 100,
        science: 10,
        culture: 5,
      })
      .returning();

    logger.debug('Test database seeded with basic data');

    return {
      user: testUser,
      game: testGame,
      player: testPlayer,
    };
  } catch (error) {
    logger.error('Failed to seed test database:', error);
    throw error;
  }
}
