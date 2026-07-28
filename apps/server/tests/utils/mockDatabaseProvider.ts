import { DatabaseProvider } from '@database/DatabaseProvider';

/**
 * Mock database provider for unit tests
 * Returns mock data instead of making real database calls
 */
export class MockDatabaseProvider implements DatabaseProvider {
  private static idCounter = 1;
  private mockDb: any;

  constructor() {
    this.mockDb = this.createMockDatabase();
  }

  private createMockDatabase() {
    const returning = jest.fn().mockImplementation(() => {
      const id = `test-id-${MockDatabaseProvider.idCounter++}`;
      return Promise.resolve([{ id, createdAt: new Date(), updatedAt: new Date() }]);
    });
    const where = jest.fn().mockImplementation(() =>
      Object.assign(Promise.resolve([]), {
        returning,
      })
    );
    return {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where, // Thenable for selects and chainable into returning() for writes
      values: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      onConflictDoNothing: jest.fn().mockReturnThis(),
      // Mock insert operations to return objects with generated IDs
      returning,
      query: {
        games: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
        },
        players: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
        },
        cities: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
        },
        units: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
        },
      },
    };
  }

  getDatabase() {
    return this.mockDb;
  }

  async testConnection(): Promise<boolean> {
    return true;
  }
}

/**
 * Create a mock database provider for unit tests
 */
export function createMockDatabaseProvider(): DatabaseProvider {
  return new MockDatabaseProvider();
}
