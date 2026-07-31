/* eslint-disable no-console */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as dotenv from 'dotenv';

dotenv.config();

async function runMigrations() {
  console.log('Migration started ⌛');

  const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  // Add SSL mode for production if not already present
  const finalDbUrl =
    process.env.NODE_ENV === 'production' && dbUrl && !dbUrl.includes('sslmode')
      ? `${dbUrl}?sslmode=no-verify`
      : dbUrl;

  if (!finalDbUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  // Create the postgres client with optional production SSL settings.
  const client = postgres(finalDbUrl, {
    max: 1,
    // SSL configuration for explicitly configured remote databases
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
