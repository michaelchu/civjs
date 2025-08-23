import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as dotenv from 'dotenv';

dotenv.config();

async function runMigrations() {
  console.log('Migration started ⌛');
  
  const dbUrl = process.env.DATABASE_URL;
  
  if (!dbUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  // Create postgres client with Railway-specific SSL settings
  const client = postgres(dbUrl, {
    max: 1,
    // SSL must be 'require' for Railway's self-signed certificates
    ssl: process.env.NODE_ENV === 'production' ? 'require' : undefined
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

runMigrations().catch((err) => {
  console.error('Migration script failed:', err);
  process.exit(1);
});