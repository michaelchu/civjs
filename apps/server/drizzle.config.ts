import type { Config } from 'drizzle-kit';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

export default {
  schema: './src/database/schema/*.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: process.env.NODE_ENV === 'production' ? {
    // using url doesn't work because it seems to override the ssl config
    // url: process.env.POSTGRES_URL!,
    host: process.env.POSTGRES_HOST!,
    port: parseInt(process.env.POSTGRES_PORT!),
    user: process.env.POSTGRES_USER!,
    password: process.env.POSTGRES_PASSWORD!,
    database: process.env.POSTGRES_DATABASE!,
    ssl: process.env.DATABASE_CA ? { 
      ca: fs.readFileSync(process.env.DATABASE_CA).toString() 
    } : { 
      rejectUnauthorized: false 
    },
  } : {
    url: process.env.POSTGRES_URL || 'postgresql://civjs:civjs_dev@localhost:5432/civjs_dev',
  },
  verbose: true,
  strict: true,
} satisfies Config;
