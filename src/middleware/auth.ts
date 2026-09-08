import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'advisor' | 'user';
  position: string;
  teamId?: string | null;
  rollNumber: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

const JWT_SECRET = process.env.JWT_SECRET || 'dcc_camu_super_secret_jwt_key_2026';
export const AUTH_COOKIE_NAME = 'dcc_token';

// The DB is the single source of truth: the JWT only carries the user id.
// Every request reloads name/role/position/team from the users table so
// role changes and deletions take effect immediately, even with old tokens.
export const verifyToken = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  const cookieToken = (req as unknown as { cookies?: Record<string, string> }).cookies?.[AUTH_COOKIE_NAME];
  const token = cookieToken || bearer;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  let payload: { id: string };
  try {
    payload = jwt.verify(token, JWT_SECRET) as { id: string };
  } catch (err) {
    // Stale/invalid cookie must not linger and retry forever.
    res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }

  if (!payload?.id || !isUuid(payload.id)) {
    return res.status(401).json({ error: 'Invalid authentication token.' });
  }

  try {
    const found = await db.select().from(users).where(eq(users.id, payload.id)).limit(1);
    if (found.length === 0) {
      res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
      return res.status(401).json({ error: 'Account no longer exists.' });
    }
    const u = found[0];
    req.user = {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      position: u.position,
      teamId: u.teamId,
      rollNumber: u.rollNumber,
    };
    next();
  } catch (err) {
    console.error('Auth DB lookup failed:', err);
    return res.status(500).json({ error: 'Authentication check failed. Please retry.' });
  }
};

export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Admin role required.' });
  }
  next();
};

// Advisor = strictly read-only. Allowed to call GET/view endpoints,
// blocked from every POST/PUT/PATCH/DELETE mutation.
export const requireViewer = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'advisor')) {
    return res.status(403).json({ error: 'Access denied. Admin or Advisor role required.' });
  }
  next();
};

// Block advisor accounts from any state-changing operation.
export const blockAdvisor = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (req.user?.role === 'advisor') {
    return res.status(403).json({ error: 'Advisors have view-only access. Editing, creating, or scanning is disabled.' });
  }
  next();
};

// Client-supplied ids must be well-formed UUIDs before they touch the DB.
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
