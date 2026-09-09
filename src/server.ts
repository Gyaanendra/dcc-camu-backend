import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.routes';
import teamsRoutes from './routes/teams.routes';
import sessionsRoutes from './routes/sessions.routes';
import attendanceRoutes from './routes/attendance.routes';
import usersRoutes from './routes/users.routes';
import { sql } from './db';
import { initDb } from './db/init';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.disable('x-powered-by');
app.set('trust proxy', 1); // Correct client IPs behind Vercel/reverse proxies

// Minimal security headers (no extra dependency)
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Cookie parser (httpOnly auth cookie). No dependency needed.
app.use((req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.cookie;
  const cookies: Record<string, string> = {};
  if (header) {
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        try {
          cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
        } catch {
          // Ignore malformed cookie segments
        }
      }
    }
  }
  (req as any).cookies = cookies;
  next();
});

// CORS: cookies (`credentials: include`) forbid the '*' wildcard, so the
// backend must echo back an explicit, allowlisted origin + credentials.
// Defaults cover production and local dev with zero env setup; FRONTEND_URL
// (comma-separated) adds future custom domains without a code change.
const defaultOrigins = [
  'https://dcc-camu-frontend.vercel.app',
  'http://localhost:3000',
];
const extraOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const allowedOrigins = new Set([...defaultOrigins, ...extraOrigins]);

// Enable CORS for Next.js frontend
app.use(
  cors({
    origin: (origin, callback) => {
      // No Origin header (curl, mobile apps, same-origin): allow through.
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      // Unknown origins get NO CORS headers -> browser blocks the read.
      return callback(null, false);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '100kb' }));

// In-memory login/register rate limit: 30 attempts per IP per 10 minutes.
// (Per-instance memory: fine for single-server dev; use Redis/Upstash for multi-instance prod.)
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 30;
app.use('/api/auth', (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'POST') return next();
  const now = Date.now();
  const key = req.ip || 'unknown';
  const entry = authAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    authAttempts.set(key, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    return next();
  }
  entry.count += 1;
  if (entry.count > AUTH_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and retry.' });
  }
  // Opportunistic cleanup
  if (authAttempts.size > 5000) {
    for (const [k, v] of authAttempts) {
      if (now > v.resetAt) authAttempts.delete(k);
    }
  }
  next();
});

// Comprehensive Request Logger Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const { method, originalUrl, ip } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    const statusColor =
      statusCode >= 500
        ? '🔴'
        : statusCode >= 400
        ? '🟡'
        : statusCode >= 300
        ? '🔵'
        : '🟢';

    const timestamp = new Date().toLocaleTimeString();
    console.log(
      `[${timestamp}] ${statusColor} ${method} ${originalUrl} -> ${statusCode} (${duration}ms)`
    );
  });

  next();
});

// Health Check & Database Version Endpoint
app.get('/', async (req: Request, res: Response) => {
  try {
    const result = await sql`SELECT version()`;
    const dbVersion = result[0]?.version || 'Neon DB Connected';
    res.json({
      status: 'online',
      app: 'Club DCC Camu Attendance Backend',
      database: dbVersion,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.json({
      status: 'online',
      app: 'Club DCC Camu Attendance Backend',
      database: 'Database offline or credentials missing in .env',
      error: error.message,
    });
  }
});

// API Routes Registration
app.use('/api/auth', authRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/users', usersRoutes);

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  // Malformed JSON bodies are a client error, not a server crash.
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large.' });
  }
  console.error('❌ [Unhandled Server Error]:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// Run DB table initialization & seed on startup, then start HTTP server
initDb().then(() => {
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`🚀 Club DCC Camu Backend Server running on port ${PORT} (0.0.0.0)`);
  });
}).catch((err) => {
  console.error('Failed to initialize database on startup:', err);
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`🚀 Club DCC Camu Backend Server running on port ${PORT} (0.0.0.0)`);
  });
});

export default app;
