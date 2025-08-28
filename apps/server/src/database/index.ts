import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import logger from '../utils/logger';

// Database connection string - prioritize Supabase vars from Vercel
const connectionString = 
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL || 
  'postgresql://civjs:civjs_dev@localhost:5432/civjs_dev';

// Create postgres connection
const queryClient = postgres(connectionString, {
  max: 10, // Maximum number of connections
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
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

// Export types
export type Database = typeof db;
export { schema };
