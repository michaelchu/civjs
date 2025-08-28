/* eslint-disable no-console */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as dotenv from 'dotenv';

dotenv.config();

async function runMigrations() {
  console.log('Migration started ⌛');

  const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;

  if (!dbUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  // Create postgres client with SSL settings for production (Supabase)
  const client = postgres(dbUrl, {
    max: 1,
    // SSL configuration for Supabase and other hosted databases
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  });

  const db = drizzle(client);

  try {
    console.log('Running migrations...');
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('Migration completed ✅');
  } catch (error) {
    console.error('Migration failed ❌', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations().catch(err => {
  console.error('Migration script failed:', err);
  process.exit(1);
});
