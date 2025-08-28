import type { Config } from 'drizzle-kit';
import dotenv from 'dotenv';

dotenv.config();

// Parse connection details from POSTGRES_URL or fall back to individual components
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://civjs:civjs_dev@localhost:5432/civjs_dev';

// Parse URL for individual components (needed for CA certificate)
let host, port, user, password, database;

if (process.env.NODE_ENV === 'production' && connectionString.startsWith('postgresql://') && process.env.DATABASE_CA) {
  try {
    const url = new URL(connectionString);
    host = url.hostname;
    port = parseInt(url.port) || 5432;
    user = url.username;
    password = url.password;
    database = url.pathname.slice(1); // remove leading slash
  } catch (error) {
    console.error('Failed to parse connection string:', error);
  }
}

export default {
  schema: './src/database/schema/*.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: process.env.NODE_ENV === 'production' && host && process.env.DATABASE_CA ? {
    host,
    port,
    user,
    password,
    database,
    ssl: { ca: process.env.DATABASE_CA },
  } : {
    url: connectionString,
    ssl: process.env.NODE_ENV === 'production' ? 'require' : false,
  },
  verbose: true,
  strict: true,
} satisfies Config;
