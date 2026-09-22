import { Router, Response } from 'express';
import { db } from '../db';
import { attendance, sessions, users, teams } from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { verifyToken, requireAdmin, requireViewer, blockAdvisor, isUuid, AuthenticatedRequest } from '../middleware/auth';
import { getAcademicYear, isSessionApplicableToUser, parseTargetTeamIds } from '../utils/member-helpers';

const router = Router();

// GET /api/attendance/sheet (Admin + Advisor read-only: full attendance matrix — members × sessions in one payload)
router.get('/sheet', verifyToken, requireViewer, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [allUsers, allSessions, allAttendance, allTeams] = await Promise.all([
      db.select().from(users),
      db.select().from(sessions).orderBy(desc(sessions.startTime)),
      db.select().from(attendance),
      db.select().from(teams),
    ]);

    const teamMap = new Map(allTeams.map(t => [t.id, t]));
    // "userId:sessionId" -> status, for O(1) cell lookups
    const recordMap = new Map(allAttendance.map(a => [`${a.userId}:${a.sessionId}`, a.status]));

    const sessionList = allSessions.map(s => {
      const parsedTeams = parseTargetTeamIds(s.targetTeamIds, s.teamId);
      return {
        id: s.id,
        title: s.title,
        type: s.type,
        startTime: s.startTime,
        isActive: s.isActive,
        targetAudience: s.targetAudience || 'all',
        targetTeamIds: parsedTeams,
      };
    });

    const members = allUsers
      .map(u => {
        const team = u.teamId ? teamMap.get(u.teamId) : null;
        const records: Record<string, string | null> = {};
        let attended = 0;
        let eligibleSessions = 0;
        const isExempt = u.role === 'advisor';

        for (const s of allSessions) {
          const status = recordMap.get(`${u.id}:${s.id}`) || null;

          if (isExempt) {
            records[s.id] = status || 'advisor_exempt';
            if (status === 'present' || status === 'late') attended++;
          } else if (status === 'not_in_club') {
            // Marked explicitly as not in club -> does NOT count against denominator
            records[s.id] = 'not_in_club';
          } else if (status === 'present' || status === 'late') {
            records[s.id] = status;
            attended++;
            eligibleSessions++;
          } else {
            // No record in DB -> evaluate applicability (pre-join date, wing restriction, heads only)
            const applicability = isSessionApplicableToUser(s, u, false);
            if (!applicability.applicable) {
              records[s.id] = applicability.reason || 'not_applicable';
            } else {
              // Applicable meeting, but member did not attend
              records[s.id] = null; // Unexcused absence
              eligibleSessions++;
            }
          }
        }

        const attendanceRate = isExempt
          ? 100
          : eligibleSessions > 0
          ? Math.round((attended / eligibleSessions) * 100)
          : 100;

        return {
          id: u.id,
          name: u.name,
          rollNumber: u.rollNumber,
          academicYear: getAcademicYear(u.rollNumber),
          position: u.position,
          role: u.role,
          isExempt,
          teamId: u.teamId,
          teamName: team ? team.name : 'Unassigned',
          teamCode: team ? team.code : 'N/A',
          avatarUrl: u.avatarUrl,
          attended,
          eligibleSessions,
          attendanceRate,
          records,
        };
      })
      // Team-wise ordering (Unassigned last), then by name
      .sort((a, b) => {
        const teamRank = (t: string) => (t === 'Unassigned' ? 1 : 0);
        if (teamRank(a.teamName) !== teamRank(b.teamName)) return teamRank(a.teamName) - teamRank(b.teamName);
        return a.teamName.localeCompare(b.teamName) || a.name.localeCompare(b.name);
      });

    return res.json({
      sessions: sessionList,
      members,
      summary: {
        totalMembers: allUsers.filter(u => u.role === 'user').length,
        totalAdmins: allUsers.filter(u => u.role === 'admin').length,
        totalAdvisors: allUsers.filter(u => u.role === 'advisor').length,
        totalUsers: allUsers.length,
        totalSessions: allSessions.length,
        totalRecords: allAttendance.length,
      },
    });
  } catch (error: any) {
    console.error('Error building attendance sheet:', error);
    return res.status(500).json({ error: 'Failed to build attendance sheet.' });
  }
});

// POST /api/attendance/scan (Process high-speed QR check-in — advisors are view-only, blocked)
router.post('/scan', verifyToken, blockAdvisor, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { qrCodeToken, memberRollNumber, sessionId } = req.body;
    const currentUser = req.user!;

    let session: any = null;
    let targetUser: any = null;

    // Case 1: Member scanned a Session QR token
    if (qrCodeToken) {
      let cleanToken = qrCodeToken.trim();
      // If token is wrapped in JSON, extract token field
      if (cleanToken.startsWith('{') && cleanToken.endsWith('}')) {
        try {
          const parsed = JSON.parse(cleanToken);
          if (parsed.qrCodeToken || parsed.token) cleanToken = (parsed.qrCodeToken || parsed.token).trim();
        } catch (_) {}
      }

      const foundSessions = await db.select().from(sessions).where(eq(sessions.qrCodeToken, cleanToken)).limit(1);
      if (foundSessions.length === 0) {
        return res.status(404).json({ error: 'Invalid or expired Session QR Code.' });
      }

      session = foundSessions[0];
      targetUser = {
        id: currentUser.id,
        name: currentUser.name,
        rollNumber: currentUser.rollNumber,
        role: currentUser.role,
        position: currentUser.position,
        teamId: currentUser.teamId,
      };
    } else if (memberRollNumber && currentUser.role === 'admin') {
      // Case 2: Admin scanned or entered a Member's Roll Number
      const trimmedRoll = memberRollNumber.trim().toUpperCase();
      if (sessionId && !isUuid(sessionId)) {
        return res.status(400).json({ error: 'Invalid session id.' });
      }

      // Parallelize target user lookup and session resolution
      const userPromise = db
        .select({
          id: users.id,
          name: users.name,
          rollNumber: users.rollNumber,
          role: users.role,
          position: users.position,
          teamId: users.teamId,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(sql`UPPER(${users.rollNumber}) = ${trimmedRoll}`)
        .limit(1);

      const sessionPromise = sessionId
        ? db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
        : db.select().from(sessions).where(eq(sessions.isActive, 'true')).orderBy(desc(sessions.startTime)).limit(1);

      const [userResults, sessionResults] = await Promise.all([userPromise, sessionPromise]);

      if (userResults.length === 0) {
        return res.status(404).json({ error: `Member with Roll Number "${memberRollNumber}" not found.` });
      }
      targetUser = userResults[0];

      if (sessionResults.length === 0) {
        return res.status(sessionId ? 404 : 400).json({
          error: sessionId ? 'Target attendance session not found.' : 'No live session currently active. Please activate a session in Sessions & QR.',
        });
      }
      session = sessionResults[0];
    } else {
      return res.status(400).json({ error: 'Invalid scan payload. Provide valid QR token or Roll Number.' });
    }

    // Check audience restrictions (Heads only, Specific Wings)
    const applicability = isSessionApplicableToUser(session, targetUser, false);
    if (!applicability.applicable) {
      if (applicability.reason === 'not_a_head') {
        return res.status(403).json({ error: 'This meeting is reserved for Club Heads & Leads only.' });
      }
      if (applicability.reason === 'not_in_team') {
        return res.status(403).json({ error: 'This meeting is reserved for members of specific wings only.' });
      }
    }

    // Check if session has been closed / ended
    if (session.isActive !== 'true') {
      return res.status(400).json({
        error: `Session "${session.title}" has ended and Live QR attendance is closed.`,
        isEnded: true,
      });
    }

    // Check if already checked in (lightweight check)
    const existingCheckin = await db
      .select({ id: attendance.id, scannedAt: attendance.scannedAt, status: attendance.status })
      .from(attendance)
      .where(and(eq(attendance.sessionId, session.id), eq(attendance.userId, targetUser.id)))
      .limit(1);

    if (existingCheckin.length > 0) {
      return res.status(409).json({
        error: `Member ${targetUser.name} (${targetUser.rollNumber}) is already checked in for this session!`,
        alreadyCheckedIn: true,
        record: existingCheckin[0],
      });
    }

    // Determine status (Punctual vs Late). Legacy rows may lack startTime —
    // treat those as on-time instead of crashing on `.getTime()`.
    const now = new Date();
    const sessionStart = session.startTime ? new Date(session.startTime) : now;
    const isLate = now > new Date(sessionStart.getTime() + 15 * 60 * 1000); // > 15 mins late
    const status = isLate ? 'late' : 'present';

    // Insert attendance record
    const [newRecord] = await db
      .insert(attendance)
      .values({
        sessionId: session.id,
        userId: targetUser.id,
        status,
        scanMethod: currentUser.role === 'admin' ? 'admin_scanner' : 'user_scanner',
        scannedAt: now,
        metadata: JSON.stringify({ scannedBy: currentUser.name, clientIp: req.ip }),
      })
      .returning();

    return res.status(201).json({
      message: 'Attendance marked successfully!',
      status,
      user: {
        id: targetUser.id,
        name: targetUser.name,
        rollNumber: targetUser.rollNumber,
        avatarUrl: targetUser.avatarUrl,
      },
      session: {
        id: session.id,
        title: session.title,
      },
      record: newRecord,
    });
  } catch (error: any) {
    console.error('Attendance scan error:', error);
    return res.status(500).json({ error: 'Failed to record attendance.' });
  }
});

// POST /api/attendance/manual (Admin: Manual Override)
router.post('/manual', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId, userId, action } = req.body; 
    // action = 'mark_present' | 'mark_late' | 'mark_absent' | 'mark_not_in_club'

    if (!sessionId || !userId) {
      return res.status(400).json({ error: 'Session ID and User ID are required.' });
    }

    // Cross-check both ids against the DB — never trust client-supplied ids.
    if (!isUuid(sessionId) || !isUuid(userId)) {
      return res.status(400).json({ error: 'Invalid Session ID or User ID.' });
    }
    const [targetSession, targetUser] = await Promise.all([
      db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, sessionId)).limit(1),
      db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId)).limit(1),
    ]);
    if (targetSession.length === 0) return res.status(404).json({ error: 'Target session not found.' });
    if (targetUser.length === 0) return res.status(404).json({ error: 'Target member not found.' });

    if (action === 'mark_absent') {
      await db.delete(attendance).where(and(eq(attendance.sessionId, sessionId), eq(attendance.userId, userId)));
      return res.json({ message: `Attendance record removed for ${targetUser[0].name} (marked absent).`, status: 'absent' });
    } else {
      const targetStatus: 'present' | 'late' | 'not_in_club' =
        action === 'mark_late' ? 'late' : action === 'mark_not_in_club' ? 'not_in_club' : 'present';

      const existing = await db
        .select()
        .from(attendance)
        .where(and(eq(attendance.sessionId, sessionId), eq(attendance.userId, userId)))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(attendance).values({
          sessionId,
          userId,
          status: targetStatus,
          scanMethod: 'manual',
          scannedAt: new Date(),
          metadata: JSON.stringify({ overriddenByAdmin: req.user!.name, action }),
        });
      } else {
        await db
          .update(attendance)
          .set({
            status: targetStatus,
            metadata: JSON.stringify({ overriddenByAdmin: req.user!.name, previousStatus: existing[0].status, action }),
          })
          .where(and(eq(attendance.sessionId, sessionId), eq(attendance.userId, userId)));
      }

      const statusLabels = {
        present: 'present (on time)',
        late: 'late',
        not_in_club: 'not in club (exempt)',
      };

      return res.json({
        message: `Marked ${targetUser[0].name} as ${statusLabels[targetStatus]}.`,
        status: targetStatus,
      });
    }
  } catch (error: any) {
    console.error('Manual attendance error:', error);
    return res.status(500).json({ error: 'Manual attendance override failed.' });
  }
});

// GET /api/attendance/my-stats (aka /my_stats) — User: Personal Attendance Analytics
const getMyStatsHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const [userRecord, allSessions, myAttendance] = await Promise.all([
      db.select().from(users).where(eq(users.id, userId)).limit(1),
      db.select().from(sessions).orderBy(desc(sessions.startTime)),
      db.select().from(attendance).where(eq(attendance.userId, userId)),
    ]);

    const currentUser = userRecord[0] || req.user!;
    const isExempt = currentUser.role === 'advisor';

    const attendanceMap = new Map(myAttendance.map(a => [a.sessionId, a]));

    // Calculate eligible sessions (considering join date, wing restriction, and not_in_club manual overrides)
    let totalEligibleSessions = 0;
    let attendedCount = 0;
    let lateCount = 0;

    for (const s of allSessions) {
      const record = attendanceMap.get(s.id);
      if (isExempt) {
        if (record?.status === 'present' || record?.status === 'late') attendedCount++;
      } else if (record?.status === 'not_in_club') {
        // Not in club -> exempt from denominator
      } else if (record?.status === 'present' || record?.status === 'late') {
        attendedCount++;
        totalEligibleSessions++;
        if (record.status === 'late') lateCount++;
      } else {
        const applicability = isSessionApplicableToUser(s, currentUser, false);
        if (applicability.applicable) {
          totalEligibleSessions++;
        }
      }
    }

    const attendancePercentage = isExempt
      ? 100
      : totalEligibleSessions > 0
      ? Math.round((attendedCount / totalEligibleSessions) * 100)
      : 100;

    // Calculate Streak
    const sortedAttendance = [...myAttendance].sort((a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime());
    let currentStreak = 0;
    for (const record of sortedAttendance) {
      if (record.status === 'present' || record.status === 'late') {
        currentStreak++;
      } else {
        break;
      }
    }

    const onTimeCount = attendedCount - lateCount;
    const punctualityPercentage = attendedCount > 0 ? Math.round((onTimeCount / attendedCount) * 100) : 100;

    // Detail breakdown
    const sessionMap = new Map(allSessions.map(s => [s.id, s]));
    const history = sortedAttendance.map(a => {
      const sess = sessionMap.get(a.sessionId);
      return {
        id: a.id,
        sessionTitle: sess ? sess.title : 'Session',
        sessionType: sess ? sess.type : 'regular',
        location: sess ? sess.location : 'DCC Hub',
        scannedAt: a.scannedAt,
        status: a.status,
      };
    });

    return res.json({
      stats: {
        totalSessions: totalEligibleSessions,
        attendedCount,
        absentCount: Math.max(0, totalEligibleSessions - attendedCount),
        attendancePercentage,
        currentStreak,
        punctualityPercentage,
        isExempt,
        exemptionNote: isExempt ? 'Faculty / Club Advisor (Attendance Exempt)' : null,
      },
      history,
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch personal stats.' });
  }
};

router.get('/my-stats', verifyToken, getMyStatsHandler);
router.get('/my_stats', verifyToken, getMyStatsHandler);

// GET /api/attendance/analytics or /api/attendance/admin-analytics (Admin: Comprehensive Analytics Engine)
const getAdminAnalyticsHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [allUsers, allTeams, allSessions, allAttendance] = await Promise.all([
      db.select().from(users),
      db.select().from(teams),
      db.select().from(sessions),
      db.select().from(attendance),
    ]);

    const memberUsers = allUsers.filter(u => u.role === 'user');
    const adminUsers = allUsers.filter(u => u.role === 'admin');
    const advisorUsers = allUsers.filter(u => u.role === 'advisor');
    const nonAdvisorUsers = allUsers.filter(u => u.role !== 'advisor');

    const totalMembers = memberUsers.length;
    const totalAdmins = adminUsers.length;
    const totalAdvisors = advisorUsers.length;
    const totalUsers = allUsers.length;
    const totalSessions = allSessions.length;

    // Build O(1) attendance lookup
    const recordMap = new Map(allAttendance.map(a => [`${a.userId}:${a.sessionId}`, a.status]));

    // Individual Member Breakdown with prorated eligibility & academic year
    const teamMap = new Map(allTeams.map(t => [t.id, t]));
    let totalPossibleOpportunities = 0;
    let totalValidAttendedAcrossMembers = 0;

    const memberAnalytics = allUsers.map(member => {
      const isExempt = member.role === 'advisor';
      let eligibleSessions = 0;
      let attended = 0;

      for (const s of allSessions) {
        const status = recordMap.get(`${member.id}:${s.id}`);
        if (isExempt) {
          if (status === 'present' || status === 'late') attended++;
        } else if (status === 'not_in_club') {
          // Exempt from denominator
        } else if (status === 'present' || status === 'late') {
          attended++;
          eligibleSessions++;
        } else {
          const applicability = isSessionApplicableToUser(s, member, false);
          if (applicability.applicable) {
            eligibleSessions++;
          }
        }
      }

      if (!isExempt) {
        totalPossibleOpportunities += eligibleSessions;
        totalValidAttendedAcrossMembers += attended;
      }

      const rate = isExempt
        ? 100
        : eligibleSessions > 0
        ? Math.round((attended / eligibleSessions) * 100)
        : 100;

      const team = member.teamId ? teamMap.get(member.teamId) : null;
      const memberLogs = allAttendance.filter(a => a.userId === member.id && (a.status === 'present' || a.status === 'late'));

      return {
        id: member.id,
        name: member.name,
        email: member.email,
        rollNumber: member.rollNumber,
        academicYear: getAcademicYear(member.rollNumber),
        role: member.role,
        isExempt,
        teamName: team ? team.name : 'Unassigned',
        teamCode: team ? team.code : 'N/A',
        avatarUrl: member.avatarUrl,
        attendedSessions: attended,
        eligibleSessions,
        totalSessions,
        attendancePercentage: rate,
        lastActive: memberLogs.length > 0 ? memberLogs[memberLogs.length - 1].scannedAt : member.createdAt,
      };
    });

    const overallAttendanceRate =
      totalPossibleOpportunities > 0
        ? Math.round((totalValidAttendedAcrossMembers / totalPossibleOpportunities) * 100)
        : 100;

    // Teamwise Breakdown Analytics (excluding advisors)
    const teamAnalytics = allTeams.map(team => {
      const teamMembers = memberUsers.filter(u => u.teamId === team.id);
      let teamPossible = 0;
      let teamPresent = 0;
      let teamLate = 0;

      for (const m of teamMembers) {
        for (const s of allSessions) {
          const status = recordMap.get(`${m.id}:${s.id}`);
          if (status === 'not_in_club') continue;
          if (status === 'present') {
            teamPresent++;
            teamPossible++;
          } else if (status === 'late') {
            teamLate++;
            teamPossible++;
          } else {
            const app = isSessionApplicableToUser(s, m, false);
            if (app.applicable) teamPossible++;
          }
        }
      }

      const teamTotal = teamPresent + teamLate;
      const rate = teamPossible > 0 ? Math.round((teamTotal / teamPossible) * 100) : 100;

      return {
        teamId: team.id,
        teamName: team.name,
        code: team.code,
        color: team.color,
        memberCount: teamMembers.length,
        totalPresent: teamPresent,
        totalLate: teamLate,
        totalAttendanceCount: teamTotal,
        attendanceRate: rate,
      };
    });

    // Punctuality Metrics
    const onTimeCount = allAttendance.filter(a => a.status === 'present').length;
    const lateCount = allAttendance.filter(a => a.status === 'late').length;

    return res.json({
      summary: {
        totalMembers,
        totalAdmins,
        totalAdvisors,
        totalUsers,
        totalSessions,
        totalAttendanceRecords: allAttendance.filter(a => a.status === 'present' || a.status === 'late').length,
        overallAttendanceRate,
        onTimeCount,
        lateCount,
      },
      teamAnalytics,
      memberAnalytics,
    });
  } catch (error: any) {
    console.error('Analytics computation error:', error);
    return res.status(500).json({ error: 'Failed to compute analytics.' });
  }
};

router.get('/analytics', verifyToken, requireViewer, getAdminAnalyticsHandler);
router.get('/admin-analytics', verifyToken, requireViewer, getAdminAnalyticsHandler);
router.get('/admin_analytics', verifyToken, requireViewer, getAdminAnalyticsHandler);

export default router;
