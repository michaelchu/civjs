import type { Config } from 'drizzle-kit';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const config: Config = {
  schema: './src/database/schema/*.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.TEST_DATABASE_URL || 'postgresql://civjs_test:civjs_test@localhost:5432/civjs_test',
  },
  verbose: true,
  strict: true,
};

export default config;