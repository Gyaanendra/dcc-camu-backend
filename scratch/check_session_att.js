const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);

async function run() {
  const sessionId = '7519190a-fa1b-4a44-aec1-f94e88861213';
  const session = await sql`SELECT * FROM sessions WHERE id = ${sessionId}`;
  console.log('Session:', session);

  const att = await sql`
    SELECT a.*, u.name, u.roll_number, u.position, u.role 
    FROM attendance a 
    JOIN users u ON a.user_id = u.id 
    WHERE a.session_id = ${sessionId}
  `;
  console.log('Attended count for this session:', att.length);
  console.log('Attended members:', JSON.stringify(att.map(x => ({ name: x.name, roll: x.roll_number, pos: x.position, status: x.status })), null, 2));
}

run().catch(console.error);
