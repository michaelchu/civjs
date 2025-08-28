import type { Config } from 'drizzle-kit';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Parse connection details from POSTGRES_URL or fall back to individual components
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://civjs:civjs_dev@localhost:5432/civjs_dev';

// Read CA certificate from file if available
let caCert: string | undefined;
if (process.env.NODE_ENV === 'production' && process.env.DATABASE_CA) {
  try {
    caCert = fs.readFileSync(process.env.DATABASE_CA).toString();
    console.log('CA certificate loaded from file:', process.env.DATABASE_CA);
  } catch (error) {
    console.error('Failed to read CA certificate file:', error);
  }
}

// Parse URL for individual components (needed for CA certificate)
let host, port, user, password, database;

// Parse connection string in production if we have a CA certificate
if (process.env.NODE_ENV === 'production' && connectionString.startsWith('postgresql://') && caCert) {
  try {
    const url = new URL(connectionString);
    host = url.hostname;
    port = parseInt(url.port) || 5432;
    user = url.username;
    password = url.password;
    database = url.pathname.slice(1); // remove leading slash
    console.log('Parsed connection details for CA certificate usage:', { host, port, user, database: database ? 'present' : 'missing' });
  } catch (error) {
    console.error('Failed to parse connection string:', error);
  }
}

export default {
  schema: './src/database/schema/*.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: process.env.NODE_ENV === 'production' && host && caCert ? {
    host,
    port,
    user,
    password,
    database,
    ssl: { 
      ca: caCert,
      rejectUnauthorized: true 
    },
  } : {
    url: connectionString,
  },
  verbose: true,
  strict: true,
} satisfies Config;
