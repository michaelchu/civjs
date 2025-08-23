import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function runMigrations() {
  console.log('Starting database migrations...');
  
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const client = new Client({
    connectionString,
  });

  try {
    await client.connect();
    console.log('Connected to database');
    
    const db = drizzle(client);
    
    console.log('Running migrations...');
    await migrate(db, { migrationsFolder: './drizzle' });
    
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

runMigrations().catch((err) => {
  console.error('Migration script failed:', err);
  process.exit(1);
});