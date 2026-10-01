const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);

async function run() {
  const users = await sql`SELECT id, name, roll_number, position, role FROM users`;
  const OLD_REGEX = /\b(head|lead|president|vp|vice[\s-]?president|convenor|convener|coordinator|director|executive|exec)\b/i;
  
  const oldCount = users.filter(u => u.role === 'admin' || OLD_REGEX.test(u.position || '')).length;
  console.log('Total users:', users.length);
  console.log('Users matching old regex (contains executive/exec):', oldCount);

  const posCounts = {};
  users.forEach(u => {
    posCounts[u.position] = (posCounts[u.position] || 0) + 1;
  });
  console.log('Position counts:', JSON.stringify(posCounts, null, 2));

  // Check roll numbers and academic years in DB
  const rollPrefixes = {};
  users.forEach(u => {
    const p = u.roll_number ? u.roll_number.substring(0, 3) : 'NONE';
    rollPrefixes[p] = (rollPrefixes[p] || 0) + 1;
  });
  console.log('Roll prefixes:', JSON.stringify(rollPrefixes, null, 2));
}
run().catch(console.error);
