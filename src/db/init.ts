import { sql } from './index';

export async function initDb() {
  try {
    // 1. Create Teams Table
    await sql`
      CREATE TABLE IF NOT EXISTS teams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL UNIQUE,
        code VARCHAR(20) NOT NULL UNIQUE,
        description TEXT,
        color VARCHAR(30) DEFAULT '#3b82f6',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;

    // 2. Create Users Table (using password column)
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(150) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password TEXT NOT NULL,
        roll_number VARCHAR(50) NOT NULL UNIQUE,
        position VARCHAR(100) DEFAULT 'Member' NOT NULL,
        role VARCHAR(20) DEFAULT 'user' NOT NULL,
        team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;

    // Migration helper: If table previously had password_hash column, rename it to password
    try {
      await sql`ALTER TABLE users RENAME COLUMN password_hash TO password;`;
    } catch (e) {
      // Column is already named password or newly created
    }

    // 3. Create Sessions Table
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(200) NOT NULL,
        type VARCHAR(50) DEFAULT 'regular' NOT NULL,
        description TEXT,
        team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
        qr_code_token TEXT NOT NULL,
        location VARCHAR(200) DEFAULT 'DCC Hub / Auditorium',
        created_by_id UUID REFERENCES users(id) ON DELETE CASCADE,
        start_time TIMESTAMP DEFAULT NOW() NOT NULL,
        end_time TIMESTAMP NOT NULL,
        is_active VARCHAR(10) DEFAULT 'true' NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;

    // 4. Create Attendance Table
    await sql`
      CREATE TABLE IF NOT EXISTS attendance (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
        status VARCHAR(20) DEFAULT 'present' NOT NULL,
        scan_method VARCHAR(30) DEFAULT 'user_scanner' NOT NULL,
        scanned_at TIMESTAMP DEFAULT NOW() NOT NULL,
        metadata TEXT
      );
    `;

    // 5. Performance Indexes for instant QR scanning and check-ins
    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_sessions_qr_code_token ON sessions(qr_code_token);`;
      await sql`CREATE INDEX IF NOT EXISTS idx_sessions_is_active ON sessions(is_active);`;
      await sql`CREATE INDEX IF NOT EXISTS idx_users_roll_number ON users(UPPER(roll_number));`;
      await sql`CREATE INDEX IF NOT EXISTS idx_attendance_session_user ON attendance(session_id, user_id);`;
    } catch (idxErr) {
      // Indexes are best-effort; core tables are already ready.
    }

  } catch (error) {
    console.error('❌ DB Table Initialization Error:', error);
  }
}

