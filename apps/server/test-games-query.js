const { drizzle } = require('drizzle-orm/postgres-js');
const postgres = require('postgres');
require('dotenv').config();

async function testGamesQuery() {
  const dbUrl = "postgresql://postgres:XZrlaPpUIDidZKXSDUSYmTAUQjAymzRP@metro.proxy.rlwy.net:50993/railway";
  
  const client = postgres(dbUrl, {
    max: 1,
    ssl: { rejectUnauthorized: false }
  });
  
  const db = drizzle(client);
  
  try {
    console.log('Testing simple games query...');
    
    // Test basic query first
    const result = await db.execute(`
      SELECT COUNT(*) as count FROM games;
    `);
    
    console.log('Games count:', result[0].count);
    
    // Test with specific game id
    console.log('Testing specific game query...');
    const gameResult = await db.execute(`
      SELECT id, name FROM games 
      WHERE id = $1 
      LIMIT 1;
    `, ['185c7e8c-0756-4ec7-804e-ad9cc47553c2']);
    
    console.log('Game found:', gameResult.length > 0 ? 'Yes' : 'No');
    if (gameResult.length > 0) {
      console.log('Game:', gameResult[0]);
    }
    
  } catch (error) {
    console.error('Query failed:', error.message);
  } finally {
    await client.end();
  }
}

testGamesQuery();