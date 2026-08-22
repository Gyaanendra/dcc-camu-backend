import { Router, Response } from 'express';
import { db } from '../db';
import { teams, users, attendance, sessions } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { verifyToken, requireAdmin, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /api/teams (List all teams with member counts & real attendance analytics)
router.get('/', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const allTeams = await db.select().from(teams);
    const allUsers = await db.select().from(users);
    const allAttendance = await db.select().from(attendance);
    const allSessions = await db.select().from(sessions);

    const totalSessionsCount = allSessions.length || 1;

    const result = allTeams.map(t => {
      const teamMembers = allUsers.filter(u => u.teamId === t.id);
      const teamMemberIds = new Set(teamMembers.map(u => u.id));

      const teamAttendanceRecords = allAttendance.filter(a => teamMemberIds.has(a.userId));
      const totalPossible = teamMembers.length * totalSessionsCount;
      const attendedCount = teamAttendanceRecords.length;
      const attendancePercentage = totalPossible > 0 ? Math.round((attendedCount / totalPossible) * 100) : 0;

      return {
        ...t,
        memberCount: teamMembers.length,
        attendancePercentage,
        totalAttendanceRecords: attendedCount,
      };
    });

    return res.json({ teams: result });
  } catch (error: any) {
    console.error('Error fetching teams:', error);
    return res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

// POST /api/teams (Admin: Create team)
router.post('/', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, code, description, color } = req.body;

    if (!name || !code) {
      return res.status(400).json({ error: 'Team name and code are required.' });
    }

    const [newTeam] = await db
      .insert(teams)
      .values({
        name: name.trim(),
        code: code.trim().toUpperCase(),
        description: description || '',
        color: color || '#3b82f6',
      })
      .returning();

    return res.status(201).json({ message: 'Team created successfully', team: newTeam });
  } catch (error: any) {
    console.error('Error creating team:', error);
    return res.status(500).json({ error: 'Failed to create team.' });
  }
});

export default router;
