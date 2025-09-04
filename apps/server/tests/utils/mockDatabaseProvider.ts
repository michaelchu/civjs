import { DatabaseProvider } from '../../src/database/DatabaseProvider';

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
    return {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([]), // Return empty array for select queries
      values: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      // Mock insert operations to return objects with generated IDs
      returning: jest.fn().mockImplementation(() => {
        const id = `test-id-${MockDatabaseProvider.idCounter++}`;
        return Promise.resolve([{ id, createdAt: new Date(), updatedAt: new Date() }]);
      }),
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
