const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);

async function run() {
  console.log('Creating od_requests table if not exists...');
  await sql`
    CREATE TABLE IF NOT EXISTS od_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date VARCHAR(20) NOT NULL,
      reason VARCHAR(255) NOT NULL,
      session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
      lectures TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      admin_notes TEXT,
      reviewed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `;
  console.log('od_requests table created or verified successfully!');
}

run().catch((err) => {
  console.error('Failed to create od_requests table:', err);
  process.exit(1);
});
