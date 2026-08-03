import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomBytes } from 'crypto';
import * as schema from '@database/schema';
// Import logger with fallback for mocked scenarios
let logger: {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
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
    warn: (...args: unknown[]) => {
      // eslint-disable-next-line no-console
      console.warn('[TEST WARN]', ...args);
    },
  };
}

import { DatabaseProvider } from '@database/DatabaseProvider';

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

// UUID generator for tests - uses crypto for guaranteed uniqueness
export function generateTestUUID(): string {
  // Generate a UUID v4 using crypto - cryptographically secure and collision-proof
  const bytes = randomBytes(16);

  // Set version (4) and variant bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10

  // Format as UUID string
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

// Helper function to create a test user with raw SQL
async function createUserWithRawSQL(userId: string, username: string, email: string) {
  if (!testQueryClient) {
    throw new Error('Test database client not available');
  }

  const rawResult = await testQueryClient`
    INSERT INTO users (id, username, email, password_hash, is_guest, is_active, last_seen, created_at, updated_at, games_played, games_won, total_score, settings)
    VALUES (${userId}, ${username}, ${email}, 'test-hash', false, true, now(), now(), now(), 0, 0, 0, '{}'::jsonb)
    RETURNING *
  `;

  if (rawResult && rawResult.length > 0) {
    return rawResult[0] as typeof schema.users.$inferSelect;
  }
  return undefined;
}

// Helper function to handle user creation error on final attempt
async function handleFinalUserCreationError(
  error: unknown,
  userId: string,
  username: string,
  email: string,
  maxRetries: number
) {
  if (!testDb) throw new Error('Test database not initialized');

  // Try to find the user in case of unique constraint violation
  const retryUser = await testDb.query.users.findFirst({
    where: (users, { eq }) => eq(users.id, userId),
  });

  if (retryUser) {
    logger.info('Found existing user after constraint violations, proceeding');
    return retryUser;
  }

  // Provide diagnostic information
  const usernameConflict = await testDb.query.users.findFirst({
    where: (users, { eq }) => eq(users.username, username),
  });
  const emailConflict = await testDb.query.users.findFirst({
    where: (users, { eq }) => eq(users.email, email),
  });

  const diagnosticInfo = {
    userId,
    username,
    email,
    usernameConflict: !!usernameConflict,
    emailConflict: !!emailConflict,
    errorMessage: error instanceof Error ? error.message : String(error),
    attempts: maxRetries,
  };

  logger.error(
    'Unable to create or find test user after all attempts - diagnostic info:',
    diagnosticInfo
  );
  throw new Error(
    `Failed to create or find test user after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}\nDiagnostic: ${JSON.stringify(diagnosticInfo)}`
  );
}

function logUserCreationFailure(
  error: unknown,
  attempt: number,
  maxRetries: number,
  userId: string,
  username: string,
  email: string
): void {
  const errorDetails =
    error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { message: String(error), stack: undefined };
  const databaseError = error as any;
  logger.error(`Failed to create test user (attempt ${attempt}/${maxRetries}):`, {
    userId,
    username,
    email,
    error: errorDetails.message,
    stack: errorDetails.stack,
    code: databaseError?.code,
    detail: databaseError?.detail,
    constraint: databaseError?.constraint,
    name: databaseError?.name,
    severity: databaseError?.severity,
    file: databaseError?.file,
    line: databaseError?.line,
    routine: databaseError?.routine,
    original: error,
  });
}

// Helper function to try creating a user once
async function tryCreateUser(userId: string, attempt: number, maxRetries: number) {
  // Use crypto-based UUID for username - cryptographically secure and collision-proof
  const usernameId = generateTestUUID().split('-')[0]; // First part of UUID (8 chars)
  const emailId = generateTestUUID().split('-')[0];

  const username = `user_${usernameId}`; // Clean: user_a1b2c3d4
  const email = `test_${emailId}@example.com`;

  try {
    const user = await createUserWithRawSQL(userId, username, email);
    if (user) logger.debug(`Successfully created test user on attempt ${attempt}`);
    return user;
  } catch (error) {
    logUserCreationFailure(error, attempt, maxRetries, userId, username, email);

    // On final attempt, try to find existing user or provide detailed error
    if (attempt === maxRetries) {
      return await handleFinalUserCreationError(error, userId, username, email, maxRetries);
    }

    return undefined;
  }
}

// Helper function to create or find a test user
async function createOrFindTestUser(userId: string) {
  if (!testDb) throw new Error('Test database not initialized');

  // First try to find existing user by ID
  const existingUser = await testDb.query.users.findFirst({
    where: (users, { eq }) => eq(users.id, userId),
  });

  if (existingUser) {
    return existingUser;
  }

  // Create user with UUID-based username (collision-proof)
  const maxRetries = 2; // Reduced retries since UUIDs prevent collisions

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const user = await tryCreateUser(userId, attempt, maxRetries);
    if (user) {
      return user;
    }
  }

  throw new Error('Failed to create or find test user - user is undefined');
}

// Create test game and player for unit tests
export async function createTestGameAndPlayer() {
  if (!testDb) throw new Error('Test database not initialized');

  const gameId = generateTestUUID();
  const userId = generateTestUUID();

  // Create or find test user
  const user = await createOrFindTestUser(userId);

  // Create test game
  const [game] = await testDb
    .insert(schema.games)
    .values({
      id: gameId,
      name: `Test Game`,
      hostId: user.id, // Use actual user.id instead of userId
      status: 'active',
      maxPlayers: 4,
      mapWidth: 80,
      mapHeight: 50,
      ruleset: 'civ2civ3',
      currentTurn: 1,
      turnTimeLimit: 300,
    })
    .returning();

  // Create test player
  const [player] = await testDb
    .insert(schema.players)
    .values({
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
      history: 5,
    })
    .returning();

  return { game, player, user };
}

function getTestConnectionString(): string {
  return (
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://civjs:civjs_secret@localhost:5432/civjs_test'
  );
}

// Create test database connection
let testQueryClient: postgres.Sql | null = null;
let testDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

export async function setupTestDatabase() {
  try {
    const testConnectionString = getTestConnectionString();
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
    logger.error('Test database not available', error);

    const detail = error instanceof Error ? `: ${error.message}` : '';
    throw new Error(
      'Integration tests require a PostgreSQL database. ' +
        'Set TEST_DATABASE_URL or start local PostgreSQL with a test database' +
        detail
    );
  }
}

export async function cleanupTestDatabase() {
  if (testQueryClient) {
    try {
      // Close all connections immediately
      await testQueryClient.end({ timeout: 5 });
    } catch (error) {
      logger.error('Error during test database cleanup:', error);
    } finally {
      testQueryClient = null;
      testDb = null;
      logger.info('Test database connection closed');
    }
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
    if (testQueryClient) {
      // Use TRUNCATE CASCADE to completely reset all tables regardless of foreign key constraints
      // This is the most reliable way to clear the test database
      const tables = [
        'units',
        'cities',
        'player_techs',
        'research',
        'player_policies',
        'government_changes',
        'players',
        'game_turns',
        'games',
        'users',
      ];

      // TRUNCATE CASCADE will handle all foreign key constraints automatically
      for (const table of tables) {
        await testQueryClient`TRUNCATE TABLE ${testQueryClient.unsafe(table)} CASCADE`;
      }

      logger.debug('All test database tables truncated with CASCADE');
    } else {
      logger.error('Test query client not available');
      throw new Error('Test query client not available for table cleanup');
    }
  } catch (error) {
    logger.error('Failed to clear test database tables with TRUNCATE:', error);

    // If TRUNCATE fails, try individual DELETE operations in dependency order
    logger.warn('Attempting individual DELETE operations as fallback...');
    try {
      // Clear all tables in dependency order (child tables first, then parent tables)
      await testDb.delete(schema.units);
      await testDb.delete(schema.cities);
      await testDb.delete(schema.playerTechs);
      await testDb.delete(schema.research);
      await testDb.delete(schema.playerPolicies);
      await testDb.delete(schema.governmentChanges);
      await testDb.delete(schema.players);
      await testDb.delete(schema.gameTurns);
      await testDb.delete(schema.games);
      await testDb.delete(schema.users);
      logger.debug('DELETE fallback completed successfully');
    } catch (deleteError) {
      logger.error('DELETE fallback also failed:', deleteError);
      throw deleteError;
    }
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
        ruleset: 'civ2civ3',
        turnTimeLimit: 300,
      })
      .returning();

    // Insert test player
    const [testPlayer] = await testDb
      .insert(schema.players)
      .values({
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
        history: 5,
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
