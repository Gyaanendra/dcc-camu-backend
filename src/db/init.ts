import { sqlite, db } from './index';
import { users } from './schema';
import { eq, isNull } from 'drizzle-orm';

export async function initDb() {
  try {
    // 1. Create Teams Table
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        code TEXT NOT NULL UNIQUE,
        description TEXT,
        color TEXT DEFAULT '#3b82f6',
        created_at INTEGER NOT NULL
      );
    `);

    // 2. Create Users Table
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        roll_number TEXT NOT NULL UNIQUE,
        position TEXT DEFAULT 'Member' NOT NULL,
        role TEXT DEFAULT 'user' NOT NULL,
        team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
        avatar_url TEXT,
        created_at INTEGER NOT NULL
      );
    `);

    // 3. Create Sessions Table
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT DEFAULT 'regular' NOT NULL,
        description TEXT,
        team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
        target_audience TEXT DEFAULT 'all' NOT NULL,
        target_team_ids TEXT,
        target_years TEXT,
        qr_code_token TEXT NOT NULL,
        location TEXT DEFAULT 'DCC Hub / Auditorium',
        created_by_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        is_active TEXT DEFAULT 'true' NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    // 4. Create Attendance Table
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS attendance (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE NOT NULL,
        status TEXT DEFAULT 'present' NOT NULL,
        scan_method TEXT DEFAULT 'user_scanner' NOT NULL,
        scanned_at INTEGER NOT NULL,
        metadata TEXT
      );
    `);

    // 5. Create On Duty (OD) Requests Table
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS od_requests (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE NOT NULL,
        date TEXT NOT NULL,
        reason TEXT NOT NULL,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        lectures TEXT NOT NULL,
        status TEXT DEFAULT 'pending' NOT NULL,
        admin_notes TEXT,
        reviewed_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at INTEGER,
        created_at INTEGER NOT NULL
      );
    `);

    // 6. Performance Indexes for instant lookup & QR scanning
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_qr_code_token ON sessions(qr_code_token);
      CREATE INDEX IF NOT EXISTS idx_sessions_is_active ON sessions(is_active);
      CREATE INDEX IF NOT EXISTS idx_users_roll_number ON users(roll_number);
      CREATE INDEX IF NOT EXISTS idx_attendance_session_user ON attendance(session_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_od_user ON od_requests(user_id);
    `);

    // 7. Auto-assign Notionist avatars for any members missing avatar_url
    try {
      const usersWithoutAvatar = await db
        .select()
        .from(users)
        .where(isNull(users.avatarUrl));

      if (usersWithoutAvatar.length > 0) {
        console.log(`⚡ Auto-assigning Notionist avatars to ${usersWithoutAvatar.length} member(s)...`);
        const { generateNotionistAvatar } = await import('../utils/avatar');
        for (const u of usersWithoutAvatar) {
          const newAvatar = generateNotionistAvatar(u.name || u.rollNumber);
          await db
            .update(users)
            .set({ avatarUrl: newAvatar })
            .where(eq(users.id, u.id));
        }
      }
    } catch (avatarErr) {
      // Non-fatal if avatar backfill encounters an issue
    }

    console.log('✅ SQLite database schema & indexes initialized successfully.');
  } catch (error) {
    console.error('❌ Failed to initialize SQLite database:', error);
    throw error;
  }
}
