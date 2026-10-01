const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);

async function run() {
  console.log('Adding target_years column to sessions table...');
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS target_years text`;
  console.log('Column target_years added or already exists.');

  console.log('Updating session 7519190a-fa1b-4a44-aec1-f94e88861213 target_years to ["3rd Year"]...');
  const res = await sql`
    UPDATE sessions 
    SET target_years = '["3rd Year"]'
    WHERE id = '7519190a-fa1b-4a44-aec1-f94e88861213'
    RETURNING id, title, target_audience, target_years
  `;
  console.log('Updated session:', res);
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
