import dotenv from 'dotenv';
import './support/runtimeMocks';
import { cleanupTestDatabase, setupTestDatabase } from './utils/testDatabase';

if (!process.env.CI) {
  dotenv.config({ path: '.env.test' });
}

process.env.NODE_ENV = 'test';

beforeAll(async () => {
  await setupTestDatabase();
}, 30000);

afterAll(async () => {
  await cleanupTestDatabase();
}, 10000);
