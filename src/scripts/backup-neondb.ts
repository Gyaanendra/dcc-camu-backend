import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const connectionString = process.env.DATABASE_URL;

function escapeSqlValue(value: any): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === 'object') {
    const str = JSON.stringify(value).replace(/'/g, "''");
    return `'${str}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

const TABLE_INSERT_ORDER = ['teams', 'users', 'sessions', 'attendance', 'od_requests'];

async function runBackup() {
  if (!connectionString || !connectionString.startsWith('postgres')) {
    console.error('❌ Neon PostgreSQL connection string not found in DATABASE_URL');
    process.exit(1);
  }

  // @ts-ignore - dynamic import if neon package is present
  const { neon } = await import('@neondatabase/serverless').catch(() => {
    console.error('❌ @neondatabase/serverless is not installed.');
    process.exit(1);
  });

  const sql = neon(connectionString);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.resolve(__dirname, '../../backups', `neon_${timestamp}`);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log(`🚀 Starting Neon DB backup...`);
  console.log(`📁 Target directory: ${backupDir}\n`);

  try {
    const tableRows = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE';
    `;

    const allDbTables = tableRows.map((r: any) => r.table_name);
    const tables = [
      ...TABLE_INSERT_ORDER.filter((t: string) => allDbTables.includes(t)),
      ...allDbTables.filter((t: string) => !TABLE_INSERT_ORDER.includes(t)),
    ];

    console.log(`📋 Found ${tables.length} tables to export:`, tables.join(', '));

    const fullDump: Record<string, any[]> = {};
    const tableStats: Record<string, number> = {};

    let sqlScript = `-- DCC Database Dump from Neon\n-- Exported: ${new Date().toISOString()}\n\n`;

    for (const table of tables) {
      console.log(`⏳ Fetching data from [${table}]...`);
      const rows = (await sql(`SELECT * FROM "${table}"`)) as any[];
      fullDump[table] = rows;
      tableStats[table] = rows.length;

      const tableJsonPath = path.join(backupDir, `${table}.json`);
      fs.writeFileSync(tableJsonPath, JSON.stringify(rows, null, 2), 'utf-8');

      if (rows.length > 0) {
        sqlScript += `-- Table: ${table} (${rows.length} rows)\n`;
        const columns = Object.keys(rows[0]);
        const quotedCols = columns.map((col) => `"${col}"`).join(', ');

        for (const row of rows) {
          const values = columns.map((col) => escapeSqlValue(row[col])).join(', ');
          sqlScript += `INSERT INTO "${table}" (${quotedCols}) VALUES (${values});\n`;
        }
        sqlScript += `\n`;
      }
    }

    const fullJsonPath = path.join(backupDir, 'full_backup.json');
    const metadata = {
      exportedAt: new Date().toISOString(),
      databaseUrlHost: (connectionString || '').split('@')[1]?.split('/')[0] || 'neon',
      totalTables: tables.length,
      rowCounts: tableStats,
    };
    fs.writeFileSync(fullJsonPath, JSON.stringify({ metadata, data: fullDump }, null, 2), 'utf-8');

    const sqlPath = path.join(backupDir, 'backup.sql');
    fs.writeFileSync(sqlPath, sqlScript, 'utf-8');

    console.log(`\n🎉 Backup complete! Saved to ${backupDir}`);
  } catch (error) {
    console.error('❌ Backup failed:', error);
    process.exit(1);
  }
}

runBackup();
