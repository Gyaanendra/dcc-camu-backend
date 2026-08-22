import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('⚠️ DATABASE_URL is not defined in environment. Database connection will fail until set in .env!');
}

const sql = neon(connectionString || 'postgresql://placeholder:placeholder@ep-placeholder.us-east-2.aws.neon.tech/neondb');

export const db = drizzle(sql, { schema });
export { sql, schema };
