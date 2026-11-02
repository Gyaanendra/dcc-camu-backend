import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// Teams Table
export const teams = sqliteTable('teams', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),
  code: text('code').notNull().unique(),
  description: text('description'),
  color: text('color').default('#3b82f6'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Users Table (Admins, Advisors & Members)
// role: 'admin' = full access, 'advisor' = read-only view access, 'user' = member self-service
export const users = sqliteTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  password: text('password').notNull(), // Plain text password column
  rollNumber: text('roll_number').notNull().unique(),
  position: text('position').default('Member').notNull(),
  role: text('role').$type<'admin' | 'advisor' | 'user'>().default('user').notNull(),
  teamId: text('team_id').references(() => teams.id, { onDelete: 'set null' }),
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Attendance Sessions Table
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull(),
  type: text('type').$type<'regular' | 'workshop' | 'hackathon' | 'standup'>().default('regular').notNull(),
  description: text('description'),
  teamId: text('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  targetAudience: text('target_audience').$type<'all' | 'heads_only' | 'teams_only'>().default('all').notNull(),
  targetTeamIds: text('target_team_ids'),
  targetYears: text('target_years'),
  qrCodeToken: text('qr_code_token').notNull(),
  location: text('location').default('DCC Hub / Auditorium'),
  createdById: text('created_by_id').references(() => users.id, { onDelete: 'cascade' }),
  startTime: integer('start_time', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  endTime: integer('end_time', { mode: 'timestamp_ms' }).notNull(),
  isActive: text('is_active').default('true').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Attendance Records Table
export const attendance = sqliteTable('attendance', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  status: text('status').$type<'present' | 'late' | 'not_in_club'>().default('present').notNull(),
  scanMethod: text('scan_method').$type<'user_scanner' | 'admin_scanner' | 'manual'>().default('user_scanner').notNull(),
  scannedAt: integer('scanned_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  metadata: text('metadata'),
});

// On Duty (OD) Requests Table
export const odRequests = sqliteTable('od_requests', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  date: text('date').notNull(), // YYYY-MM-DD
  reason: text('reason').notNull(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  lectures: text('lectures').notNull(), // JSON stringified array of lectures
  status: text('status').$type<'pending' | 'approved' | 'rejected'>().default('pending').notNull(),
  adminNotes: text('admin_notes'),
  reviewedById: text('reviewed_by_id').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
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

export const odRequestsRelations = relations(odRequests, ({ one }) => ({
  user: one(users, {
    fields: [odRequests.userId],
    references: [users.id],
  }),
  session: one(sessions, {
    fields: [odRequests.sessionId],
    references: [sessions.id],
  }),
  reviewedBy: one(users, {
    fields: [odRequests.reviewedById],
    references: [users.id],
  }),
}));
