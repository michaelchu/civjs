import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from '../../src/database/schema';
// Import logger with fallback for mocked scenarios
let logger: {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const loggerModule = require('../../src/utils/logger');
  logger = loggerModule.logger || loggerModule.default;
} catch {
  // Fallback logger for tests
  logger = {
    info: (...args: unknown[]) => {
      // eslint-disable-next-line no-console
      console.log('[TEST INFO]', ...args);
    },
    error: (...args: unknown[]) => {
      // eslint-disable-next-line no-console
      console.error('[TEST ERROR]', ...args);
    },
    debug: (...args: unknown[]) => {
      // eslint-disable-next-line no-console
      console.debug('[TEST DEBUG]', ...args);
    },
  };
}

import { DatabaseProvider } from '../../src/database/DatabaseProvider';

/**
 * Test database provider for integration tests
 * Provides isolated database instances for testing
 */
export class TestDatabaseProvider implements DatabaseProvider {
  private database: ReturnType<typeof drizzle<typeof schema>>;

  constructor(database: ReturnType<typeof drizzle<typeof schema>>) {
    this.database = database;
  }

  getDatabase() {
    return this.database;
  }

  async testConnection(): Promise<boolean> {
    try {
      // Access the underlying postgres client for connection testing
      const queryClient = (this.database as any)._.session.client;
      await queryClient`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async closeConnection(): Promise<void> {
    try {
      const queryClient = (this.database as any)._.session.client;
      await queryClient.end();
    } catch (error) {
      logger.error('Error closing test database connection:', error);
    }
  }
}

// UUID generator for tests
export function generateTestUUID(suffix: string): string {
  // Generate a valid UUID with better randomness
  const timestamp = Date.now().toString(16).slice(-6); // Last 6 hex digits
  const random = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0'); // 6 hex digits
  const paddedSuffix = suffix.padStart(2, '0');
  // Format: 550e8400-e29b-41d4-a716-ssttttttrrrrrrr (12 chars total after last dash)
  return `550e8400-e29b-41d4-a716-${paddedSuffix}${timestamp}${random}`.slice(0, 36);
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

  // Create test user (handle duplicates in CI/CD)
  let user: typeof schema.users.$inferSelect;
  try {
    [user] = await testDb
      .insert(schema.users)
      .values({
        id: userId,
        username: `TestUser${playerIdSuffix}_${Date.now()}`,
        email: `test${playerIdSuffix}_${Date.now()}@example.com`,
        passwordHash: 'test-hash',
      })
      .returning();
  } catch (error) {
    // Try to find existing user
    const existing = await testDb.query.users.findFirst({
      where: (users, { eq }) => eq(users.id, userId),
    });

    if (existing) {
      user = existing;
    } else {
      throw new Error(`Failed to create or find test user: ${error}`);
    }
  }

  // Create test game
  const [game] = await testDb
    .insert(schema.games)
    .values({
      id: gameId,
      name: `Test Game ${gameIdSuffix}`,
      hostId: user.id, // Use actual user.id instead of userId
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
      gameId: game.id, // Use actual game.id
      userId: user.id, // Use actual user.id
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
    logger.error('Test database not available - integration tests will be skipped');
    
    // Create a mock database provider that throws helpful errors
    const mockError = new Error(
      'Integration tests require a PostgreSQL database. ' +
      'Set TEST_DATABASE_URL environment variable or start local PostgreSQL with test database.'
    );
    
    throw mockError;
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

/**
 * Get a TestDatabaseProvider instance for dependency injection
 */
export function getTestDatabaseProvider(): TestDatabaseProvider {
  const db = getTestDatabase();
  return new TestDatabaseProvider(db);
}

export async function clearAllTables() {
  if (!testDb) return;

  try {
    // Clear all tables in dependency order (child tables first, then parent tables)
    await testDb.delete(schema.units);
    await testDb.delete(schema.cities);
    await testDb.delete(schema.playerTechs);
    await testDb.delete(schema.research);
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
