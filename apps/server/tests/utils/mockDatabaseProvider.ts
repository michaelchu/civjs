import { DatabaseProvider } from '../../src/database/DatabaseProvider';

/**
 * Mock database provider for unit tests
 * Returns mock data instead of making real database calls
 */
export class MockDatabaseProvider implements DatabaseProvider {
  getDatabase() {
    // Return a mock database object with common methods
    return {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([]),
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
    } as any;
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
