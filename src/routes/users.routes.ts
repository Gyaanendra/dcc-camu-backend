import { Router, Response } from 'express';
import { db } from '../db';
import { users, teams, attendance } from '../db/schema';
import { eq } from 'drizzle-orm';
import { verifyToken, requireAdmin, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /api/users (Admin list all users)
router.get('/', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const allUsers = await db.select().from(users);
    const allTeams = await db.select().from(teams);
    const allAttendance = await db.select().from(attendance);

    const teamMap = new Map(allTeams.map(t => [t.id, t]));

    const result = allUsers.map(u => {
      const team = u.teamId ? teamMap.get(u.teamId) : null;
      const userLogs = allAttendance.filter(a => a.userId === u.id);

      return {
        id: u.id,
        name: u.name,
        email: u.email,
        rollNumber: u.rollNumber,
        position: u.position,
        role: u.role,
        teamId: u.teamId,
        teamName: team ? team.name : 'Unassigned',
        teamCode: team ? team.code : 'N/A',
        avatarUrl: u.avatarUrl,
        totalAttended: userLogs.length,
        createdAt: u.createdAt,
      };
    });

    return res.json({ users: result });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to list users.' });
  }
});

// PUT / PATCH /api/users/:id/role (Admin update role, position, or team)
const updateRoleHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { role, position, teamId } = req.body;

    const existing = await db.select().from(users).where(eq(users.id, id)).limit(1);

    if (existing.length === 0) return res.status(404).json({ error: 'User not found.' });

    const updateFields: any = {};
    if (role && (role === 'admin' || role === 'user')) updateFields.role = role;
    if (position !== undefined) updateFields.position = position.trim() || 'Member';
    if (teamId !== undefined) updateFields.teamId = teamId || null;

    const [updatedUser] = await db.update(users).set(updateFields).where(eq(users.id, id)).returning();

    return res.json({ message: 'User updated successfully', user: updatedUser });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to update user.' });
  }
};

router.put('/:id/role', verifyToken, requireAdmin, updateRoleHandler);
router.patch('/:id/role', verifyToken, requireAdmin, updateRoleHandler);

export default router;
