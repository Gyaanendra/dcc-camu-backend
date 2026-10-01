const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);

const { isSessionApplicableToUser, isUserHead, getAcademicYear, parseTargetYears } = require('../dist/utils/member-helpers');

async function test() {
  const [allUsers, sessionRow] = await Promise.all([
    sql`SELECT * FROM users`,
    sql`SELECT * FROM sessions WHERE id = '7519190a-fa1b-4a44-aec1-f94e88861213'`
  ]);

  const s = sessionRow[0];
  console.log('Testing session:', s.title);
  console.log('Target audience:', s.target_audience, 'Target years:', s.target_years);

  const formattedSession = {
    ...s,
    targetAudience: s.target_audience,
    targetTeamIds: s.target_team_ids,
    targetYears: s.target_years,
    startTime: s.start_time,
  };

  const resultsByYear = {};

  for (const u of allUsers) {
    const formattedUser = {
      ...u,
      rollNumber: u.roll_number,
      teamId: u.team_id,
      createdAt: u.created_at,
    };
    const year = getAcademicYear(u.roll_number);
    if (!resultsByYear[year]) {
      resultsByYear[year] = { applicable: 0, not_applicable: 0, reasons: {} };
    }

    const app = isSessionApplicableToUser(formattedSession, formattedUser, false);
    if (app.applicable) {
      resultsByYear[year].applicable++;
    } else {
      resultsByYear[year].not_applicable++;
      resultsByYear[year].reasons[app.reason] = (resultsByYear[year].reasons[app.reason] || 0) + 1;
    }
  }

  console.log('Results by year for this 3rd year session:');
  console.log(JSON.stringify(resultsByYear, null, 2));
}

test().catch(console.error);
