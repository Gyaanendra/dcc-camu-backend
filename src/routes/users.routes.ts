import { Router, Response } from 'express';
import { db } from '../db';
import { users, teams, attendance } from '../db/schema';
import { eq } from 'drizzle-orm';
import { verifyToken, requireAdmin, requireViewer, isUuid, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Bennett Email Pattern Regex (same rule as auth registration)
const BENNETT_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@bennett\.edu\.in$/i;

// POST /api/users (Admin: Create a new member directly)
router.post('/', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, email, password, rollNumber, position, teamId, role } = req.body;

    if (!name || !email || !password || !rollNumber) {
      return res.status(400).json({ error: 'Name, email, password, and roll number are required.' });
    }

    const trimmedEmail = email.trim().toLowerCase();

    if (!BENNETT_EMAIL_REGEX.test(trimmedEmail)) {
      return res.status(400).json({
        error: 'Member requires a valid Bennett University email address ending with @bennett.edu.in (e.g. s24cseu0771@bennett.edu.in).',
      });
    }

    // Check existing email / roll number
    const existingEmail = await db.select().from(users).where(eq(users.email, trimmedEmail)).limit(1);
    if (existingEmail.length > 0) {
      return res.status(400).json({ error: 'An account with this Bennett email already exists.' });
    }

    const trimmedRoll = rollNumber.trim();
    const existingRoll = await db.select().from(users).where(eq(users.rollNumber, trimmedRoll)).limit(1);
    if (existingRoll.length > 0) {
      return res.status(400).json({ error: 'An account with this roll number already exists.' });
    }

    // Validate team assignment if provided
    let validatedTeamId: string | null = null;
    if (teamId && teamId.trim()) {
      const foundTeam = await db.select().from(teams).where(eq(teams.id, teamId.trim())).limit(1);
      if (foundTeam.length === 0) {
        return res.status(400).json({ error: 'Assigned team not found.' });
      }
      validatedTeamId = foundTeam[0].id;
    }

    // Role can be 'admin' | 'advisor' | 'user' when explicitly set by an admin (defaults to 'user').
    // 'advisor' is a read-only role: can view dashboards/directories/sheets, cannot mutate anything.
    const assignedRole = role === 'admin' || role === 'advisor' ? role : 'user';

    const [newUser] = await db
      .insert(users)
      .values({
        name: name.trim(),
        email: trimmedEmail,
        password: password.trim(),
        rollNumber: trimmedRoll,
        position: position?.trim() || 'Member',
        role: assignedRole,
        teamId: validatedTeamId,
      })
      .returning();

    // Fetch team info if assigned
    let teamName = 'Unassigned';
    let teamCode = 'N/A';
    if (newUser.teamId) {
      const [team] = await db.select().from(teams).where(eq(teams.id, newUser.teamId)).limit(1);
      if (team) {
        teamName = team.name;
        teamCode = team.code;
      }
    }

    return res.status(201).json({
      message: 'Member created successfully',
      user: {
        ...newUser,
        teamName,
        teamCode,
      },
    });
  } catch (error: any) {
    console.error('Error creating member:', error);
    return res.status(500).json({ error: error.message || 'Failed to create member.' });
  }
});

// GET /api/users (Admin + Advisor read-only list all users)
router.get('/', verifyToken, requireViewer, async (req: AuthenticatedRequest, res: Response) => {
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

// PUT / PATCH /api/users/:id and /api/users/:id/role (Admin update user details, role, position, team)
const updateUserHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid user id.' });
    const { role, position, teamId, name, email, rollNumber, password } = req.body;

    const existing = await db.select().from(users).where(eq(users.id, id)).limit(1);

    if (existing.length === 0) return res.status(404).json({ error: 'User not found.' });

    const updateFields: any = {};
    if (role && (role === 'admin' || role === 'advisor' || role === 'user')) updateFields.role = role;
    if (position !== undefined) updateFields.position = position.trim() || 'Member';
    // Cross-check team assignment against the DB — never trust a client id.
    if (teamId !== undefined) {
      if (teamId) {
        if (!isUuid(teamId)) return res.status(400).json({ error: 'Invalid team id.' });
        const foundTeam = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
        if (foundTeam.length === 0) return res.status(400).json({ error: 'Assigned team not found.' });
        updateFields.teamId = foundTeam[0].id;
      } else {
        updateFields.teamId = null;
      }
    }
    if (name !== undefined && name.trim()) updateFields.name = name.trim();
    if (email !== undefined && email.trim()) updateFields.email = email.trim();
    if (rollNumber !== undefined && rollNumber.trim()) updateFields.rollNumber = rollNumber.trim().toUpperCase();
    if (password !== undefined && password.trim()) updateFields.password = password.trim();

    const [updatedUser] = await db.update(users).set(updateFields).where(eq(users.id, id)).returning();

    // Fetch team info if assigned
    let teamName = 'Unassigned';
    let teamCode = 'N/A';
    if (updatedUser.teamId) {
      const [team] = await db.select().from(teams).where(eq(teams.id, updatedUser.teamId)).limit(1);
      if (team) {
        teamName = team.name;
        teamCode = team.code;
      }
    }

    return res.json({
      message: 'User updated successfully',
      user: {
        ...updatedUser,
        teamName,
        teamCode,
      },
    });
  } catch (error: any) {
    console.error('Error updating user:', error);
    return res.status(500).json({ error: error.message || 'Failed to update user.' });
  }
};

// DELETE /api/users/:id (Admin delete user)
const deleteUserHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid user id.' });
    const existing = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (existing.length === 0) return res.status(404).json({ error: 'User not found.' });

    await db.delete(users).where(eq(users.id, id));
    return res.json({ message: 'User deleted successfully.' });
  } catch (error: any) {
    console.error('Error deleting user:', error);
    return res.status(500).json({ error: 'Failed to delete user.' });
  }
};

// Register for both standard REST (:id) and legacy role endpoint (:id/role)
router.put('/:id', verifyToken, requireAdmin, updateUserHandler);
router.patch('/:id', verifyToken, requireAdmin, updateUserHandler);
router.put('/:id/role', verifyToken, requireAdmin, updateUserHandler);
router.patch('/:id/role', verifyToken, requireAdmin, updateUserHandler);
router.delete('/:id', verifyToken, requireAdmin, deleteUserHandler);

export default router;

