import type { Config } from 'drizzle-kit';
import dotenv from 'dotenv';

dotenv.config();

// Parse connection details from POSTGRES_URL or fall back to individual components
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://civjs:civjs_dev@localhost:5432/civjs_dev';

// Parse URL for individual components (needed for CA certificate)
let host, port, user, password, database;

// Always parse connection string in production, regardless of CA availability
if (process.env.NODE_ENV === 'production' && connectionString.startsWith('postgresql://')) {
  try {
    const url = new URL(connectionString);
    host = url.hostname;
    port = parseInt(url.port) || 5432;
    user = url.username;
    password = url.password;
    database = url.pathname.slice(1); // remove leading slash
    console.log('Parsed connection details:', { host, port, user, database: database ? 'present' : 'missing' });
    console.log('DATABASE_CA available:', !!process.env.DATABASE_CA);
  } catch (error) {
    console.error('Failed to parse connection string:', error);
  }
}

export default {
  schema: './src/database/schema/*.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: process.env.NODE_ENV === 'production' && host ? {
    host,
    port,
    user,
    password,
    database,
    ssl: process.env.DATABASE_CA ? { 
      ca: process.env.DATABASE_CA,
      rejectUnauthorized: true 
    } : { 
      rejectUnauthorized: false 
    },
  } : {
    url: connectionString,
    ssl: process.env.NODE_ENV === 'production' ? 'require' : false,
  },
  verbose: true,
  strict: true,
} satisfies Config;
