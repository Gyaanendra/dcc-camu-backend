import { Router, Request, Response } from 'express';
import { db } from '../db';
import { users, teams } from '../db/schema';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { verifyToken, AuthenticatedRequest } from '../middleware/auth';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dcc_camu_super_secret_jwt_key_2026';

// Bennett Email Pattern Regex
const BENNETT_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@bennett\.edu\.in$/i;

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Bennett Email Validation
    if (!BENNETT_EMAIL_REGEX.test(trimmedEmail)) {
      return res.status(400).json({
        error: 'Login requires a valid Bennett email ending with @bennett.edu.in (e.g. s24cseu0771@bennett.edu.in).',
      });
    }

    const foundUsers = await db.select().from(users).where(eq(users.email, trimmedEmail)).limit(1);

    if (foundUsers.length === 0) {
      return res.status(401).json({ error: 'Invalid Bennett email or password.' });
    }

    const user = foundUsers[0];

    // Simple plain text password check against 'password' column
    if (user.password !== password.trim()) {
      return res.status(401).json({ error: 'Invalid Bennett email or password.' });
    }

    // Fetch team details if assigned
    let teamName = 'Unassigned';
    if (user.teamId) {
      const foundTeams = await db.select().from(teams).where(eq(teams.id, user.teamId)).limit(1);
      if (foundTeams.length > 0) teamName = foundTeams[0].name;
    }

    const payload = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      position: user.position,
      teamId: user.teamId,
      rollNumber: user.rollNumber,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    return res.json({
      message: 'Login successful',
      token,
      user: {
        ...payload,
        avatarUrl: user.avatarUrl,
        teamName,
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error during login.' });
  }
});

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, email, password, rollNumber, position, teamId } = req.body;

    if (!name || !email || !password || !rollNumber) {
      return res.status(400).json({ error: 'Name, email, password, and roll number are required.' });
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Bennett Email Validation Check
    if (!BENNETT_EMAIL_REGEX.test(trimmedEmail)) {
      return res.status(400).json({
        error: 'Registration requires a valid Bennett University email address ending with @bennett.edu.in (e.g. s24cseu0771@bennett.edu.in).',
      });
    }

    // Check existing
    const existingEmail = await db.select().from(users).where(eq(users.email, trimmedEmail)).limit(1);
    if (existingEmail.length > 0) {
      return res.status(400).json({ error: 'An account with this Bennett email already exists.' });
    }

    const existingRoll = await db.select().from(users).where(eq(users.rollNumber, rollNumber.trim())).limit(1);
    if (existingRoll.length > 0) {
      return res.status(400).json({ error: 'An account with this roll number already exists.' });
    }

    // Default role is strictly 'user'. Save plain text password directly into 'password' column
    const [newUser] = await db
      .insert(users)
      .values({
        name: name.trim(),
        email: trimmedEmail,
        password: password.trim(),
        rollNumber: rollNumber.trim(),
        position: position?.trim() || 'Member',
        role: 'user',
        teamId: teamId || null,
      })
      .returning();

    const payload = {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      position: newUser.position,
      teamId: newUser.teamId,
      rollNumber: newUser.rollNumber,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    return res.status(201).json({
      message: 'Registration successful!',
      token,
      user: payload,
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error during registration.' });
  }
});

// GET /api/auth/me
router.get('/me', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

    const foundUsers = await db.select().from(users).where(eq(users.id, req.user.id)).limit(1);
    if (foundUsers.length === 0) return res.status(404).json({ error: 'User not found' });

    const u = foundUsers[0];

    let teamName = 'Unassigned';
    if (u.teamId) {
      const foundTeams = await db.select().from(teams).where(eq(teams.id, u.teamId)).limit(1);
      if (foundTeams.length > 0) teamName = foundTeams[0].name;
    }

    return res.json({
      user: {
        id: u.id,
        name: u.name,
        email: u.email,
        rollNumber: u.rollNumber,
        position: u.position,
        role: u.role,
        teamId: u.teamId,
        teamName,
        avatarUrl: u.avatarUrl,
        createdAt: u.createdAt,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PUT /api/auth/profile — DISABLED: users cannot edit their own details.
// Only admins can update names/positions via /api/users/:id.
router.put('/profile', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  return res.status(403).json({ error: 'Profile self-editing is disabled. Please contact an admin to update your details.' });
});

export default router;
