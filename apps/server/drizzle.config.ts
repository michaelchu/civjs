import type { Config } from 'drizzle-kit';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://civjs:civjs_dev@localhost:5432/civjs_dev';

// Add SSL mode for production if not already present
const finalConnectionString = process.env.NODE_ENV === 'production' && connectionString && !connectionString.includes('sslmode')
  ? `${connectionString}?sslmode=no-verify`
  : connectionString;

export default {
  schema: './src/database/schema/*.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: finalConnectionString,
  },
  verbose: true,
  strict: true,
} satisfies Config;
