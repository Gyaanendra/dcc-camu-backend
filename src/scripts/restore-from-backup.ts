import fs from 'fs';
import path from 'path';
import { db, sqlite } from '../db';
import { initDb } from '../db/init';
import { teams, users, sessions, attendance, odRequests } from '../db/schema';

async function restore() {
  console.log('🚀 Initializing SQLite database and schema...');
  await initDb();

  const backupDir = path.resolve(__dirname, '../../backups/latest');
  if (!fs.existsSync(backupDir)) {
    console.error(`❌ Backup directory not found at: ${backupDir}`);
    process.exit(1);
  }

  // Temporarily disable foreign keys during bulk import
  sqlite.pragma('foreign_keys = OFF');

  try {
    // 1. Teams
    const teamsFile = path.join(backupDir, 'teams.json');
    if (fs.existsSync(teamsFile)) {
      const rows = JSON.parse(fs.readFileSync(teamsFile, 'utf-8'));
      console.log(`📥 Restoring [teams] (${rows.length} rows)...`);
      for (const row of rows) {
        await db
          .insert(teams)
          .values({
            id: row.id,
            name: row.name,
            code: row.code,
            description: row.description,
            color: row.color || '#3b82f6',
            createdAt: row.created_at ? new Date(row.created_at) : new Date(),
          })
          .onConflictDoNothing();
      }
      console.log(`  ✅ [teams] restored.`);
    }

    // 2. Users
    const usersFile = path.join(backupDir, 'users.json');
    if (fs.existsSync(usersFile)) {
      const rows = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
      console.log(`📥 Restoring [users] (${rows.length} rows)...`);
      for (const row of rows) {
        await db
          .insert(users)
          .values({
            id: row.id,
            name: row.name,
            email: row.email,
            password: row.password,
            rollNumber: row.roll_number,
            position: row.position || 'Member',
            role: row.role || 'user',
            teamId: row.team_id,
            avatarUrl: row.avatar_url,
            createdAt: row.created_at ? new Date(row.created_at) : new Date(),
          })
          .onConflictDoNothing();
      }
      console.log(`  ✅ [users] restored.`);
    }

    // 3. Sessions
    const sessionsFile = path.join(backupDir, 'sessions.json');
    if (fs.existsSync(sessionsFile)) {
      const rows = JSON.parse(fs.readFileSync(sessionsFile, 'utf-8'));
      console.log(`📥 Restoring [sessions] (${rows.length} rows)...`);
      for (const row of rows) {
        await db
          .insert(sessions)
          .values({
            id: row.id,
            title: row.title,
            type: row.type || 'regular',
            description: row.description,
            teamId: row.team_id,
            targetAudience: row.target_audience || 'all',
            targetTeamIds: row.target_team_ids,
            targetYears: row.target_years,
            qrCodeToken: row.qr_code_token,
            location: row.location || 'DCC Hub / Auditorium',
            createdById: row.created_by_id,
            startTime: row.start_time ? new Date(row.start_time) : new Date(),
            endTime: row.end_time ? new Date(row.end_time) : new Date(),
            isActive: row.is_active || 'true',
            createdAt: row.created_at ? new Date(row.created_at) : new Date(),
          })
          .onConflictDoNothing();
      }
      console.log(`  ✅ [sessions] restored.`);
    }

    // 4. Attendance
    const attendanceFile = path.join(backupDir, 'attendance.json');
    if (fs.existsSync(attendanceFile)) {
      const rows = JSON.parse(fs.readFileSync(attendanceFile, 'utf-8'));
      console.log(`📥 Restoring [attendance] (${rows.length} rows)...`);
      for (const row of rows) {
        await db
          .insert(attendance)
          .values({
            id: row.id,
            sessionId: row.session_id,
            userId: row.user_id,
            status: row.status || 'present',
            scanMethod: row.scan_method || 'user_scanner',
            scannedAt: row.scanned_at ? new Date(row.scanned_at) : new Date(),
            metadata: row.metadata,
          })
          .onConflictDoNothing();
      }
      console.log(`  ✅ [attendance] restored.`);
    }

    // 5. On Duty (OD) Requests
    const odFile = path.join(backupDir, 'od_requests.json');
    if (fs.existsSync(odFile)) {
      const rows = JSON.parse(fs.readFileSync(odFile, 'utf-8'));
      console.log(`📥 Restoring [od_requests] (${rows.length} rows)...`);
      for (const row of rows) {
        await db
          .insert(odRequests)
          .values({
            id: row.id,
            userId: row.user_id,
            date: row.date,
            reason: row.reason,
            sessionId: row.session_id,
            lectures: row.lectures,
            status: row.status || 'pending',
            adminNotes: row.admin_notes,
            reviewedById: row.reviewed_by_id,
            reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
            createdAt: row.created_at ? new Date(row.created_at) : new Date(),
          })
          .onConflictDoNothing();
      }
      console.log(`  ✅ [od_requests] restored.`);
    }

    console.log('\n🎉 SQLite migration and data restore completed successfully!');

    // Print summary counts
    const teamsCount = (sqlite.prepare('SELECT count(*) as count FROM teams').get() as any).count;
    const usersCount = (sqlite.prepare('SELECT count(*) as count FROM users').get() as any).count;
    const sessionsCount = (sqlite.prepare('SELECT count(*) as count FROM sessions').get() as any).count;
    const attendanceCount = (sqlite.prepare('SELECT count(*) as count FROM attendance').get() as any).count;
    const odCount = (sqlite.prepare('SELECT count(*) as count FROM od_requests').get() as any).count;

    console.log('📊 Current SQLite Database Row Counts:');
    console.log(`   - teams      : ${teamsCount}`);
    console.log(`   - users      : ${usersCount}`);
    console.log(`   - sessions   : ${sessionsCount}`);
    console.log(`   - attendance : ${attendanceCount}`);
    console.log(`   - od_requests: ${odCount}\n`);
  } catch (error) {
    console.error('❌ Restore failed:', error);
    process.exit(1);
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }
}

restore();

