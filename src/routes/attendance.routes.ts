import { Router, Response } from 'express';
import { db } from '../db';
import { attendance, sessions, users, teams } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { verifyToken, requireAdmin, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// POST /api/attendance/scan (Process high-speed QR check-in)
router.post('/scan', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { qrCodeToken, memberRollNumber, sessionId, scanMethod } = req.body;
    const currentUser = req.user!;

    let targetUserId = currentUser.id;
    let targetSessionId = sessionId;

    // Case 1: Member scanned a Session QR token
    if (qrCodeToken) {
      const foundSessions = await db.select().from(sessions).where(eq(sessions.qrCodeToken, qrCodeToken.trim())).limit(1);

      if (foundSessions.length === 0) {
        return res.status(404).json({ error: 'Invalid or expired Session QR Code.' });
      }

      const session = foundSessions[0];
      targetSessionId = session.id;
    } else if (memberRollNumber && currentUser.role === 'admin' && sessionId) {
      // Case 2: Admin scanned a Member's Roll Number / QR badge
      const foundMembers = await db.select().from(users).where(eq(users.rollNumber, memberRollNumber.trim())).limit(1);
      if (foundMembers.length === 0) {
        return res.status(404).json({ error: `Member with Roll Number "${memberRollNumber}" not found.` });
      }
      targetUserId = foundMembers[0].id;
    } else {
      return res.status(400).json({ error: 'Invalid scan payload. Provide valid QR token or Roll Number.' });
    }

    // Verify Session
    const foundSessions = await db.select().from(sessions).where(eq(sessions.id, targetSessionId)).limit(1);
    if (foundSessions.length === 0) {
      return res.status(404).json({ error: 'Target attendance session not found.' });
    }

    const session = foundSessions[0];

    // Verify User
    const targetUserList = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    if (targetUserList.length === 0) {
      return res.status(404).json({ error: 'User record not found.' });
    }
    const targetUser = targetUserList[0];

    // Check if already checked in
    const existingCheckin = await db
      .select()
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

    // Determine status (Punctual vs Late)
    const now = new Date();
    const isLate = now > new Date(session.startTime.getTime() + 15 * 60 * 1000); // > 15 mins late
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
    const { sessionId, userId, action } = req.body; // action = 'mark_present' | 'mark_absent'

    if (!sessionId || !userId) {
      return res.status(400).json({ error: 'Session ID and User ID are required.' });
    }

    if (action === 'mark_absent') {
      await db.delete(attendance).where(and(eq(attendance.sessionId, sessionId), eq(attendance.userId, userId)));
      return res.json({ message: 'Attendance record removed (marked absent).' });
    } else {
      const existing = await db
        .select()
        .from(attendance)
        .where(and(eq(attendance.sessionId, sessionId), eq(attendance.userId, userId)))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(attendance).values({
          sessionId,
          userId,
          status: 'present',
          scanMethod: 'manual',
          scannedAt: new Date(),
          metadata: JSON.stringify({ overriddenByAdmin: req.user!.name }),
        });
      }
      return res.json({ message: 'Attendance marked present manually.' });
    }
  } catch (error: any) {
    return res.status(500).json({ error: 'Manual attendance override failed.' });
  }
});

// GET /api/attendance/my-stats (User: Personal Attendance Analytics)
router.get('/my-stats', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const allSessions = await db.select().from(sessions);
    const myAttendance = await db.select().from(attendance).where(eq(attendance.userId, userId));

    const totalEligibleSessions = allSessions.length;
    const attendedCount = myAttendance.length;
    const attendancePercentage = totalEligibleSessions > 0 ? Math.round((attendedCount / totalEligibleSessions) * 100) : 0;

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
      },
      history,
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch personal stats.' });
  }
});

// GET /api/attendance/analytics (Admin: Comprehensive Analytics Engine)
router.get('/analytics', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const allUsers = await db.select().from(users);
    const allTeams = await db.select().from(teams);
    const allSessions = await db.select().from(sessions);
    const allAttendance = await db.select().from(attendance);

    const memberUsers = allUsers.filter(u => u.role === 'user');
    const totalMembers = memberUsers.length;
    const totalSessions = allSessions.length;
    const totalPossibleAttendance = totalMembers * (totalSessions || 1);
    const totalPresentRecords = allAttendance.length;

    const overallAttendanceRate = totalPossibleAttendance > 0 ? Math.round((totalPresentRecords / totalPossibleAttendance) * 100) : 0;

    // Teamwise Breakdown Analytics
    const teamAnalytics = allTeams.map(team => {
      const teamMembers = memberUsers.filter(u => u.teamId === team.id);
      const memberIds = new Set(teamMembers.map(u => u.id));
      const teamAttendanceLogs = allAttendance.filter(a => memberIds.has(a.userId));

      const teamPossible = teamMembers.length * (totalSessions || 1);
      const teamPresent = teamAttendanceLogs.filter(a => a.status === 'present').length;
      const teamLate = teamAttendanceLogs.filter(a => a.status === 'late').length;
      const teamTotal = teamPresent + teamLate;
      const rate = teamPossible > 0 ? Math.round((teamTotal / teamPossible) * 100) : 0;

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

    // Individual Member Breakdown
    const teamMap = new Map(allTeams.map(t => [t.id, t]));
    const memberAnalytics = memberUsers.map(member => {
      const memberLogs = allAttendance.filter(a => a.userId === member.id);
      const attended = memberLogs.length;
      const rate = totalSessions > 0 ? Math.round((attended / totalSessions) * 100) : 0;
      const team = member.teamId ? teamMap.get(member.teamId) : null;

      return {
        id: member.id,
        name: member.name,
        email: member.email,
        rollNumber: member.rollNumber,
        teamName: team ? team.name : 'Unassigned',
        teamCode: team ? team.code : 'N/A',
        attendedSessions: attended,
        totalSessions,
        attendancePercentage: rate,
        lastActive: memberLogs.length > 0 ? memberLogs[memberLogs.length - 1].scannedAt : member.createdAt,
      };
    });

    return res.json({
      summary: {
        totalMembers,
        totalSessions,
        totalAttendanceRecords: totalPresentRecords,
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
});

export default router;
