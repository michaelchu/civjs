import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

// Type alias for the database instance
export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Database provider interface for dependency injection
 * Allows managers to work with either production or test databases
 */
export interface DatabaseProvider {
  getDatabase(): Database;
  testConnection(): Promise<boolean>;
  closeConnection?(): Promise<void>;
}

/**
 * Production database provider using the main database connection
 */
export class ProductionDatabaseProvider implements DatabaseProvider {
  private database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  getDatabase(): Database {
    return this.database;
  }

  async testConnection(): Promise<boolean> {
    try {
      // Access the underlying postgres client for connection testing
      const queryClient = (this.database as any)._.session.client;
      await queryClient`SELECT 1`;
      return true;
    } catch (error) {
      return false;
    }
  }
}