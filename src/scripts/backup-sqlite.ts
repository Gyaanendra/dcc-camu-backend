import fs from 'fs';
import path from 'path';
import { sqlite } from '../db';

async function backupSqlite() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.resolve(__dirname, '../../backups');

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const destFile = path.join(backupDir, `dcc_backup_${timestamp}.db`);
  console.log(`🚀 Creating consistent SQLite online backup...`);
  console.log(`📁 Destination: ${destFile}`);

  try {
    // SQLite online backup API ensures safe backup even under write load
    await sqlite.backup(destFile);
    console.log(`✅ Backup successfully created at: ${destFile}`);

    // Update latest copy
    const latestFile = path.join(backupDir, 'latest.db');
    fs.copyFileSync(destFile, latestFile);
    console.log(`✅ Latest pointer updated at: ${latestFile}`);
  } catch (error) {
    console.error('❌ SQLite backup failed:', error);
    process.exit(1);
  }
}

backupSqlite();

