const { Pool } = require('pg');

const pool = new Pool({
  connectionString: "postgresql://postgres:ULFQBqWenaanPTOOAUMbIkxoeFidMYRL@switchback.proxy.rlwy.net:16060/railway",
});

async function fixDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('Checking current games table structure...');
    
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'games' 
      ORDER BY ordinal_position;
    `);
    
    console.log('Current games table columns:');
    result.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${row.column_default ? `DEFAULT ${row.column_default}` : ''}`);
    });
    
    console.log('\nChecking if history_interest_pml exists...');
    const historyCol = result.rows.find(row => row.column_name === 'history_interest_pml');
    
    if (!historyCol) {
      console.log('Adding history_interest_pml column...');
      await client.query('ALTER TABLE games ADD COLUMN history_interest_pml integer DEFAULT 0 NOT NULL;');
      console.log('✅ Added history_interest_pml column');
    } else {
      console.log('✅ history_interest_pml column already exists');
    }
    
    console.log('\nTesting game insertion...');
    await client.query(`
      INSERT INTO games (name, host_id, game_type, max_players, map_width, map_height, victory_conditions, ruleset, turn_time_limit, game_state) 
      VALUES ('test-fix', 'test-user-id', 'single', 4, 40, 25, '[]', 'classic', 120, '{"test": true}')
    `);
    console.log('✅ Game insertion test successful');
    
    // Clean up test
    await client.query(`DELETE FROM games WHERE name = 'test-fix'`);
    console.log('✅ Test cleanup completed');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

fixDatabase();