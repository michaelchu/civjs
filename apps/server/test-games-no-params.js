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
    console.log('Testing games query without parameters...');
    
    const result = await db.execute(`
      SELECT id, name, status FROM games 
      WHERE id = '185c7e8c-0756-4ec7-804e-ad9cc47553c2' 
      LIMIT 1;
    `);
    
    console.log('Game found:', result.length > 0 ? 'Yes' : 'No');
    if (result.length > 0) {
      console.log('Game:', result[0]);
    } else {
      console.log('Game ID not found, listing all games:');
      const allGames = await db.execute(`SELECT id, name FROM games LIMIT 5;`);
      allGames.forEach(game => {
        console.log(`- ${game.id}: ${game.name}`);
      });
    }
    
  } catch (error) {
    console.error('Query failed:', error.message);
  } finally {
    await client.end();
  }
}

testGamesQuery();