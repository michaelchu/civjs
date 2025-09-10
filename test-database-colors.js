// Test script to check what colors are being stored in the database
const { db } = require('./apps/server/dist/database/index');
const { players, games } = require('./apps/server/dist/database/schema');
const { eq } = require('drizzle-orm');

async function checkPlayerColors() {
  console.log('=== Database Color Check ===\n');
  
  try {
    // Get all players from all games
    const allPlayers = await db.query.players.findMany({
      with: {
        game: true
      }
    });
    
    console.log(`Found ${allPlayers.length} players in database\n`);
    
    // Group by game
    const gameGroups = {};
    allPlayers.forEach(player => {
      const gameId = player.gameId;
      if (!gameGroups[gameId]) {
        gameGroups[gameId] = [];
      }
      gameGroups[gameId].push(player);
    });
    
    // Display colors by game
    Object.entries(gameGroups).forEach(([gameId, players]) => {
      console.log(`Game ${gameId}:`);
      players.forEach((player, i) => {
        console.log(`  Player ${i+1} (${player.civilization}): rgb(${player.color.r}, ${player.color.g}, ${player.color.b})`);
      });
      console.log('');
    });
    
  } catch (error) {
    console.error('Error checking database:', error);
  }
}

checkPlayerColors().then(() => {
  console.log('Database check complete');
  process.exit(0);
}).catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});