const { drizzle } = require('drizzle-orm/postgres-js');
const postgres = require('postgres');
require('dotenv').config();

async function addMissingColumns() {
  const dbUrl = "postgresql://postgres:XZrlaPpUIDidZKXSDUSYmTAUQjAymzRP@metro.proxy.rlwy.net:50993/railway";
  
  const client = postgres(dbUrl, {
    max: 1,
    ssl: { rejectUnauthorized: false }
  });
  
  const db = drizzle(client);
  
  try {
    console.log('Adding missing columns to players table...');
    
    // Add the missing tax rate columns
    await db.execute(`ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "tax_rate" integer DEFAULT 50 NOT NULL`);
    console.log('Added tax_rate column');
    
    await db.execute(`ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "luxury_rate" integer DEFAULT 20 NOT NULL`);
    console.log('Added luxury_rate column');
    
    await db.execute(`ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "science_rate" integer DEFAULT 30 NOT NULL`);
    console.log('Added science_rate column');
    
    console.log('All missing columns added successfully!');
    
  } catch (error) {
    console.error('Failed to add columns:', error.message);
  } finally {
    await client.end();
  }
}

addMissingColumns();