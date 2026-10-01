const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);

async function testSheetStats() {
  const [allUsers, allSessions, allAttendance] = await Promise.all([
    sql`SELECT * FROM users`,
    sql`SELECT * FROM sessions ORDER BY start_time DESC`,
    sql`SELECT * FROM attendance`,
  ]);

  const { isSessionApplicableToUser, getAcademicYear } = require('../dist/utils/member-helpers');

  const targetSessionId = '7519190a-fa1b-4a44-aec1-f94e88861213';
  const targetSession = allSessions.find(s => s.id === targetSessionId);

  console.log('--- TARGET SESSION SUMMARY ---');
  console.log('Title:', targetSession.title);
  console.log('Audience:', targetSession.target_audience);
  console.log('Target Years:', targetSession.target_years);

  let attendedCount = 0;
  let absentCount = 0;
  let excludedCount = 0;

  const recordMap = new Map(allAttendance.map(a => [`${a.user_id}:${a.session_id}`, a.status]));

  for (const u of allUsers) {
    const formattedUser = {
      ...u,
      rollNumber: u.roll_number,
      teamId: u.team_id,
      createdAt: u.created_at,
    };
    const formattedSession = {
      ...targetSession,
      targetAudience: targetSession.target_audience,
      targetTeamIds: targetSession.target_team_ids,
      targetYears: targetSession.target_years,
      startTime: targetSession.start_time,
    };

    const status = recordMap.get(`${u.id}:${targetSession.id}`);
    if (status === 'present' || status === 'late') {
      attendedCount++;
    } else {
      const app = isSessionApplicableToUser(formattedSession, formattedUser, false);
      if (!app.applicable) {
        excludedCount++;
      } else {
        absentCount++;
      }
    }
  }

  console.log('Attended (Present/Late):', attendedCount);
  console.log('Unexcused Absent (Eligible but missed):', absentCount);
  console.log('Excluded from denominator (Not in year / advisor / etc.):', excludedCount);
  console.log('Total club users:', allUsers.length);
}

testSheetStats().catch(console.error);
