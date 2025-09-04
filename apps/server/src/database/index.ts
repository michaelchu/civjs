import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import logger from '../utils/logger';
import { DatabaseProvider, ProductionDatabaseProvider } from './DatabaseProvider';

// Database connection string - use POSTGRES_URL from Supabase
const connectionString =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  'postgresql://civjs:civjs_dev@localhost:5432/civjs_dev';

// Create postgres connection
// Disable prefetch for "Transaction" pool mode (Supabase recommendation)
const queryClient = postgres(connectionString, {
  prepare: false, // Required for Supabase transaction pooling
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

// Create drizzle instance
export const db = drizzle(queryClient, { schema });

// Test database connection
export async function testConnection(): Promise<boolean> {
  try {
    await queryClient`SELECT 1`;
    logger.info('Database connection established successfully');
    return true;
  } catch (error) {
    logger.error('Failed to connect to database:', error);
    return false;
  }
}

// Close database connection
export async function closeConnection(): Promise<void> {
  await queryClient.end();
  logger.info('Database connection closed');
}

// Create production database provider
export const productionDatabaseProvider = new ProductionDatabaseProvider(db);

// Export types and interfaces
export type Database = typeof db;
export { schema, DatabaseProvider, ProductionDatabaseProvider };
