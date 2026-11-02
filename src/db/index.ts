import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

// Default to dcc.db in the backend root if DATABASE_URL is not set or starts with postgresql://
let dbPath = process.env.DATABASE_URL;

if (!dbPath || dbPath.startsWith('postgres://') || dbPath.startsWith('postgresql://')) {
  dbPath = path.resolve(process.cwd(), 'dcc.db');
} else {
  dbPath = path.resolve(process.cwd(), dbPath);
}

// Ensure database directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const sqlite = new Database(dbPath);

// Performance & Concurrency Tuning for 1-core VPS
sqlite.pragma('journal_mode = WAL');       // Write-Ahead Logging allows concurrent reads while writing
sqlite.pragma('synchronous = NORMAL');     // Faster writes without risking corruption in WAL mode
sqlite.pragma('foreign_keys = ON');         // Enforce relational integrity
sqlite.pragma('busy_timeout = 5000');       // Wait up to 5 seconds if another query is writing

export const db = drizzle(sqlite, { schema });
export { schema };
