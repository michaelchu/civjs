const { Pool } = require('pg');
const pool = new Pool({connectionString: 'postgresql://postgres:ULFQBqWenaanPTOOAUMbIkxoeFidMYRL@switchback.proxy.rlwy.net:16060/railway'});

async function checkPlayersTable() {
  const client = await pool.connect();
  try {
    console.log('Checking current players table structure...');
    
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'players' 
      ORDER BY ordinal_position;
    `);
    
    console.log('Current players table columns:');
    result.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${row.column_default ? `DEFAULT ${row.column_default}` : ''}`);
    });
    
    const historyCol = result.rows.find(row => row.column_name === 'history');
    const cultureCol = result.rows.find(row => row.column_name === 'culture');
    
    if (!historyCol && cultureCol) {
      console.log('\nRenaming culture column to history...');
      await client.query('ALTER TABLE players RENAME COLUMN culture TO history;');
      console.log('✅ Renamed culture to history in players table');
    } else if (!historyCol && !cultureCol) {
      console.log('\nAdding history column...');
      await client.query('ALTER TABLE players ADD COLUMN history integer DEFAULT 0 NOT NULL;');
      console.log('✅ Added history column to players table');
    } else {
      console.log('✅ history column already exists in players table');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkPlayersTable();