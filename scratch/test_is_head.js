const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);

function isUserHeadFixed(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!user.position) return false;

  const pos = user.position.trim().toLowerCase();
  
  // Explicitly not heads:
  if (pos === 'senior executive' || pos === 'junior executive' || pos === 'executive' || pos === 'member' || pos === 'advisor') {
    return false;
  }

  // Matches heads, sub-heads, leads, co-leads, core leadership
  const HEAD_REGEX = /\b(head|sub[\s-]?head|lead|co[\s-]?lead|president|vp|vice[\s-]?president|secretary|treasurer|convener|convenor|director)\b/i;
  return HEAD_REGEX.test(pos);
}

async function run() {
  const users = await sql`SELECT id, name, roll_number, position, role FROM users`;
  
  const heads = users.filter(u => isUserHeadFixed(u));
  const nonHeads = users.filter(u => !isUserHeadFixed(u));

  console.log('Heads count:', heads.length);
  console.log('Non-heads count:', nonHeads.length);

  const headPos = {};
  heads.forEach(u => headPos[u.position] = (headPos[u.position] || 0) + 1);
  console.log('Head positions included:', headPos);

  const nonHeadPos = {};
  nonHeads.forEach(u => nonHeadPos[u.position] = (nonHeadPos[u.position] || 0) + 1);
  console.log('Non-head positions excluded:', nonHeadPos);
}

run().catch(console.error);
