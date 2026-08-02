/**
 * @module server/database/index
 * Re-exports the database server module API.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import logger from '../utils/logger';
import { DatabaseProvider, ProductionDatabaseProvider } from './DatabaseProvider';

/** POSTGRES_URL remains an optional backwards-compatible connection override. */
const connectionString =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  'postgresql://civjs:civjs_dev@localhost:5432/civjs_dev';

/** PostgreSQL client configured for transaction-pooling-compatible connections. */
const queryClient = postgres(connectionString, {
  prepare: false,
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });

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

export async function closeConnection(): Promise<void> {
  await queryClient.end();
  logger.info('Database connection closed');
}

export const productionDatabaseProvider = new ProductionDatabaseProvider(db);

export type Database = typeof db;
export { schema, DatabaseProvider, ProductionDatabaseProvider };
