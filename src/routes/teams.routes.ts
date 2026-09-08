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

// GET /api/teams/:id (Get single team with members)
router.get('/:id', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const [team] = await db.select().from(teams).where(eq(teams.id, id)).limit(1);
    if (!team) return res.status(404).json({ error: 'Team not found.' });

    const teamMembers = await db.select().from(users).where(eq(users.teamId, id));
    return res.json({ team, members: teamMembers });
  } catch (error: any) {
    console.error('Error fetching team:', error);
    return res.status(500).json({ error: 'Failed to fetch team.' });
  }
});

// PUT / PATCH /api/teams/:id (Admin: Update team details)
const updateTeamHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, code, description, color } = req.body;

    const existing = await db.select().from(teams).where(eq(teams.id, id)).limit(1);
    if (existing.length === 0) return res.status(404).json({ error: 'Team not found.' });

    const updateFields: any = {};
    if (name !== undefined && name.trim()) updateFields.name = name.trim();
    if (code !== undefined && code.trim()) updateFields.code = code.trim().toUpperCase();
    if (description !== undefined) updateFields.description = description;
    if (color !== undefined && color.trim()) updateFields.color = color.trim();

    const [updatedTeam] = await db.update(teams).set(updateFields).where(eq(teams.id, id)).returning();
    return res.json({ message: 'Team updated successfully', team: updatedTeam });
  } catch (error: any) {
    console.error('Error updating team:', error);
    return res.status(500).json({ error: error.message || 'Failed to update team.' });
  }
};

router.put('/:id', verifyToken, requireAdmin, updateTeamHandler);
router.patch('/:id', verifyToken, requireAdmin, updateTeamHandler);

// DELETE /api/teams/:id (Admin: Delete team)
router.delete('/:id', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await db.select().from(teams).where(eq(teams.id, id)).limit(1);
    if (existing.length === 0) return res.status(404).json({ error: 'Team not found.' });

    // Users belonging to this team will have teamId set to null (db schema onDelete: 'set null')
    await db.delete(teams).where(eq(teams.id, id));
    return res.json({ message: 'Team deleted successfully.' });
  } catch (error: any) {
    console.error('Error deleting team:', error);
    return res.status(500).json({ error: 'Failed to delete team.' });
  }
});

export default router;

