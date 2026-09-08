import { pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Teams Table
export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  description: text('description'),
  color: varchar('color', { length: 30 }).default('#3b82f6'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Users Table (Admins, Advisors & Members)
// role: 'admin' = full access, 'advisor' = read-only view access, 'user' = member self-service
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 150 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: text('password').notNull(), // Plain text password column
  rollNumber: varchar('roll_number', { length: 50 }).notNull().unique(),
  position: varchar('position', { length: 100 }).default('Member').notNull(),
  role: varchar('role', { length: 20 }).$type<'admin' | 'advisor' | 'user'>().default('user').notNull(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Attendance Sessions Table
export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: varchar('title', { length: 200 }).notNull(),
  type: varchar('type', { length: 50 }).$type<'regular' | 'workshop' | 'hackathon' | 'standup'>().default('regular').notNull(),
  description: text('description'),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  qrCodeToken: text('qr_code_token').notNull(),
  location: varchar('location', { length: 200 }).default('DCC Hub / Auditorium'),
  createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'cascade' }),
  startTime: timestamp('start_time').defaultNow().notNull(),
  endTime: timestamp('end_time').notNull(),
  isActive: varchar('is_active', { length: 10 }).default('true').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Attendance Records Table
export const attendance = pgTable('attendance', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  status: varchar('status', { length: 20 }).$type<'present' | 'late'>().default('present').notNull(),
  scanMethod: varchar('scan_method', { length: 30 }).$type<'user_scanner' | 'admin_scanner' | 'manual'>().default('user_scanner').notNull(),
  scannedAt: timestamp('scanned_at').defaultNow().notNull(),
  metadata: text('metadata'),
});

// Relations Definitions
export const teamsRelations = relations(teams, ({ many }) => ({
  members: many(users),
  sessions: many(sessions),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  team: one(teams, {
    fields: [users.teamId],
    references: [teams.id],
  }),
  attendanceRecords: many(attendance),
  createdSessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  team: one(teams, {
    fields: [sessions.teamId],
    references: [teams.id],
  }),
  createdBy: one(users, {
    fields: [sessions.createdById],
    references: [users.id],
  }),
  attendanceRecords: many(attendance),
}));

export const attendanceRelations = relations(attendance, ({ one }) => ({
  session: one(sessions, {
    fields: [attendance.sessionId],
    references: [sessions.id],
  }),
  user: one(users, {
    fields: [attendance.userId],
    references: [users.id],
  }),
}));
