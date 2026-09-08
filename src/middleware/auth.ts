import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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

export const verifyToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
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
