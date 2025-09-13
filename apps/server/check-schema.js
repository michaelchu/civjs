const { drizzle } = require('drizzle-orm/postgres-js');
const postgres = require('postgres');
require('dotenv').config();

async function checkSchema() {
  const dbUrl = "postgresql://postgres:XZrlaPpUIDidZKXSDUSYmTAUQjAymzRP@metro.proxy.rlwy.net:50993/railway";
  
  const client = postgres(dbUrl, {
    max: 1,
    ssl: { rejectUnauthorized: false }
  });
  
  const db = drizzle(client);
  
  try {
    console.log('Checking games table schema...');
    
    // Check what columns exist in the games table
    const result = await db.execute(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'games' 
      ORDER BY ordinal_position;
    `);
    
    console.log('Games table columns:');
    result.forEach(row => {
      console.log(`- ${row.column_name} (${row.data_type}) ${row.is_nullable === 'YES' ? 'nullable' : 'not null'}`);
    });
    
    console.log('\nChecking players table schema...');
    const playersResult = await db.execute(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'players' 
      ORDER BY ordinal_position;
    `);
    
    console.log('Players table columns:');
    playersResult.forEach(row => {
      console.log(`- ${row.column_name} (${row.data_type}) ${row.is_nullable === 'YES' ? 'nullable' : 'not null'}`);
    });
    
  } catch (error) {
    console.error('Schema check failed:', error.message);
  } finally {
    await client.end();
  }
}

checkSchema();