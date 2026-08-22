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

// Enable CORS for Next.js frontend
app.use(
  cors({
    origin: '*',
    credentials: true,
  })
);

app.use(express.json());

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
  console.error('Unhandled Error:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// Run DB table initialization & seed on startup, then start HTTP server
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Club DCC Camu Backend Server running at http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to initialize database on startup:', err);
  app.listen(PORT, () => {
    console.log(`🚀 Club DCC Camu Backend Server running at http://localhost:${PORT}`);
  });
});

export default app;
