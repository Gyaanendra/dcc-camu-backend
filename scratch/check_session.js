const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

const sql = neon(process.env.DATABASE_URL);

async function run() {
  const s = await sql`SELECT * FROM sessions WHERE id = '7519190a-fa1b-4a44-aec1-f94e88861213'`;
  console.log('SESSION:', JSON.stringify(s, null, 2));

  const allSessions = await sql`SELECT id, title, target_audience, target_team_ids, start_time FROM sessions ORDER BY start_time DESC LIMIT 10`;
  console.log('RECENT SESSIONS:', JSON.stringify(allSessions, null, 2));

  const usersSample = await sql`SELECT id, name, roll_number, position, role FROM users LIMIT 30`;
  console.log('USERS SAMPLE:', JSON.stringify(usersSample, null, 2));

  const positions = await sql`SELECT DISTINCT position, role FROM users ORDER BY position`;
  console.log('DISTINCT POSITIONS:', JSON.stringify(positions, null, 2));
}

run().catch(console.error);
