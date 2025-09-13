const { drizzle } = require('drizzle-orm/postgres-js');
const postgres = require('postgres');
require('dotenv').config();

async function testQuery() {
  const dbUrl = "postgresql://postgres:XZrlaPpUIDidZKXSDUSYmTAUQjAymzRP@metro.proxy.rlwy.net:50993/railway";
  
  const client = postgres(dbUrl, {
    max: 1,
    ssl: { rejectUnauthorized: false }
  });
  
  const db = drizzle(client);
  
  try {
    console.log('Testing database query...');
    
    // Test the query that was failing
    const result = await db.execute(`
      select "games"."id", "games"."name", "games"."host_id", "games"."status", 
             "games"."current_turn", "games"."turn_phase", "games"."game_type", 
             "games"."max_players", "games"."map_width", "games"."map_height", 
             "games"."victory_conditions", "games"."ruleset", "games"."history_interest_pml", 
             "games"."map_seed", "games"."map_data", "games"."turn_time_limit", 
             "games"."turn_started_at", "games"."paused_at", "games"."started_at", 
             "games"."ended_at", "games"."created_at", "games"."updated_at", 
             "games"."game_state"
      from "games" 
      where "games"."id" = $1 
      limit $2
    `, ['185c7e8c-0756-4ec7-804e-ad9cc47553c2', 1]);
    
    console.log('Query successful!');
    console.log('Results:', result.length);
    
  } catch (error) {
    console.error('Query failed:', error.message);
  } finally {
    await client.end();
  }
}

testQuery();