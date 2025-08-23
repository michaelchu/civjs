#!/usr/bin/env node

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

async function runMigrations() {
  const sql = postgres(DATABASE_URL);

  try {
    // Create migrations table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Get list of executed migrations
    const executedMigrations = await sql`
      SELECT filename FROM _migrations ORDER BY id
    `;
    const executedSet = new Set(executedMigrations.map(m => m.filename));

    // Read migration files from drizzle folder
    const migrationsDir = join(__dirname, '../../drizzle');
    const migrationFiles = readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    console.log(`Found ${migrationFiles.length} migration files`);
    console.log(`Already executed: ${executedSet.size} migrations`);

    let newMigrationsRun = 0;

    for (const file of migrationFiles) {
      if (executedSet.has(file)) {
        console.log(`✓ Skipping ${file} (already executed)`);
        continue;
      }

      console.log(`→ Running ${file}...`);

      const migrationSql = readFileSync(join(migrationsDir, file), 'utf8');

      // Split by statement separator and filter out empty statements
      const statements = migrationSql
        .split('--> statement-breakpoint')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      // Execute each statement in a transaction
      await sql.begin(async tx => {
        for (const statement of statements) {
          if (statement.trim()) {
            await tx.unsafe(statement);
          }
        }

        // Record successful migration
        await tx`
          INSERT INTO _migrations (filename) VALUES (${file})
        `;
      });

      console.log(`✓ Completed ${file}`);
      newMigrationsRun++;
    }

    console.log(`Migration complete! Ran ${newMigrationsRun} new migrations.`);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  runMigrations();
}
