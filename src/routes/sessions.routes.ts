import { Router, Response } from 'express';
import { db } from '../db';
import { sessions, users, teams, attendance } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { verifyToken, requireAdmin, isUuid, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /api/sessions (Fetch all sessions)
router.get('/', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [sessionList, allUsers, allTeams, allAttendance] = await Promise.all([
      db.select().from(sessions).orderBy(desc(sessions.startTime)),
      db.select().from(users),
      db.select().from(teams),
      db.select().from(attendance),
    ]);

    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const teamMap = new Map(allTeams.map(t => [t.id, t]));

    const enriched = sessionList.map(s => {
      const creator = s.createdById ? userMap.get(s.createdById) : null;
      const team = s.teamId ? teamMap.get(s.teamId) : null;
      const sessionAttendance = allAttendance.filter(a => a.sessionId === s.id);

      return {
        ...s,
        createdByName: creator ? creator.name : 'System Admin',
        teamName: team ? team.name : 'All Teams / Open Session',
        attendeeCount: sessionAttendance.length,
      };
    });

    return res.json({ sessions: enriched });
  } catch (error: any) {
    console.error('[Sessions Route] Error fetching sessions:', error);
    return res.status(500).json({ error: 'Failed to fetch sessions.' });
  }
});

// GET /api/sessions/:id (Fetch single session detail)
router.get('/:id', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid session id.' });
    const found = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);

    if (found.length === 0) return res.status(404).json({ error: 'Session not found.' });

    const session = found[0];
    const sessionAttendance = await db.select().from(attendance).where(eq(attendance.sessionId, session.id));
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));

    const attendees = sessionAttendance.map(a => {
      const user = userMap.get(a.userId);
      return {
        id: a.id,
        userId: a.userId,
        name: user ? user.name : 'Unknown',
        rollNumber: user ? user.rollNumber : 'N/A',
        email: user ? user.email : '',
        status: a.status,
        scannedAt: a.scannedAt,
        scanMethod: a.scanMethod,
      };
    });

    return res.json({
      session,
      attendees,
      attendeeCount: attendees.length,
    });
  } catch (error: any) {
    console.error(`[Sessions Route] Error fetching session ${req.params.id}:`, error);
    return res.status(500).json({ error: 'Failed to fetch session detail.' });
  }
});

// POST /api/sessions (Admin: Create new attendance session & generate QR token)
router.post('/', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, type, description, teamId, location, durationMinutes } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Session title is required.' });
    }

    const duration = durationMinutes ? parseInt(durationMinutes, 10) : 120; // default 2 hours
    if (!Number.isFinite(duration) || duration < 5 || duration > 1440) {
      return res.status(400).json({ error: 'Duration must be between 5 and 1440 minutes.' });
    }
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

    // Cross-check team assignment against the DB — never trust a client id.
    let validatedTeamId: string | null = null;
    if (teamId && String(teamId).trim()) {
      if (!isUuid(String(teamId).trim())) return res.status(400).json({ error: 'Invalid team id.' });
      const foundTeam = await db.select().from(teams).where(eq(teams.id, String(teamId).trim())).limit(1);
      if (foundTeam.length === 0) {
        return res.status(400).json({ error: 'Assigned team not found.' });
      }
      validatedTeamId = foundTeam[0].id;
    }

    // Generate unique QR code payload token
    const randomHex = Math.random().toString(36).substring(2, 10).toUpperCase();
    const qrCodeToken = `DCC_QR_${type || 'SESSION'}_${Date.now()}_${randomHex}`;

    const [newSession] = await db
      .insert(sessions)
      .values({
        title: title.trim(),
        type: type || 'regular',
        description: description || '',
        teamId: validatedTeamId,
        qrCodeToken,
        location: location || 'DCC Auditorium',
        createdById: req.user!.id,
        startTime,
        endTime,
        isActive: 'true',
      })
      .returning();

    return res.status(201).json({
      message: 'Session created successfully',
      session: newSession,
    });
  } catch (error: any) {
    console.error('[Sessions Route] Error creating session:', error);
    return res.status(500).json({ error: 'Failed to create session.' });
  }
});

// PATCH /api/sessions/:id/status (Admin: Close or Re-activate Live Session QR)
router.patch('/:id/status', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid session id.' });
    const { isActive } = req.body;

    const statusValue = isActive === true || isActive === 'true' ? 'true' : 'false';

    const [updatedSession] = await db
      .update(sessions)
      .set({ isActive: statusValue })
      .where(eq(sessions.id, id))
      .returning();

    if (!updatedSession) {
      return res.status(404).json({ error: 'Session not found' });
    }

    return res.json({
      message: statusValue === 'true' ? 'Session QR re-opened' : 'Live Session QR ended and closed successfully',
      session: updatedSession,
    });
  } catch (error: any) {
    console.error(`[Sessions Route] Error updating session status ${req.params.id}:`, error);
    return res.status(500).json({ error: 'Failed to update session status' });
  }
});

// GET /api/sessions/:id/qr (Fetch live dynamic QR code token)
router.get('/:id/qr', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid session id.' });
    const found = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);

    if (found.length === 0) return res.status(404).json({ error: 'Session not found.' });

    const session = found[0];

    return res.json({
      sessionId: session.id,
      title: session.title,
      qrCodeToken: session.qrCodeToken,
      expiresAt: session.endTime,
      isActive: session.isActive === 'true',
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch QR token.' });
  }
});

export default router;
