const { drizzle } = require('drizzle-orm/postgres-js');
const postgres = require('postgres');
require('dotenv').config();

async function checkMissingColumns() {
  const dbUrl = "postgresql://postgres:XZrlaPpUIDidZKXSDUSYmTAUQjAymzRP@metro.proxy.rlwy.net:50993/railway";
  
  const client = postgres(dbUrl, {
    max: 1,
    ssl: { rejectUnauthorized: false }
  });
  
  const db = drizzle(client);
  
  try {
    console.log('Checking for missing columns in players table...');
    
    // Check if tax_rate columns exist
    const result = await db.execute(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'players' 
      AND column_name IN ('tax_rate', 'luxury_rate', 'science_rate');
    `);
    
    console.log('Found columns:', result.map(r => r.column_name));
    
    // Expected columns
    const expectedColumns = ['tax_rate', 'luxury_rate', 'science_rate'];
    const foundColumns = result.map(r => r.column_name);
    const missingColumns = expectedColumns.filter(col => !foundColumns.includes(col));
    
    if (missingColumns.length > 0) {
      console.log('Missing columns:', missingColumns);
      console.log('These columns need to be added to the database.');
    } else {
      console.log('All expected columns are present.');
    }
    
  } catch (error) {
    console.error('Check failed:', error.message);
  } finally {
    await client.end();
  }
}

checkMissingColumns();