import dotenv from 'dotenv';
import type { Config } from 'drizzle-kit';

dotenv.config({ path: '.env.test' });

const config: Config = {
  schema: './src/database/schema/*.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
};

export default config;
