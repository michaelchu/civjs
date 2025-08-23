#!/usr/bin/env node

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

async function runMigrations() {
  console.log('Starting database migrations...');

  try {
    // Configure postgres connection with SSL for production
    const isProduction = process.env.NODE_ENV === 'production';
    const connectionOptions = {
      max: 1, // Limit concurrent connections for migrations
      ssl: isProduction ? 'require' : false,
    };

    const connection = postgres(DATABASE_URL, connectionOptions);
    const db = drizzle(connection);

    // Run migrations
    await migrate(db, {
      migrationsFolder: './drizzle',
    });

    console.log('✅ Database migrations completed successfully');

    // Close connection
    await connection.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migrations if this script is called directly
if (require.main === module) {
  runMigrations();
}
