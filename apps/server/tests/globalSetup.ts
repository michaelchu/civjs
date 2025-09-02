import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

const execAsync = promisify(exec);

export default async function globalSetup() {
  console.log('🔧 Setting up test database...');

  // Load test environment
  dotenv.config({ path: '.env.test' });

  try {
    // Ensure test database exists and is migrated
    await execAsync('npm run test:db:setup');
    console.log('✅ Test database setup complete');
  } catch (error) {
    console.error('❌ Failed to setup test database:', error);
    throw error;
  }
}
